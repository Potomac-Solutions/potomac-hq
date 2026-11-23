-- Booking (docs/data-model.md, "Booking"): the hours Potomac takes calls,
-- and the calls booked into them, from the portal or the booking page.

-- One row: the rules, and whose calendar it is.
create table booking_setting (
  id             integer primary key check (id = 1),
  host_id        text not null references user (id),
  call_minutes   integer not null check (call_minutes in (15, 20, 30, 45, 60, 90)),
  gap_minutes    integer not null check (gap_minutes between 0 and 60),
  notice_hours   integer not null check (notice_hours between 0 and 168),
  days_ahead     integer not null check (days_ahead between 1 and 90),
  -- Clients in the portal can book. Off: they ask for a call instead.
  portal_open    integer not null check (portal_open in (0, 1)),
  -- Anyone can book from /book.
  public_open    integer not null check (public_open in (0, 1)),
  updated_at     text not null
) strict;

create table booking_hours (
  weekday  integer not null check (weekday between 1 and 7),
  start    integer not null check (start between 0 and 1440),
  end      integer not null check (end between 0 and 1440 and end > start),
  primary key (weekday, start)
) strict;

create table booking_closed_day (
  day   text primary key check (day glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note  text not null default '' check (length(note) <= 100)
) strict;

create table booking (
  id               text primary key,
  kind             text not null check (kind in ('client', 'public')),
  status           text not null check (status in ('booked', 'cancelled')),
  starts_at        text not null,
  ends_at          text not null,
  name             text not null check (length(name) between 1 and 100),
  email            text not null check (length(email) <= 254),
  phone            text not null default '' check (length(phone) <= 30),
  topic            text not null default '' check (length(topic) <= 1000),
  organization_id  text references client_organization (id),
  client_user_id   text references client_user (id),
  host_id          text not null references user (id),
  -- A hash of the private link someone from the booking page uses to cancel or move it.
  manage_hash      text unique,
  created_at       text not null,
  cancelled_at     text,
  cancelled_by     text check (cancelled_by in ('staff', 'booker')),
  cancel_reason    text not null default '' check (length(cancel_reason) <= 500),
  check ((kind = 'client') = (organization_id is not null and client_user_id is not null))
) strict;

create index booking_by_start on booking (status, starts_at);
create index booking_by_organization on booking (organization_id);

-- Setting the hours is for managers and admins (docs/authorization-matrix.md).
insert into role_permission (role_id, permission)
select role.id, 'booking.manage' from role where role.key in ('admin', 'manager');
