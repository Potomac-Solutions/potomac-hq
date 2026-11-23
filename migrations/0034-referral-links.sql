-- Referral links (docs/data-model-after-1.0.md, "Referral links"): a short
-- address printed as a QR code, the scans it gets, and the inquiries that
-- followed a scan.
create table referral_link (
  id           text primary key,
  -- The end of /r/<code>. Printed, so it never changes.
  code         text not null unique check (length(code) between 2 and 32),
  label        text not null check (length(trim(label)) between 1 and 120),
  destination  text not null check (length(destination) between 1 and 300),
  created_by   text not null references user (id),
  created_at   text not null,
  updated_at   text not null
) strict;

-- One row a scan: when, and nothing about who.
create table referral_scan (
  link_id     text not null references referral_link (id) on delete cascade,
  scanned_at  text not null
) strict;

create index referral_scan_by_link on referral_scan (link_id, scanned_at);

-- An opportunity that arrived carrying a link's code. Credited once.
create table referral_inquiry (
  opportunity_id  text primary key references opportunity (id),
  link_id         text not null references referral_link (id),
  received_at     text not null
) strict;

create index referral_inquiry_by_link on referral_inquiry (link_id);

-- Making and seeing referral links is for managers and admins
-- (docs/authorization-matrix.md).
insert into role_permission (role_id, permission)
select role.id, 'referral.manage' from role where role.key in ('admin', 'manager');
