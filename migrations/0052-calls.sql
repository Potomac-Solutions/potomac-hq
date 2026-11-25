-- Calls (decision 0009, call mode): a call in progress, with its timer kept
-- here so a reload or a dropped signal doesn't lose it, and the call log's
-- touches gaining the length of the call they came from.
create table call (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  contact_id       text references contact (id),
  opportunity_id   text references opportunity (id),
  booking_id       text references booking (id),
  user_id          text not null references user (id),
  -- Who is called, and at what number, as they were when the call started.
  phone            text not null default '' check (length(phone) <= 30),
  started_at       text not null,
  planned_minutes  integer not null check (planned_minutes between 5 and 240),
  warn_minutes     integer not null check (warn_minutes between 1 and 60),
  -- Notes typed during the call, saved as they're typed.
  note             text not null default '' check (length(note) <= 2000),
  ended_at         text,
  touch_id         text references touch (id),
  created_at       text not null
) strict;

-- One open call per person.
create unique index call_open_by_user on call (user_id) where ended_at is null;
create index call_by_organization on call (organization_id, started_at);

alter table touch add column minutes integer check (minutes is null or minutes between 1 and 1440);
alter table touch add column call_id text references call (id);
