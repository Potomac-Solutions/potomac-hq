-- Client requests (2026-11-26). A client asks for something from the portal
-- ("change the hours on the website"); HQ makes it a task on their project,
-- or a to-do about them, and the client follows it by that task's status.
-- Potomac can say it isn't going ahead, with why.
create table client_request (
  id              text primary key,
  organization_id text not null references client_organization (id),
  project_id      text references project (id),
  client_user_id  text not null references client_user (id),
  title           text not null check (length(title) between 1 and 120),
  details         text not null default '' check (length(details) <= 2000),
  task_id         text references task (id),
  declined_note   text not null default '' check (length(declined_note) <= 300),
  declined_at     text,
  declined_by     text references user (id),
  created_at      text not null
) strict;

create index client_request_by_client on client_request (organization_id, created_at);
