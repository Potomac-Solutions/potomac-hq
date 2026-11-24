-- Decision 0007, section 13: importing tasks from Trello and Todoist. What an
-- export would make is kept here between the preview and saying yes: one per
-- person, removed when it's used or cancelled, or after a day.
create table task_import (
  id         text primary key,
  user_id    text not null unique references user (id),
  project_id text not null references project (id),
  plan       text not null check (json_valid(plan)),
  created_at text not null
) strict;
