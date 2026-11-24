-- One inbox (decision 0007, section 1): a to-do becomes a task without a
-- project. The task table is rebuilt so project_id may be empty, and gains
-- the client, the opportunity and who added it, as to-dos had. Every to-do is
-- copied in with its id, dates and who it belongs to; the todo table goes.
--
-- This runs inside the migration's transaction with foreign keys on, where
-- they can't be turned off. Deferring them lets the old table go before its
-- rows are back: time entries and labels point at task ids, and each one is
-- answered again when its row is copied into the new table, before commit.
pragma defer_foreign_keys = on;

create table task_before_inbox as select * from task;

create table task_next (
  id               text primary key,
  project_id       text references project (id),
  phase_id         text references phase (id),
  title            text not null check (length(trim(title)) > 0),
  description      text not null default '',
  assignee_id      text references user (id),
  priority         text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  due_on           text check (due_on is null or due_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  status           text not null check (status in ('todo', 'doing', 'blocked', 'done')),
  done_at          text,
  organization_id  text references client_organization (id),
  opportunity_id   text references opportunity (id),
  created_by       text references user (id),
  created_at       text not null,
  updated_at       text not null,
  check ((status = 'done') = (done_at is not null)),
  -- A task without a project is a to-do: someone's, with no phase, to do or done.
  check (project_id is not null or (phase_id is null and assignee_id is not null and status in ('todo', 'done')))
) strict;

drop table task;
alter table task_next rename to task;

insert into task (id, project_id, phase_id, title, description, assignee_id, priority, due_on, estimate_minutes, status, done_at, created_at, updated_at)
select id, project_id, phase_id, title, description, assignee_id, priority, due_on, estimate_minutes, status, done_at, created_at, updated_at
  from task_before_inbox;
drop table task_before_inbox;

insert into task (id, project_id, phase_id, title, description, assignee_id, priority, due_on, estimate_minutes, status, done_at, organization_id, opportunity_id, created_by, created_at, updated_at)
select id, null, null, title, '', assignee_id, 'normal', due_on, null, case when done_at is null then 'todo' else 'done' end, done_at, organization_id, opportunity_id, created_by, created_at, updated_at
  from todo;
drop table todo;

create index task_by_project on task (project_id);
create index task_open_by_due on task (due_on) where status <> 'done';
create index task_open_by_assignee on task (assignee_id, due_on) where status <> 'done';
create index task_by_organization on task (organization_id) where organization_id is not null;
create index task_by_opportunity on task (opportunity_id) where opportunity_id is not null;
