-- The work table (decision 0007, section 3): saved filters, and each
-- person's choice of columns. A filter is kept as its address (the fields
-- of the work page's form), never as anything that is run.
create table saved_filter (
  id         text primary key,
  owner_id   text not null references user (id),
  name       text not null check (length(trim(name)) between 1 and 60),
  query      text not null check (length(query) between 1 and 4000),
  shared     integer not null default 0 check (shared in (0, 1)),
  pinned     integer not null default 0 check (pinned in (0, 1)),
  created_at text not null,
  updated_at text not null
) strict;
create index saved_filter_by_owner on saved_filter (owner_id);

create table work_view (
  user_id    text primary key references user (id),
  -- The chosen columns, comma separated, in no particular order.
  columns    text not null,
  updated_at text not null
) strict;
