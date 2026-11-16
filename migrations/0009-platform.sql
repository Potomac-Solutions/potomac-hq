-- v1.0: managing users, the knowledge base and reports (docs/data-model.md,
-- "v1.0").

-- Someone an admin invited to HQ who has not used their link yet. The user
-- row is made when they do, with these roles.
create table user_invite (
  id          text primary key,
  email       text not null unique check (email = lower(email) and email like '%_@_%'),
  name        text not null check (length(trim(name)) > 0),
  -- A JSON array of role keys.
  roles       text not null check (json_valid(roles) and json_type(roles) = 'array' and json_array_length(roles) > 0),
  invited_by  text not null references user (id),
  created_at  text not null
) strict;

-- The knowledge base. A decision is an article with a day it was made on.
create table article (
  id          text primary key,
  kind        text not null check (kind in ('article', 'decision')),
  slug        text not null unique check (length(slug) > 0 and slug = lower(slug)),
  title       text not null check (length(trim(title)) > 0),
  category    text not null check (length(trim(category)) > 0),
  -- Lower-case tags with a comma before and after each: ",backups,railway,".
  tags        text not null default ',',
  body        text not null,
  status      text not null check (status in ('current', 'archived')),
  decided_on  text check (decided_on is null or decided_on like '____-__-__'),
  revision    integer not null check (revision >= 1),
  created_at  text not null,
  updated_at  text not null,
  check (kind <> 'decision' or decided_on is not null)
) strict;

-- Every saved version of an article, the current one included. Written once.
create table article_revision (
  article_id  text not null references article (id),
  revision    integer not null check (revision >= 1),
  title       text not null,
  category    text not null,
  tags        text not null,
  body        text not null,
  -- Empty when HQ itself wrote it, from the documents it ships with.
  saved_by    text references user (id),
  saved_at    text not null,
  primary key (article_id, revision)
) strict;

create trigger article_revision_no_update before update on article_revision
begin
  select raise(abort, 'article_revision is written once');
end;

create trigger article_revision_no_delete before delete on article_revision
begin
  select raise(abort, 'article_revision is written once');
end;

-- New permissions (docs/authorization-matrix.md, "v1.0").
insert into role_permission (role_id, permission)
select role.id, 'knowledge.view' from role;

insert into role_permission (role_id, permission)
select role.id, added.column1
  from role, (values ('knowledge.edit'), ('report.view')) as added
 where role.key in ('admin', 'manager');
