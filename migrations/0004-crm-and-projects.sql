-- The first slice's records (docs/data-model.md): client organizations, their
-- contacts, opportunities, and the project stub a won opportunity becomes.
-- Nothing here is deleted: a client becomes former, an opportunity lost, a
-- project cancelled.

create table client_organization (
  id         text primary key,
  name       text not null check (length(trim(name)) > 0),
  status     text not null check (status in ('prospective', 'active', 'inactive', 'former')),
  size_tier  text check (size_tier is null or size_tier in ('small', 'established', 'large')),
  website    text,
  phone      text,
  address    text,
  created_at text not null,
  updated_at text not null
) strict;

create table contact (
  id              text primary key,
  organization_id text not null references client_organization (id),
  name            text not null check (length(trim(name)) > 0),
  email           text check (email is null or email = lower(email)),
  phone           text,
  title           text,
  is_primary      integer not null default 0 check (is_primary in (0, 1)),
  created_at      text not null,
  updated_at      text not null,
  check (email is not null or phone is not null)
) strict;

create index contact_by_organization on contact (organization_id);
create unique index contact_one_primary on contact (organization_id) where is_primary = 1;

create table opportunity (
  id              text primary key,
  organization_id text not null references client_organization (id),
  contact_id      text references contact (id),
  owner_id        text not null references user (id),
  title           text not null check (length(trim(title)) > 0),
  service         text check (service is null or service in ('consulting', 'landing-page', 'domain-management', 'website', 'blog', 'social-media', 'application', 'automation')),
  stage           text not null check (stage in ('new', 'consult-booked', 'consulted', 'quoted', 'won', 'lost')),
  pricing         text check (pricing is null or pricing in ('free', 'hourly', 'fixed', 'monthly', 'yearly')),
  value_minor     integer check (value_minor is null or value_minor >= 0),
  currency        text not null default 'USD' check (currency = 'USD'),
  lead_source     text not null check (lead_source in ('word-of-mouth', 'phone', 'email', 'website', 'social', 'referral', 'other')),
  follow_up_on    text check (follow_up_on is null or follow_up_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  summary         text not null default '',
  lost_reason     text,
  closed_at       text,
  created_at      text not null,
  updated_at      text not null,
  check (stage <> 'lost' or length(trim(coalesce(lost_reason, ''))) > 0),
  check (stage <> 'won' or (service is not null and pricing is not null and value_minor is not null)),
  check ((stage in ('won', 'lost')) = (closed_at is not null)),
  check (pricing <> 'free' or value_minor = 0)
) strict;

create index opportunity_by_organization on opportunity (organization_id);
create index opportunity_follow_ups on opportunity (follow_up_on) where follow_up_on is not null and stage not in ('won', 'lost');

create table project (
  id              text primary key,
  organization_id text not null references client_organization (id),
  opportunity_id  text not null unique references opportunity (id),
  owner_id        text not null references user (id),
  name            text not null check (length(trim(name)) > 0),
  kind            text not null check (kind in ('fixed', 'ongoing')),
  status          text not null check (status in ('active', 'completed', 'cancelled')),
  created_at      text not null,
  updated_at      text not null,
  check (kind <> 'ongoing' or status <> 'completed')
) strict;

create index project_by_organization on project (organization_id);
