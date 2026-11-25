-- n8n automations run for clients (decision 0013, section 5), with the runs
-- each has checked in with. Only a hash of each one's secret address is kept.
create table automation (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  name             text not null check (length(name) between 1 and 80),
  description      text not null default '' check (length(description) <= 500),
  n8n_url          text not null default '' check (length(n8n_url) <= 300),
  every_minutes    integer not null check (every_minutes in (5, 15, 30, 60, 180, 360, 720, 1440, 10080)),
  active           integer not null check (active in (0, 1)),
  state            text not null check (state in ('waiting', 'ok', 'failed', 'late')),
  alerted          text not null check (alerted in ('waiting', 'ok', 'failed', 'late')),
  last_run_at      text,
  last_message     text not null default '' check (length(last_message) <= 300),
  token_hash       text not null unique,
  created_at       text not null,
  updated_at       text not null
) strict;

create index automation_by_organization on automation (organization_id);

create table automation_run (
  automation_id  text not null references automation (id) on delete cascade,
  ran_at         text not null,
  status         text not null check (status in ('ok', 'failed')),
  message        text not null default '' check (length(message) <= 300)
) strict;

create index automation_run_by_automation on automation_run (automation_id, ran_at);

insert into role_permission (role_id, permission)
select role.id, 'automation.manage' from role where role.key in ('admin', 'manager');
