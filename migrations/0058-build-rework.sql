-- Reworking a site that already exists (decision 0010, slice 3): where a
-- build was started from, and the old site's text, read once and shown to
-- Claude while the build has no files of its own.
alter table build add column reference_from text not null default '';
alter table build add column reference text not null default '';
