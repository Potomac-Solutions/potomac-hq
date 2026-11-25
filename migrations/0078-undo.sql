-- Undo on everyday buttons (quality of life, Mikey 2026-11-25): after moving
-- a task or ticking a to-do off (or back on), the page offers Undo for ten
-- minutes. Each row is what puts one change back, for the person who made it.
create table undo_step (
  id          text primary key,
  user_id     text not null references user (id),
  kind        text not null check (kind in ('task-status', 'todo-done', 'todo-reopen')),
  record_id   text not null,
  -- What it was before: a task's status, or empty.
  was         text not null default '',
  label       text not null check (length(label) between 1 and 200),
  created_at  text not null,
  used_at     text
) strict;
create index undo_step_by_user on undo_step (user_id, created_at);
