-- Decision 0007, section 10: each person's calendar address. Only a hash of
-- its secret is kept; the address is shown once. Making a new one replaces
-- the old, which stops working. A feed may follow one of the person's saved
-- filters; deleting the filter puts the feed back to its usual contents.
create table calendar_feed (
  user_id      text primary key references user (id),
  token_hash   text not null unique,
  filter_id    text references saved_filter (id) on delete set null,
  created_at   text not null,
  last_used_at text
) strict;
