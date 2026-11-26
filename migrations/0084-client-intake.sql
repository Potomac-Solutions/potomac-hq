-- The new-client intake (2026-11-26): what Potomac needs to build a client's
-- site, asked once in the portal. One per client; sending it again replaces
-- it. Never passwords: the form says so and HQ refuses text that looks like one.
create table client_intake (
  organization_id text primary key references client_organization (id),
  answers         text not null check (json_valid(answers) and length(answers) <= 20000),
  sent_by         text not null references client_user (id),
  sent_at         text not null,
  updated_at      text not null
) strict;
