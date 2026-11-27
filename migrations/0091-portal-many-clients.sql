-- One person, more than one client (decision 0022). A client user stays one
-- person's access to one client; the same email may now hold that access at
-- several clients, all signing in with the one portal account. So email and
-- portal account are no longer unique on their own: an email is unique within
-- a client. SQLite can't drop a column's `unique`, so the table is rebuilt
-- with every row kept as it was.
--
-- This runs inside the migration's transaction with foreign keys on, where
-- they can't be turned off. Deferring them lets the old table go before its
-- rows are back, as in 0089: updates, calls, bookings and the rest point at
-- client user ids, and each one is answered again when the rows return.
pragma defer_foreign_keys = on;

create table client_user_before_many as select * from client_user;

create table client_user_next (
  id              text primary key,
  organization_id text not null references client_organization (id),
  -- The portal account they sign in with. Empty until they accept the invite.
  -- One account may hold access at several clients.
  portal_account  text,
  name            text not null check (length(trim(name)) > 0),
  email           text not null check (email = lower(email) and email like '%_@_%'),
  status          text not null check (status in ('invited', 'active', 'disabled')),
  invited_by      text not null references user (id),
  created_at      text not null,
  updated_at      text not null,
  notices         integer not null default 1 check (notices in (0, 1)),
  check (status <> 'active' or portal_account is not null),
  unique (organization_id, email)
) strict;

drop table client_user;
alter table client_user_next rename to client_user;

insert into client_user (id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at, notices)
select id, organization_id, portal_account, name, email, status, invited_by, created_at, updated_at, notices
  from client_user_before_many;
drop table client_user_before_many;

create index client_user_by_organization on client_user (organization_id);
create index client_user_by_email on client_user (email);
create index client_user_by_account on client_user (portal_account) where portal_account is not null;
