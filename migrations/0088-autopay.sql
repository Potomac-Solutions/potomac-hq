-- Automatic payment of plan invoices (2026-11-26). A client person saves a
-- payment method at the platform (PayPal's vault) from the portal; each plan
-- invoice is then charged on the day it's sent. Each try is kept, written
-- before the platform is asked, so a try whose answer was lost is never
-- repeated on its own: it becomes a to-do instead.
create table autopay (
  organization_id text primary key references client_organization (id),
  platform        text not null check (length(platform) > 0),
  -- The platform's saved-method token, once the client has approved it.
  token           text,
  -- Who and how it's labelled to the client, like their PayPal email.
  label           text not null default '' check (length(label) <= 200),
  -- The platform's setup step, while the client is away approving it.
  setup_ref       text,
  -- Where the client approves it at the platform, while they are away.
  setup_url       text,
  set_up_by       text references client_user (id),
  set_up_at       text,
  stopped_at      text,
  updated_at      text not null
) strict;

create table autopay_charge (
  id          text primary key,
  invoice_id  text not null references invoice (id),
  owed_minor  integer not null check (owed_minor > 0),
  tried_on    text not null check (tried_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  outcome     text not null check (outcome in ('trying', 'paid', 'declined', 'unknown')),
  reference   text not null default '' check (length(reference) <= 100),
  reason      text not null default '' check (length(reason) <= 200),
  created_at  text not null,
  unique (invoice_id, tried_on)
) strict;
create index autopay_charge_by_invoice on autopay_charge (invoice_id, tried_on);
