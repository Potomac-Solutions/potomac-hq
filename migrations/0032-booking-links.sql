-- Booking links: a link Potomac gives someone so they can book a call
-- without a portal account. Its token is in the address and lets its holder
-- do one thing: book a call in the open times. It is kept as it is, so the
-- link can be copied again from the Calls page.
create table booking_link (
  id          text primary key,
  token       text not null unique check (length(token) between 20 and 64),
  -- Who it was made for, in Potomac's words: "Dana at Elk Diner".
  label       text not null check (length(label) between 1 and 80),
  -- 1: it books one call, then stops working.
  one_time    integer not null default 0 check (one_time in (0, 1)),
  -- The last day it works; null for no end.
  last_day    text,
  uses        integer not null default 0 check (uses >= 0),
  withdrawn_at text,
  created_by  text not null references user (id),
  created_at  text not null
) strict;

-- A call booked with a link remembers which, and the business they named.
alter table booking add column link_id text references booking_link (id);
alter table booking add column business text not null default '' check (length(business) <= 120);
