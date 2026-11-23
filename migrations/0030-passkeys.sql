-- Passkeys as a second step at sign-in (WebAuthn). A person can turn
-- two-factor sign-in on with a passkey alone, or add passkeys beside their
-- authenticator app.

-- 0 when two-factor was turned on with a passkey and no authenticator app:
-- the secret was never shown to anyone, so no code from an app is accepted.
alter table user_two_factor add column app integer not null default 1 check (app in (0, 1));

create table passkey (
  id            text primary key,
  user_id       text not null references user (id),
  -- The credential's id from the authenticator, base64url.
  credential_id text not null unique check (length(credential_id) between 16 and 1400),
  -- The public key as a JWK, and the COSE algorithm it signs with
  -- (-7 ES256, -257 RS256, -8 EdDSA). Public: nothing here signs anything.
  public_key    text not null,
  algorithm     integer not null check (algorithm in (-7, -257, -8)),
  -- The authenticator's signature counter; 0 when it keeps none.
  sign_count    integer not null default 0 check (sign_count >= 0),
  label         text not null check (length(label) between 1 and 60),
  created_at    text not null,
  last_used_at  text
) strict;
create index passkey_by_user on passkey (user_id);

-- The challenge a session was last given, for one use within five minutes.
create table passkey_challenge (
  session_hash  text primary key,
  user_id       text not null references user (id),
  purpose       text not null check (purpose in ('register', 'verify')),
  challenge     text not null,
  expires_at    text not null
) strict;
