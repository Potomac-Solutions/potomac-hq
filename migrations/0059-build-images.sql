-- The site builder's images (decision 0010, slice 2): photos and a logo
-- uploaded to a build, kept in the database like a website's photos
-- (decision 0002), so there is one file to back up. Each has a path in the
-- site made from its id, and what it shows.
create table build_image (
  id text primary key,
  build_id text not null references build (id),
  path text not null,
  kind text not null check (kind in ('photo', 'logo')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  alt text not null,
  size_bytes integer not null,
  body blob not null,
  added_by text not null references user (id),
  created_at text not null,
  unique (build_id, path)
) strict;
create index build_image_build on build_image (build_id, created_at);
