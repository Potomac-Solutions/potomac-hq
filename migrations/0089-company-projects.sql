-- Company projects (decision 0021): a project may be Potomac's own work,
-- with no client and no opportunity. The two go together: a client project
-- has both, a company project has neither. SQLite can't loosen a column's
-- `not null`, so the table is rebuilt with every row kept as it was.
--
-- This runs inside the migration's transaction with foreign keys on, where
-- they can't be turned off. Deferring them lets the old table go before its
-- rows are back: tasks, time entries, invoices and the rest point at project
-- ids, and each one is answered again when the rows are copied back in.
pragma defer_foreign_keys = on;

create table project_before_company as select * from project;

create table project_next (
  id              text primary key,
  organization_id text references client_organization (id),
  opportunity_id  text unique references opportunity (id),
  owner_id        text not null references user (id),
  name            text not null check (length(trim(name)) > 0),
  kind            text not null check (kind in ('fixed', 'ongoing')),
  status          text not null check (status in ('active', 'completed', 'cancelled')),
  created_at      text not null,
  updated_at      text not null,
  description     text not null default '',
  health          text not null default 'on-track' check (health in ('on-track', 'at-risk', 'off-track')),
  start_on        text check (start_on is null or start_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  target_on       text check (target_on is null or target_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  check (kind <> 'ongoing' or status <> 'completed'),
  -- A client project has a client and the opportunity it was won from; a
  -- company project has neither.
  check ((organization_id is null) = (opportunity_id is null))
) strict;

drop table project;
alter table project_next rename to project;

insert into project (id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at, description, health, start_on, target_on)
select id, organization_id, opportunity_id, owner_id, name, kind, status, created_at, updated_at, description, health, start_on, target_on
  from project_before_company;
drop table project_before_company;

create index project_by_organization on project (organization_id) where organization_id is not null;

-- Starting a company project (docs/authorization-matrix.md). Admins and
-- managers; a member works in one but doesn't start one.
insert into role_permission (role_id, permission)
select role.id, 'project.start'
  from role
 where role.key in ('admin', 'manager');
