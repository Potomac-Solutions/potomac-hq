-- "Notes from the river", the newsletter (decision 0013, section 1).

-- One row per address ever signed up. Once someone leaves, their email and
-- name are cleared and only the hash stays, so they are never mailed again by
-- mistake (docs/retention-policy.md).
create table newsletter_subscriber (
  id                  text primary key,
  email               text check (email is null or length(email) between 3 and 254),
  email_hash          text not null unique,
  name                text check (name is null or length(name) between 1 and 80),
  stop                text not null check (stop in ('mountains', 'lakes', 'roadside', 'history', 'enterprise', 'general')),
  status              text not null check (status in ('pending', 'subscribed', 'unsubscribed')),
  source              text not null check (source in ('site', 'page')),
  -- Only a hash of the confirm link is kept, and only until it is used.
  confirm_hash        text unique,
  confirm_expires_at  text,
  -- In every issue's unsubscribe link. It only ever takes someone off.
  unsubscribe_token   text not null unique,
  confirmed_at        text,
  unsubscribed_at     text,
  created_at          text not null,
  updated_at          text not null,
  check (status = 'unsubscribed' or email is not null),
  check (status <> 'unsubscribed' or (email is null and name is null))
) strict;

create index newsletter_subscriber_by_status on newsletter_subscriber (status, stop);

create table newsletter_issue (
  id           text primary key,
  subject      text not null check (length(subject) between 1 and 120),
  body         text not null check (length(body) between 1 and 20000),
  -- The stops it goes to, as a JSON array. Empty: everyone.
  stops        text not null check (json_valid(stops) and json_type(stops) = 'array'),
  status       text not null check (status in ('draft', 'sending', 'sent')),
  created_by   text not null references user (id),
  started_at   text,
  finished_at  text,
  created_at   text not null,
  updated_at   text not null
) strict;

-- Each reader of an issue, and whether it reached them. Marked before the
-- next is sent, so a restart never sends twice.
create table newsletter_send (
  issue_id       text not null references newsletter_issue (id) on delete cascade,
  subscriber_id  text not null,
  status         text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  queued_at      text not null,
  done_at        text,
  primary key (issue_id, subscriber_id)
) strict;

create index newsletter_send_pending on newsletter_send (issue_id, status, queued_at);

-- The list and its issues are for managers and admins
-- (docs/authorization-matrix.md).
insert into role_permission (role_id, permission)
select role.id, 'newsletter.manage' from role where role.key in ('admin', 'manager');
