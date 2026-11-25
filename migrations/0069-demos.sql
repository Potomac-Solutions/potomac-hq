-- Who looked at a demo (decision 0013, section 8): the Lab's demos, a link
-- of its own for each demo sent to a prospect, and each time one is opened.
create table demo (
  id           text primary key,
  name         text not null check (length(name) between 1 and 80),
  url          text not null check (length(url) between 9 and 300),
  description  text not null default '' check (length(description) <= 300),
  sign_in      text not null default '' check (length(sign_in) <= 500),
  active       integer not null check (active in (0, 1)),
  created_at   text not null,
  updated_at   text not null
) strict;

create table demo_link (
  id              text primary key,
  code            text not null unique check (length(code) = 8),
  demo_id         text not null references demo (id),
  opportunity_id  text not null references opportunity (id),
  sent_by         text not null references user (id),
  sent_at         text not null
) strict;

create index demo_link_by_opportunity on demo_link (opportunity_id);

-- One row an open: when, and nothing about who.
create table demo_open (
  link_id    text not null references demo_link (id) on delete cascade,
  opened_at  text not null
) strict;

create index demo_open_by_link on demo_open (link_id, opened_at);

insert into role_permission (role_id, permission)
select role.id, 'demo.manage' from role where role.key in ('admin', 'manager');
