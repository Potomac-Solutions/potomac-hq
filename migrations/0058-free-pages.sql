-- Free landing pages (decision 0010, section 3): one per client, its address
-- on potomac.solutions, and the rounds of changes asked for.
create table free_page (
  id               text primary key,
  organization_id  text not null unique references client_organization (id),
  subdomain        text unique check (subdomain is null or length(subdomain) between 1 and 40),
  status           text not null check (status in ('requested', 'building', 'in-review', 'approved', 'live', 'handed-over')),
  repo_owner       text check (repo_owner is null or length(repo_owner) between 1 and 39),
  repo_name        text check (repo_name is null or length(repo_name) between 1 and 100),
  repo_branch      text check (repo_branch is null or length(repo_branch) between 1 and 100),
  approved_at      text,
  created_at       text not null,
  updated_at       text not null,
  check ((repo_owner is null) = (repo_name is null) and (repo_owner is null) = (repo_branch is null))
) strict;

create table free_page_round (
  id              text primary key,
  free_page_id    text not null references free_page (id),
  number          integer not null check (number > 0),
  text            text not null check (length(text) between 1 and 4000),
  -- 0 once the free rounds are used, or after approval: paid work to price.
  free            integer not null check (free in (0, 1)),
  origin          text not null check (origin in ('client', 'staff')),
  client_user_id  text references client_user (id),
  user_id         text references user (id),
  done_at         text,
  done_by         text references user (id),
  created_at      text not null,
  unique (free_page_id, number),
  check ((origin = 'client') = (client_user_id is not null)),
  check ((origin = 'staff') = (user_id is not null))
) strict;

create index free_page_round_open on free_page_round (done_at, created_at);

-- Recording free pages and their rounds is anyone's job at Potomac
-- (docs/authorization-matrix.md).
insert into role_permission (role_id, permission)
select role.id, 'free-page.manage' from role where role.key in ('admin', 'manager', 'member');
