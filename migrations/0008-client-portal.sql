-- v0.6: the client portal (docs/data-model.md, "v0.6"). A client user is
-- separate from an HQ user and belongs to exactly one client organization.
-- Their passwords and sessions are kept by a second instance of the kit's
-- staff module, in kit_document collections that start "portal:".

create table client_user (
  id              text primary key,
  organization_id text not null references client_organization (id),
  -- The portal account they sign in with. Empty until they accept the invite.
  portal_account  text unique,
  name            text not null check (length(trim(name)) > 0),
  email           text not null unique check (email = lower(email) and email like '%_@_%'),
  status          text not null check (status in ('invited', 'active', 'disabled')),
  invited_by      text not null references user (id),
  created_at      text not null,
  updated_at      text not null,
  check (status <> 'active' or portal_account is not null)
) strict;

create index client_user_by_organization on client_user (organization_id);

-- What Potomac tells the client about a project, and what the client writes
-- back. Internal notes are a different table and never appear here.
create table project_update (
  id             text primary key,
  project_id     text not null references project (id),
  -- Exactly one of the two authors is set.
  user_id        text references user (id),
  client_user_id text references client_user (id),
  body           text not null check (length(trim(body)) > 0),
  created_at     text not null,
  check ((user_id is null) <> (client_user_id is null))
) strict;

create index project_update_by_project on project_update (project_id);

-- A client asking for a call, and Potomac's answer.
create table call_request (
  id              text primary key,
  organization_id text not null references client_organization (id),
  client_user_id  text not null references client_user (id),
  wanted          text not null check (length(trim(wanted)) > 0),
  note            text not null default '',
  status          text not null check (status in ('requested', 'confirmed', 'declined')),
  -- The day and time agreed, as text: "2026-11-20, 2:00 PM".
  confirmed_for   text,
  reply           text not null default '',
  answered_by     text references user (id),
  created_at      text not null,
  updated_at      text not null,
  check (status <> 'confirmed' or confirmed_for is not null)
) strict;

create index call_request_by_organization on call_request (organization_id);

-- Who decided on a deliverable, when the client did it in the portal.
alter table deliverable add column decided_by_client text references client_user (id);

-- New permissions (docs/authorization-matrix.md, "v0.6"). These are what HQ
-- users may do about the portal. A client user holds no permission at all:
-- what a client may do is fixed in the portal's own services.
insert into role_permission (role_id, permission)
select role.id, added.column1
  from role, (values ('portal.view'), ('project.post-update'), ('call.respond')) as added;

insert into role_permission (role_id, permission)
select role.id, 'portal.manage' from role where role.key in ('admin', 'manager');
