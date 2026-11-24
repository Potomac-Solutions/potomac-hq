-- A website's service area (docs/decisions/0005-service-area.md): where the
-- business goes, as named outlines, as last written to the site's content
-- file. Null for a site whose file has no service area.
alter table content_site add column service_area text check (service_area is null or json_valid(service_area));
