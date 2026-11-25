-- Undo (decision 0014): the post that reverses a change, kept here so the
-- address of the page that follows carries only a short token. Old values of
-- any length (a task's description, a lost reason) fit. A token is used once
-- and is good for a day; older rows are cleared as new ones are written.
create table undo_stash (
  token text primary key check (length(token) = 32),
  action text not null check (length(action) between 2 and 200 and substr(action, 1, 1) = '/'),
  fields text not null check (json_valid(fields)),
  created_at text not null
) strict;
create index undo_stash_created on undo_stash (created_at);
