-- Phone alerts (quality of life, Mikey 2026-11-25). A person turns alerts on
-- per device; each device's push subscription is kept here. Alerts wait in a
-- queue, one row per person per thing, so nothing is sent twice; quiet hours
-- hold them, and one older than 12 hours is dropped rather than sent late.
create table push_subscription (
  id          text primary key,
  user_id     text not null references user (id),
  endpoint    text not null unique check (length(endpoint) between 10 and 1000 and substr(endpoint, 1, 8) = 'https://'),
  p256dh      text not null check (length(p256dh) between 40 and 200),
  auth        text not null check (length(auth) between 10 and 100),
  label       text not null default '' check (length(label) <= 100),
  created_at  text not null,
  last_ok_at  text,
  failures    integer not null default 0
) strict;
create index push_subscription_by_user on push_subscription (user_id);

create table push_queue (
  id          text primary key,
  user_id     text not null references user (id),
  -- What it's about, so the same thing is never queued twice for one person.
  key         text not null,
  title       text not null check (length(title) between 1 and 120),
  body        text not null default '' check (length(body) <= 300),
  url         text not null check (substr(url, 1, 1) = '/'),
  created_at  text not null,
  sent_at     text,
  dropped_at  text,
  unique (user_id, key)
) strict;
create index push_queue_waiting on push_queue (created_at) where sent_at is null and dropped_at is null;
