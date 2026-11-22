-- Users, roles and permissions (docs/data-model.md, docs/authorization-matrix.md).
-- Passwords and sessions are not here. The kit's staff module holds them.

create table user (
  id            text primary key,
  staff_account text not null unique check (length(staff_account) > 0),
  name          text not null check (length(name) > 0),
  email         text not null unique check (email = lower(email) and email like '%_@_%'),
  status        text not null check (status in ('active', 'disabled')),
  created_at    text not null,
  updated_at    text not null
) strict;

create table role (
  id         text primary key,
  key        text not null unique check (key in ('admin', 'manager', 'member')),
  name       text not null,
  created_at text not null,
  updated_at text not null
) strict;

create table role_permission (
  role_id    text not null references role (id),
  permission text not null check (length(permission) > 0),
  primary key (role_id, permission)
) strict, without rowid;

create table user_role (
  user_id text not null references user (id),
  role_id text not null references role (id),
  primary key (user_id, role_id)
) strict, without rowid;

create index user_role_by_role on user_role (role_id);

-- The three roles and what each may do. This must match
-- docs/authorization-matrix.md. A test compares the two.
insert into role (id, key, name, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin', 'Admin', '2026-11-14T00:00:00Z', '2026-11-14T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000a2', 'manager', 'Manager', '2026-11-14T00:00:00Z', '2026-11-14T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000a3', 'member', 'Member', '2026-11-14T00:00:00Z', '2026-11-14T00:00:00Z');

insert into role_permission (role_id, permission) values
  -- admin
  ('00000000-0000-4000-8000-0000000000a1', 'user.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'user.invite'),
  ('00000000-0000-4000-8000-0000000000a1', 'user.set-status'),
  ('00000000-0000-4000-8000-0000000000a1', 'user.set-roles'),
  ('00000000-0000-4000-8000-0000000000a1', 'user.reset'),
  ('00000000-0000-4000-8000-0000000000a1', 'dashboard.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'activity.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'activity.view-all'),
  ('00000000-0000-4000-8000-0000000000a1', 'client.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'client.create'),
  ('00000000-0000-4000-8000-0000000000a1', 'client.edit'),
  ('00000000-0000-4000-8000-0000000000a1', 'client.set-status'),
  ('00000000-0000-4000-8000-0000000000a1', 'contact.edit'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.view-value'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.set-value'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.create'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.edit'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.set-stage'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.set-follow-up'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.set-owner'),
  ('00000000-0000-4000-8000-0000000000a1', 'opportunity.convert'),
  ('00000000-0000-4000-8000-0000000000a1', 'project.view'),
  ('00000000-0000-4000-8000-0000000000a1', 'project.edit'),
  ('00000000-0000-4000-8000-0000000000a1', 'project.set-status'),
  ('00000000-0000-4000-8000-0000000000a1', 'project.set-owner'),
  -- manager
  ('00000000-0000-4000-8000-0000000000a2', 'user.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'dashboard.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'activity.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'client.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'client.create'),
  ('00000000-0000-4000-8000-0000000000a2', 'client.edit'),
  ('00000000-0000-4000-8000-0000000000a2', 'client.set-status'),
  ('00000000-0000-4000-8000-0000000000a2', 'contact.edit'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.view-value'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.set-value'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.create'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.edit'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.set-stage'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.set-follow-up'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.set-owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'opportunity.convert'),
  ('00000000-0000-4000-8000-0000000000a2', 'project.view'),
  ('00000000-0000-4000-8000-0000000000a2', 'project.edit'),
  ('00000000-0000-4000-8000-0000000000a2', 'project.set-status'),
  ('00000000-0000-4000-8000-0000000000a2', 'project.set-owner'),
  -- member
  ('00000000-0000-4000-8000-0000000000a3', 'user.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'dashboard.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'activity.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'client.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'client.create'),
  ('00000000-0000-4000-8000-0000000000a3', 'client.edit'),
  ('00000000-0000-4000-8000-0000000000a3', 'client.set-status'),
  ('00000000-0000-4000-8000-0000000000a3', 'contact.edit'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.create'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.edit'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.set-stage'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.set-follow-up'),
  ('00000000-0000-4000-8000-0000000000a3', 'opportunity.convert'),
  ('00000000-0000-4000-8000-0000000000a3', 'project.view'),
  ('00000000-0000-4000-8000-0000000000a3', 'project.edit'),
  ('00000000-0000-4000-8000-0000000000a3', 'project.set-status');
