-- Renewals (docs/data-model.md, "Renewals"): a client's domains, hosting,
-- certificates and licenses, and when each renews.
create table renewal (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  kind             text not null check (kind in ('domain', 'hosting', 'ssl', 'email', 'software', 'other')),
  name             text not null check (length(name) between 1 and 120),
  provider         text not null default '' check (length(provider) <= 80),
  renews_on        text not null check (renews_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  term_months      integer not null check (term_months in (1, 3, 6, 12, 24, 36, 60, 120)),
  cost_minor       integer check (cost_minor is null or cost_minor >= 0),
  price_minor      integer check (price_minor is null or price_minor >= 0),
  auto_renews      integer not null check (auto_renews in (0, 1)),
  note             text not null default '' check (length(note) <= 500),
  active           integer not null check (active in (0, 1)),
  created_at       text not null,
  updated_at       text not null
) strict;

create index renewal_by_organization on renewal (organization_id);
create index renewal_by_date on renewal (active, renews_on);
