-- The Trash takes a portal person too (decision 0023, amended): deleting one
-- of a client's portal people moves them, with what they sent from the
-- portal, into the Trash. SQLite can't change a check, so the table is
-- rebuilt with the new kind allowed and its rows copied across.
pragma defer_foreign_keys = on;

create table trash_next (
  id          text primary key,
  kind        text not null check (kind in ('client', 'contact', 'opportunity', 'proposal', 'project', 'portal-person')),
  record_id   text not null,
  label       text not null check (length(label) > 0),
  -- The client it was at, for a contact, deal, proposal, project or portal person. Empty for a client itself or company work.
  client_name text not null default '',
  -- What went with it, as counts by kind ({"invoice": 2, "task": 14}).
  summary     text not null check (json_valid(summary)),
  -- Every row, and every link that was cleared, to put back on restore.
  snapshot    text not null check (json_valid(snapshot)),
  deleted_by  text not null references user (id),
  deleted_at  text not null
) strict;

insert into trash_next (id, kind, record_id, label, client_name, summary, snapshot, deleted_by, deleted_at)
select id, kind, record_id, label, client_name, summary, snapshot, deleted_by, deleted_at from trash;

drop table trash;
alter table trash_next rename to trash;
create index trash_by_time on trash (deleted_at);
