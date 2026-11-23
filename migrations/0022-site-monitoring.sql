-- Site monitoring (docs/data-model.md, "Site monitoring"): client websites
-- HQ checks every few minutes, and their outages.
create table monitored_site (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  url              text not null check (length(url) between 8 and 300),
  active           integer not null check (active in (0, 1)),
  state            text not null check (state in ('unknown', 'up', 'down')),
  failures         integer not null default 0 check (failures >= 0),
  down_since       text,
  last_checked_at  text,
  last_result      text not null default '' check (length(last_result) <= 200),
  cert_expires_on  text,
  cert_warned_for  text,
  created_at       text not null,
  updated_at       text not null
) strict;

create index monitored_site_by_organization on monitored_site (organization_id);

create table site_outage (
  site_id     text not null references monitored_site (id),
  started_at  text not null,
  ended_at    text,
  reason      text not null check (length(reason) <= 200),
  primary key (site_id, started_at)
) strict;
