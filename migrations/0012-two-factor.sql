-- Two-factor sign-in for HQ accounts (docs/data-model.md, "Two-factor
-- sign-in"). A code from an authenticator app, after the password.

-- One per user who has started or finished turning it on.
create table user_two_factor (
  user_id       text primary key references user (id),
  -- The shared secret, base32. The database is HQ's trust boundary, and
  -- backups of it are sealed (docs/decisions/0001-stack.md).
  secret        text not null check (length(secret) >= 32),
  -- Empty until the person proves their app works by typing a code.
  confirmed_at  text,
  -- The last 30-second step a code was accepted for. A code is never accepted twice.
  last_step     integer not null default 0 check (last_step >= 0),
  created_at    text not null,
  updated_at    text not null
) strict;

-- Codes for when the phone is lost. Each works once. Only a hash is kept.
create table two_factor_recovery (
  user_id    text not null references user (id),
  code_hash  text not null,
  used_at    text,
  primary key (user_id, code_hash)
) strict;

-- A sign-in session that has passed the second step. Keyed the way the
-- kit keys the session itself (a hash of its id), so it ends with it.
create table two_factor_session (
  session_hash  text primary key,
  user_id       text not null references user (id),
  verified_at   text not null
) strict;

create index two_factor_session_by_user on two_factor_session (user_id);
