-- Saved replies (quality of life, Mikey 2026-11-25): text for messages and
-- emails written once and used again, with {first name}, {client}, {project}
-- and {me} filled in where it's used. Everyone in HQ shares one list.
create table saved_reply (
  id          text primary key,
  title       text not null check (length(title) between 1 and 80),
  body        text not null check (length(body) between 1 and 5000),
  created_by  text not null references user (id),
  created_at  text not null,
  updated_at  text not null,
  removed_at  text
) strict;
