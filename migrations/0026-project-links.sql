-- Where a project's work lives: the code, the staging and live sites, the
-- designs. Each one is shown to the client in the portal, or kept to Potomac.
create table project_link (
  id text primary key,
  project_id text not null references project (id),
  kind text not null check (kind in ('repository', 'staging', 'live', 'design', 'docs', 'other')),
  label text not null default '' check (length(label) <= 80),
  url text not null check (length(url) between 1 and 500),
  shared integer not null check (shared in (0, 1)),
  created_by text not null references user (id),
  created_at text not null
) strict;
create index project_link_by_project on project_link (project_id);
