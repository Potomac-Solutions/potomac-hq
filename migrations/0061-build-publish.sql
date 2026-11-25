-- Putting a site builder version on GitHub (decision 0010, slice 4). Each
-- publish is one commit: the first one made the repository, or a pull
-- request to a client's own. The newest says where the next goes.
create table build_publish (
  id text primary key,
  build_id text not null references build (id),
  version integer not null,
  kind text not null check (kind in ('new-repo', 'commit', 'pull-request')),
  repo text not null,
  branch text not null,
  commit_sha text not null,
  url text not null,
  published_by text not null references user (id),
  published_at text not null
) strict;
create index build_publish_build on build_publish (build_id, published_at);
