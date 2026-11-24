-- Decision 0007, section 6: comments on tasks. Files attached to a task go in
-- the existing file table with owner_type 'task'; nothing new is needed there.
--
-- A deleted comment's row goes; its every version and its deletion stay in
-- the task's history, as events (comment.added, comment.edited,
-- comment.removed).
create table task_comment (
  id         text primary key,
  task_id    text not null references task (id),
  author_id  text not null references user (id),
  body       text not null check (length(trim(body)) > 0 and length(body) <= 5000),
  created_at text not null,
  edited_at  text
) strict;
create index task_comment_by_task on task_comment (task_id, created_at);
