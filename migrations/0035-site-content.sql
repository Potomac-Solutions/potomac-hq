-- Site content (docs/decisions/0003-site-content.md): a client's website
-- that HQ can publish to, what is on it, the changes waiting to go on it,
-- and the photos for both.
create table content_site (
  id                text primary key,
  -- A client has one site.
  organization_id   text not null unique references client_organization (id),
  name              text not null check (length(trim(name)) between 1 and 80),
  repo_owner        text not null check (length(repo_owner) between 1 and 39),
  repo_name         text not null check (length(repo_name) between 1 and 100),
  branch            text not null check (length(branch) between 1 and 100),
  content_path      text not null check (length(content_path) between 1 and 150),
  photo_dir         text not null check (length(photo_dir) between 1 and 150),
  -- What is on the site, and the content with the waiting changes made, as JSON.
  published         text not null check (json_valid(published)),
  published_at      text,
  published_commit  text,
  draft             text check (draft is null or json_valid(draft)),
  draft_state       text not null check (draft_state in ('none', 'editing', 'submitted')),
  submitted_at      text,
  submitted_by      text,
  note              text not null default '' check (length(note) <= 1000),
  created_at        text not null,
  updated_at        text not null,
  check ((draft is null) = (draft_state = 'none'))
) strict;

-- A photo's bytes, kept in the database like every other file
-- (docs/decisions/0002-file-storage.md), so one backup holds them.
create table content_photo (
  id            text primary key,
  site_id       text not null references content_site (id),
  path          text not null check (length(path) between 1 and 400),
  content_type  text not null,
  -- 1 once the file is in the site's repository.
  in_repo       integer not null check (in_repo in (0, 1)),
  body          blob not null,
  created_at    text not null
) strict;

create index content_photo_by_site on content_photo (site_id);

-- Setting a site up and publishing to it is for managers and admins
-- (docs/authorization-matrix.md).
insert into role_permission (role_id, permission)
select role.id, 'site.publish' from role where role.key in ('admin', 'manager');
