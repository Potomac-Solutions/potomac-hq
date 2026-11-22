-- The portal, second pass (docs/scope-v0.3-v1.0.md, "The portal, as a
-- client, second pass").

-- A milestone can be the client's to do: photos to send, a price list, a
-- decision. The portal then lists it under "waiting on you".
alter table milestone add column for_client integer not null default 0 check (for_client in (0, 1));

-- A client user can turn off the email that says something is waiting.
alter table client_user add column notices integer not null default 1 check (notices in (0, 1));

-- How far through the activity log the notice sender has read. One row.
-- Events are read in the order they were written, by rowid. It starts at
-- the end of the log as it is now, so turning notices on never emails
-- anyone about the past.
create table notice_cursor (
  id          integer primary key check (id = 1),
  last_rowid  integer not null check (last_rowid >= 0),
  updated_at  text not null
) strict;

insert into notice_cursor (id, last_rowid, updated_at)
select 1, coalesce(max(rowid), 0), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from activity_event;
