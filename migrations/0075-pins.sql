-- Decision 0015, follow-up: pages each person pins to the top of their
-- sidebar. The label is what the page was called when it was pinned.
-- Numbered after #166's 0072 and 0073, which merge first.
create table nav_pin (
  user_id  text not null references user (id),
  href     text not null check (length(href) between 1 and 300 and substr(href, 1, 1) = '/'),
  label    text not null check (length(label) between 1 and 120),
  at       text not null,
  primary key (user_id, href)
) strict;
