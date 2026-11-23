-- To-dos: a thing for someone to do, by a day or whenever, at a client or on
-- an opportunity or neither. Done ones are kept, with when.
create table todo (
  id text primary key,
  title text not null check (length(title) between 1 and 200),
  due_on text,
  assignee_id text not null references user (id),
  organization_id text references client_organization (id),
  opportunity_id text references opportunity (id),
  done_at text,
  created_by text not null references user (id),
  created_at text not null,
  updated_at text not null
) strict;
create index todo_open_by_assignee on todo (assignee_id, done_at, due_on);
create index todo_by_organization on todo (organization_id, done_at);
create index todo_by_opportunity on todo (opportunity_id, done_at);
