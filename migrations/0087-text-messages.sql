-- Text message reminders (2026-11-26). A client person agrees to texts in
-- the portal, with their mobile number; replying STOP (or turning it off in
-- the portal) ends it. Each text sent is logged.
create table text_consent (
  client_user_id  text primary key references client_user (id),
  organization_id text not null references client_organization (id),
  phone           text not null check (phone glob '+1[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  agreed_at       text not null,
  stopped_at      text,
  stopped_by      text check (stopped_by in ('portal', 'reply-stop'))
) strict;
create index text_consent_by_organization on text_consent (organization_id);

create table text_sent (
  id              text primary key,
  client_user_id  text not null references client_user (id),
  purpose         text not null check (purpose in ('call-reminder', 'invoice-reminder')),
  body            text not null,
  sent_at         text not null,
  outcome         text not null check (length(outcome) between 1 and 60)
) strict;
create index text_sent_by_person on text_sent (client_user_id, sent_at);
