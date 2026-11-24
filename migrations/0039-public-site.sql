-- The public website's mode (open, coming soon, maintenance), its message and
-- announcement banner, and the hash of the token the website uses to ask HQ.
-- One row. A new install leaves the website open.
create table public_site_settings (
  id integer primary key check (id = 1),
  mode text not null default 'live' check (mode in ('live', 'coming-soon', 'maintenance')),
  title text not null default '',
  message text not null default '',
  eta text not null default '',
  banner_text text not null default '',
  banner_link_text text not null default '',
  banner_href text not null default '',
  preview_token text not null default '',
  token_hash text not null default '',
  updated_at text not null default ''
) strict;
insert into public_site_settings (id) values (1);

insert into role_permission (role_id, permission) select role.id, 'public-site.view' from role where role.key = 'admin';
insert into role_permission (role_id, permission) select role.id, 'public-site.edit' from role where role.key = 'admin';
