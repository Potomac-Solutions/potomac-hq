-- v0.4: proposals and estimates (docs/data-model.md, "v0.4"). A proposal is
-- edited as a working copy, sent as numbered versions that can never change,
-- and then accepted or declined. Accepting one sets the project's baseline.

create table proposal (
  id                 text primary key,
  opportunity_id     text not null references opportunity (id),
  title              text not null check (length(trim(title)) > 0),
  status             text not null check (status in ('draft', 'sent', 'revised', 'accepted', 'declined')),
  pricing            text not null check (pricing in ('free', 'hourly', 'fixed', 'monthly', 'yearly')),
  scope              text not null default '',
  assumptions        text not null default '',
  exclusions         text not null default '',
  deliverables       text not null default '',
  -- The working copy's estimate lines, as a JSON array.
  lines              text not null check (json_valid(lines) and json_type(lines) = 'array'),
  current_version    integer not null default 0 check (current_version >= 0),
  shared_with_client integer not null default 0 check (shared_with_client in (0, 1)),
  created_by         text not null references user (id),
  created_at         text not null,
  updated_at         text not null,
  check (status <> 'draft' or current_version = 0),
  check (status = 'draft' or current_version > 0)
) strict;

create index proposal_by_opportunity on proposal (opportunity_id);

create table proposal_version (
  proposal_id  text not null references proposal (id),
  number       integer not null check (number > 0),
  title        text not null,
  pricing      text not null,
  scope        text not null,
  assumptions  text not null,
  exclusions   text not null,
  deliverables text not null,
  lines        text not null check (json_valid(lines) and json_type(lines) = 'array'),
  total_minor  integer not null check (total_minor >= 0),
  currency     text not null default 'USD' check (currency = 'USD'),
  minutes      integer not null check (minutes >= 0),
  sent_by      text not null references user (id),
  sent_at      text not null,
  primary key (proposal_id, number)
) strict, without rowid;

-- A sent version is a record of what was promised. Nothing may change it.
create trigger proposal_version_no_update before update on proposal_version
begin
  select raise(abort, 'proposal_version is immutable: a sent version cannot be changed');
end;

create trigger proposal_version_no_delete before delete on proposal_version
begin
  select raise(abort, 'proposal_version is immutable: a sent version cannot be deleted');
end;

-- The client's answer: who, when, how, and to which version.
create table proposal_decision (
  proposal_id text primary key references proposal (id),
  version     integer not null,
  decision    text not null check (decision in ('accepted', 'declined')),
  by_name     text not null check (length(trim(by_name)) > 0),
  decided_on  text not null check (decided_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  method      text not null check (method in ('in-person', 'phone', 'email', 'signed-paper', 'portal')),
  note        text,
  -- Empty when the client decided for themselves in the portal.
  recorded_by text references user (id),
  recorded_at text not null,
  foreign key (proposal_id, version) references proposal_version (proposal_id, number)
) strict;

-- The signed agreement: where it is kept, and a scan if there is one.
create table agreement (
  id          text primary key,
  proposal_id text not null references proposal (id),
  version     integer not null,
  reference   text not null default '',
  signed_on   text not null check (signed_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  file_id     text references file (id),
  recorded_by text not null references user (id),
  created_at  text not null,
  check (length(trim(reference)) > 0 or file_id is not null)
) strict;

create index agreement_by_proposal on agreement (proposal_id);

-- What was agreed for a project: the accepted proposal's total, hours and
-- lines. v0.5 measures actual time and cost against it.
create table project_baseline (
  project_id   text primary key references project (id),
  proposal_id  text not null references proposal (id),
  version      integer not null,
  pricing      text not null,
  amount_minor integer not null check (amount_minor >= 0),
  currency     text not null default 'USD' check (currency = 'USD'),
  minutes      integer not null check (minutes >= 0),
  lines        text not null check (json_valid(lines) and json_type(lines) = 'array'),
  set_at       text not null
) strict;

-- New permissions (docs/authorization-matrix.md, "v0.4"). A proposal is all
-- prices, so a member, who never sees a deal's value, holds none of them.
insert into role_permission (role_id, permission)
select role.id, added.column1
  from role,
       (values ('proposal.view'), ('proposal.edit'), ('proposal.send'), ('proposal.decide')) as added
 where role.key in ('admin', 'manager');
