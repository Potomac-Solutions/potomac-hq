-- "How did we do?" (2026-11-26): one score from the client when a project is
-- finished, 1 to 5, with an optional line. Once per project. A low score
-- makes a to-do for whoever ran the project, to call them.
create table project_feedback (
  project_id     text primary key references project (id),
  client_user_id text not null references client_user (id),
  score          integer not null check (score between 1 and 5),
  note           text not null default '' check (length(note) <= 1000),
  todo_id        text references task (id),
  created_at     text not null
) strict;
