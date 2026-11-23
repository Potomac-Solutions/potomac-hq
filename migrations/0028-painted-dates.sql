-- Days painted differently from the usual week on the availability grid. A
-- day listed here uses its own stretches (none: no calls that day) instead of
-- its weekday's.
create table booking_date (
  day text primary key check (day glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  updated_at text not null
) strict;

create table booking_date_hours (
  day text not null references booking_date (day) on delete cascade,
  start integer not null check (start between 0 and 1440),
  end integer not null check (end between 0 and 1440 and end > start),
  primary key (day, start)
) strict;
