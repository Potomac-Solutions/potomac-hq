-- The Trash (decision 0023). Deleting a client, contact, deal, proposal or
-- project moves it, with everything that belongs to it, into one trash row:
-- a copy of every row, kept for 30 days so it can be put back, then purged.
create table trash (
  id          text primary key,
  kind        text not null check (kind in ('client', 'contact', 'opportunity', 'proposal', 'project')),
  record_id   text not null,
  label       text not null check (length(label) > 0),
  -- The client it was at, for a contact, deal, proposal or project. Empty for a client itself or company work.
  client_name text not null default '',
  -- What went with it, as counts by kind ({"invoice": 2, "task": 14}).
  summary     text not null check (json_valid(summary)),
  -- Every row, and every link that was cleared, to put back on restore.
  snapshot    text not null check (json_valid(snapshot)),
  deleted_by  text not null references user (id),
  deleted_at  text not null
) strict;

create index trash_by_time on trash (deleted_at);

-- A sent proposal version can't be changed or deleted (0006). The one
-- exception is moving a whole proposal to the Trash, or purging it from
-- there: the engine holds this lock, inside its transaction, while it does.
create table record_delete_lock (
  one integer primary key check (one = 1)
) strict;

drop trigger proposal_version_no_delete;
create trigger proposal_version_no_delete before delete on proposal_version
when not exists (select 1 from record_delete_lock)
begin
  select raise(abort, 'proposal_version is immutable: a sent version cannot be deleted');
end;

-- Deleting and restoring (docs/authorization-matrix.md). Admins only.
insert into role_permission (role_id, permission)
select role.id, 'record.delete'
  from role
 where role.key = 'admin';
