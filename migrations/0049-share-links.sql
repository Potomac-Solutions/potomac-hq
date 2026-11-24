-- Decision 0007, section 11: sharing a project by link. Only a hash of each
-- link's secret is kept; the address is shown once. A link works until it's
-- stopped or its last day passes. Making and stopping links is admin and
-- manager (project.share).
create table project_share (
  id              text primary key,
  project_id      text not null references project (id),
  token_hash      text not null unique,
  label           text not null check (length(trim(label)) > 0 and length(label) <= 80),
  rights          text not null check (rights in ('see', 'comment')),
  expires_on      text check (expires_on is null or expires_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  created_by      text not null references user (id),
  created_at      text not null,
  stopped_at      text,
  stopped_by      text references user (id),
  visits          integer not null default 0,
  last_visited_at text
) strict;
create index project_share_by_project on project_share (project_id, created_at);

insert into role_permission (role_id, permission) select role.id, 'project.share' from role where role.key in ('admin', 'manager');

-- A comment may now come through a link: no HQ author, the name the visitor
-- typed, and the link it came through. Nothing refers to task_comment, so it
-- is rebuilt in place.
create table task_comment_new (
  id         text primary key,
  task_id    text not null references task (id),
  author_id  text references user (id),
  share_id   text references project_share (id),
  guest_name text check (guest_name is null or (length(trim(guest_name)) > 0 and length(guest_name) <= 60)),
  body       text not null check (length(trim(body)) > 0 and length(body) <= 5000),
  created_at text not null,
  edited_at  text,
  check ((author_id is not null and share_id is null and guest_name is null) or (author_id is null and share_id is not null and guest_name is not null))
) strict;
insert into task_comment_new (id, task_id, author_id, body, created_at, edited_at) select id, task_id, author_id, body, created_at, edited_at from task_comment;
drop table task_comment;
alter table task_comment_new rename to task_comment;
create index task_comment_by_task on task_comment (task_id, created_at);
