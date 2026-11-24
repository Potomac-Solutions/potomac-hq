-- Decision 0007, section 12: webhooks. An admin's https address and the
-- events it's sent. The signing secret is never stored: it's worked out from
-- HQ's key and `salt`, and a new salt makes a new secret.
create table webhook (
  id         text primary key,
  url        text not null check (url like 'https://%' and length(url) <= 500),
  events     text not null check (json_valid(events) and json_array_length(events) > 0),
  paused     integer not null default 0 check (paused in (0, 1)),
  salt       text not null,
  created_by text not null references user (id),
  created_at text not null
) strict;

-- Each delivery, queued with the event that made it and kept with its last
-- answer: the newest 200 per webhook.
create table webhook_delivery (
  id            text primary key,
  webhook_id    text not null references webhook (id) on delete cascade,
  event         text not null,
  payload       text not null,
  created_at    text not null,
  state         text not null check (state in ('pending', 'delivered', 'failed')),
  attempts      integer not null default 0,
  next_at       text,
  last_tried_at text,
  last_status   integer,
  last_answer   text not null default ''
) strict;
create index webhook_delivery_due on webhook_delivery (next_at) where state = 'pending';
create index webhook_delivery_by_webhook on webhook_delivery (webhook_id, created_at);

insert into role_permission (role_id, permission) select role.id, 'webhook.manage' from role where role.key = 'admin';
