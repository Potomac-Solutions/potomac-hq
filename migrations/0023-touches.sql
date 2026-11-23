-- Touches (docs/data-model.md, "Touches"): each call, email, text or meeting
-- with someone at a client, with how it went.
create table touch (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  opportunity_id   text references opportunity (id),
  contact_id       text references contact (id),
  kind             text not null check (kind in ('call', 'email', 'text', 'meeting')),
  outcome          text check (outcome is null or outcome in ('reached', 'voicemail', 'no-answer')),
  note             text not null default '' check (length(note) <= 2000),
  happened_at      text not null,
  user_id          text not null references user (id),
  created_at       text not null
) strict;

create index touch_by_organization on touch (organization_id, happened_at);
create index touch_by_opportunity on touch (opportunity_id, happened_at);
