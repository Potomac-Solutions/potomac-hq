-- Scheduling invites: Potomac asks someone in the portal to paint the times
-- they could do over a few days, like a Timeful poll over Potomac's own
-- availability, then confirms one, which books the call.
create table schedule_invite (
  id text primary key,
  organization_id text not null references client_organization (id),
  client_user_id text not null references client_user (id),
  title text not null check (length(title) between 1 and 80),
  minutes integer not null check (minutes in (15, 20, 30, 45, 60, 90)),
  first_day text not null,
  last_day text not null,
  note text not null default '' check (length(note) <= 500),
  status text not null check (status in ('open', 'confirmed', 'cancelled')),
  answered_at text,
  booking_id text references booking (id),
  created_by text not null references user (id),
  created_at text not null,
  updated_at text not null
) strict;
create index schedule_invite_by_organization on schedule_invite (organization_id, status);

-- The half hours the invitee said they could do: the start of each, in UTC.
create table schedule_invite_cell (
  invite_id text not null references schedule_invite (id) on delete cascade,
  start text not null,
  primary key (invite_id, start)
) strict;
