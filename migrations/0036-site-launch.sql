-- A site's status (docs/decisions/0004-site-launch.md): whether it is open
-- to everyone, coming soon or closed for maintenance, when it opens by
-- itself, its own address, and the key in its preview link.
alter table content_site add column site_url text not null default '' check (length(site_url) <= 200);
alter table content_site add column launch_mode text not null default 'live' check (launch_mode in ('live', 'coming-soon', 'maintenance'));
alter table content_site add column opens_at text;
alter table content_site add column launch_message text not null default '' check (length(launch_message) <= 200);
alter table content_site add column preview_key text check (preview_key is null or length(preview_key) = 32);
