-- The portal, after a pass as four clients (docs/scope-v0.3-v1.0.md, "The
-- portal, as a client").

-- A client can send a file on one of their projects: photos, a menu, a price
-- list. Exactly one of uploaded_by and uploaded_by_client is set on a file
-- someone sent in. Older files have neither when HQ itself made them.
alter table file add column uploaded_by_client text references client_user (id);

create index file_by_owner_kind on file (owner_type, owner_id, created_at);

-- The number to call back on, as the client typed it.
alter table call_request add column phone text not null default '';
