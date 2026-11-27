-- QR codes a client prints, counted from their own site (decision 0024). A
-- code is an address on the client's site, so a scan never passes through
-- HQ; a script on the site reports scans and taps here.
create table site_qr_code (
  id                      text primary key,
  organization_id         text not null references client_organization (id),
  -- The ref in the address. Printed, so it never changes.
  code                    text not null check (length(code) between 2 and 32),
  label                   text not null check (length(trim(label)) between 1 and 120),
  -- The site's origin and the page on it. Printed, so they never change.
  site                    text not null check (site like 'https://%' and length(site) <= 200),
  page                    text not null check (page like '/%' and length(page) <= 120),
  retired                 integer not null default 0 check (retired in (0, 1)),
  -- Made by one of Potomac's people, or by a client person in the portal.
  created_by              text references user (id),
  created_by_client_user  text references client_user (id),
  created_at              text not null,
  updated_at              text not null,
  check ((created_by is null) <> (created_by_client_user is null)),
  unique (organization_id, code)
) strict;

-- One row a scan or a tap after one: what and when, and nothing about who.
create table site_qr_event (
  code_id      text not null references site_qr_code (id) on delete cascade,
  kind         text not null check (kind in ('scan', 'call', 'text', 'email')),
  happened_at  text not null,
  received_at  text not null
) strict;

create index site_qr_event_by_code on site_qr_event (code_id, kind, happened_at);

-- Making a client's QR codes in HQ (docs/authorization-matrix.md). Every
-- role: it's client-service work, like a free landing page's rounds.
insert into role_permission (role_id, permission)
select role.id, 'site-qr.manage' from role where role.key in ('admin', 'manager', 'member');
