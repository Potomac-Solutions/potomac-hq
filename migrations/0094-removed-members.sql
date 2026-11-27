-- Removing a member from HQ (decision 0025). A removed user's row stays, so
-- every record they made still names them; it is turned off, has no roles,
-- and their email is replaced, so the address can be invited again.
alter table user add column removed_at text;

-- Only admins remove people (docs/authorization-matrix.md).
insert into role_permission (role_id, permission) values
  ('00000000-0000-4000-8000-0000000000a1', 'user.remove');
