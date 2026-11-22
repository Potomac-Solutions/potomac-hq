-- v0.3: the project stub becomes the place work is tracked
-- (docs/data-model.md, "v0.3"). Phases, milestones, tasks, notes, the file
-- service and deliverables, and each person's theme.

alter table project add column description text not null default '';
alter table project add column health text not null default 'on-track' check (health in ('on-track', 'at-risk', 'off-track'));
alter table project add column start_on text check (start_on is null or start_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
alter table project add column target_on text check (target_on is null or target_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

create table phase (
  id         text primary key,
  project_id text not null references project (id),
  name       text not null check (length(trim(name)) > 0),
  position   integer not null check (position >= 0),
  created_at text not null,
  updated_at text not null
) strict;

create index phase_by_project on phase (project_id, position);

create table milestone (
  id         text primary key,
  project_id text not null references project (id),
  phase_id   text references phase (id),
  name       text not null check (length(trim(name)) > 0),
  due_on     text check (due_on is null or due_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_on    text check (done_on is null or done_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at text not null,
  updated_at text not null
) strict;

create index milestone_by_project on milestone (project_id);
create index milestone_open_by_due on milestone (due_on) where done_on is null;

create table task (
  id               text primary key,
  project_id       text not null references project (id),
  phase_id         text references phase (id),
  title            text not null check (length(trim(title)) > 0),
  description      text not null default '',
  assignee_id      text references user (id),
  priority         text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  due_on           text check (due_on is null or due_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  status           text not null check (status in ('todo', 'doing', 'blocked', 'done')),
  done_at          text,
  created_at       text not null,
  updated_at       text not null,
  check ((status = 'done') = (done_at is not null))
) strict;

create index task_by_project on task (project_id);
create index task_open_by_due on task (due_on) where status <> 'done';

-- A note on a client, an opportunity or a project. Notes are written once:
-- there is no edit and no delete.
create table note (
  id          text primary key,
  record_type text not null check (record_type in ('client-organization', 'opportunity', 'project')),
  record_id   text not null,
  author_id   text not null references user (id),
  body        text not null check (length(trim(body)) > 0),
  created_at  text not null
) strict;

create index note_by_record on note (record_type, record_id);

-- The file service (docs/decisions/0002-file-storage.md). A file's bytes are
-- kept in the database, so the nightly backup holds them too. Nothing here is
-- reachable by a path: every download goes through an application service.
create table file (
  id              text primary key,
  name            text not null check (length(name) > 0),
  content_type    text not null,
  size_bytes      integer not null check (size_bytes > 0),
  sha256          text not null check (length(sha256) = 64),
  owner_type      text not null check (length(owner_type) > 0),
  owner_id        text not null,
  -- The client the file belongs to, if any, and whether that client may
  -- download it. The portal's check reads only these two columns.
  organization_id text references client_organization (id),
  client_visible  integer not null default 0 check (client_visible in (0, 1)),
  uploaded_by     text references user (id),
  created_at      text not null
) strict;

create index file_by_owner on file (owner_type, owner_id);

create table file_blob (
  file_id text primary key references file (id),
  body    blob not null
) strict;

create table deliverable (
  id            text primary key,
  project_id    text not null references project (id),
  title         text not null check (length(trim(title)) > 0),
  description   text not null default '',
  file_id       text not null unique references file (id),
  status        text not null check (status in ('draft', 'shared', 'approved', 'changes-requested')),
  shared_at     text,
  decided_at    text,
  decision_note text,
  created_by    text not null references user (id),
  created_at    text not null,
  updated_at    text not null,
  check (status = 'draft' or shared_at is not null),
  check ((status in ('approved', 'changes-requested')) = (decided_at is not null))
) strict;

create index deliverable_by_project on deliverable (project_id);

create table user_preference (
  user_id    text primary key references user (id),
  theme      text not null check (theme in ('system', 'light', 'dark')),
  updated_at text not null
) strict;

-- New permissions (docs/authorization-matrix.md, "v0.3"). Every role holds
-- all of them.
insert into role_permission (role_id, permission)
select role.id, added.column1
  from role,
       (values ('project.plan'), ('task.view'), ('task.edit'), ('note.view'), ('note.add'),
               ('file.upload'), ('file.download'), ('deliverable.edit')) as added;
