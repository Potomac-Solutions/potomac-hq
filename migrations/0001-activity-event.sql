-- The audit record (docs/data-model.md, "Activity Event"). Append-only: the
-- triggers below reject every update and delete, whoever asks.
--
-- actor_id is deliberately not a foreign key. The audit table must accept an
-- event for any actor and must never be the reason a change is refused. Users
-- are disabled, never deleted, so the id always resolves.

create table activity_event (
  id          text primary key,
  occurred_at text not null,
  actor_id    text,
  action      text not null check (length(action) > 0),
  record_type text not null check (length(record_type) > 0),
  record_id   text not null check (length(record_id) > 0),
  context     text not null default '{}' check (json_valid(context) and json_type(context) = 'object')
) strict;

create index activity_event_by_time on activity_event (occurred_at);
create index activity_event_by_record on activity_event (record_type, record_id, occurred_at);

create trigger activity_event_no_update
before update on activity_event
begin
  select raise(abort, 'activity_event is append-only');
end;

create trigger activity_event_no_delete
before delete on activity_event
begin
  select raise(abort, 'activity_event is append-only');
end;

-- "insert or replace" removes the old row without firing the delete trigger,
-- so an existing id is refused before SQLite gets that far.
create trigger activity_event_no_replace
before insert on activity_event
when exists (select 1 from activity_event where id = new.id)
begin
  select raise(abort, 'activity_event is append-only');
end;
