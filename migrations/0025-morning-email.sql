-- The morning email of the Today list: on unless someone turns it off, and
-- a record of each day it went, so a restart never sends it twice.
alter table user_preference add column morning_email integer not null default 1 check (morning_email in (0, 1));

create table morning_email_sent (
  user_id text not null references user (id),
  day text not null,
  sent_at text not null,
  primary key (user_id, day)
) strict;
