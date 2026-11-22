-- Rate limits that last through a restart (security review, known gap 3).
-- One row per limit and key, for the window it is in. The key is hashed:
-- it can hold an email or an address, and only needs to be matched.
create table rate_limit (
  name      text not null check (length(name) between 1 and 40),
  key_hash  text not null check (length(key_hash) = 64),
  count     integer not null check (count >= 1),
  reset_at  integer not null,
  primary key (name, key_hash)
) strict;

create index rate_limit_by_reset on rate_limit (reset_at);
