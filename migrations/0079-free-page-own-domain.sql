-- A free landing page on the client's own domain instead of a name on
-- potomac.solutions (Mikey, 2026-11-25: "what if I'm doing a free landing
-- page but they are opting to let me pay for their domain"). A page has one
-- address: a subdomain of potomac.solutions, or its own domain, or none yet.
-- The domain itself is billed as a renewal on the client.
alter table free_page add column own_domain text check (own_domain is null or (length(own_domain) between 4 and 253 and own_domain = lower(own_domain)));
create unique index free_page_by_own_domain on free_page (own_domain) where own_domain is not null;
