-- The site builder (decision 0010): client websites made with Claude in HQ.
-- A build belongs to one client. Each answer from Claude, and each restore,
-- is a new numbered version holding every file. Each request records what it
-- reserved under the monthly cap and what it really cost, in micro-dollars.
create table build (
  id text primary key,
  organization_id text not null references client_organization (id),
  name text not null,
  brief text not null default '',
  created_by text not null references user (id),
  created_at text not null,
  updated_at text not null
) strict;
create index build_organization on build (organization_id);

create table build_request (
  id text primary key,
  build_id text not null references build (id),
  asked_by text not null references user (id),
  ask text not null,
  model text not null,
  state text not null check (state in ('working', 'done', 'failed')),
  reserved_micros integer not null check (reserved_micros >= 0),
  cost_micros integer not null default 0 check (cost_micros >= 0),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  error text,
  created_at text not null,
  finished_at text
) strict;
create index build_request_build on build_request (build_id, created_at);
create index build_request_created on build_request (created_at);
create index build_request_working on build_request (state) where state = 'working';

create table build_version (
  build_id text not null references build (id),
  number integer not null check (number >= 1),
  request_id text references build_request (id),
  made_by text references user (id),
  summary text not null default '',
  files text not null,
  chars integer not null,
  created_at text not null,
  primary key (build_id, number)
) strict;

-- The model and the monthly cap: one row. A new install starts on Opus 5.5
-- with a $10 cap (decision 0010, section 4).
create table builder_settings (
  id integer primary key check (id = 1),
  model text not null,
  cap_cents integer not null check (cap_cents between 100 and 100000),
  updated_at text not null default ''
) strict;
insert into builder_settings (id, model, cap_cents) values (1, 'claude-opus-5-5', 1000);

insert into role_permission (role_id, permission) select role.id, 'site.build' from role where role.key = 'admin';
