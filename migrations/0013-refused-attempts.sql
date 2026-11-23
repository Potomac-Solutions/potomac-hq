-- Refused attempts (docs/data-model.md, "Refused attempts"): wrong
-- passwords, wrong codes and actions someone was not allowed to do. Kept
-- apart from the activity log, which is append-only and kept for good: these
-- can come from anyone on the internet, so they are kept for 90 days.
create table refused_attempt (
  id           text primary key,
  occurred_at  text not null,
  kind         text not null check (kind in ('sign-in', 'second-step', 'portal-sign-in', 'permission')),
  -- The HQ user, when it was someone signed in or past their password.
  user_id      text references user (id),
  -- The email typed at a sign-in. Never the password.
  email        text check (email is null or length(email) <= 254),
  -- Where the request came from, as HQ sees it behind its proxies.
  address      text not null check (length(address) <= 64),
  -- What was refused: "wrong", "locked", or for a permission, the form, like "POST /people/:id/roles".
  detail       text not null check (length(detail) <= 200)
) strict;

create index refused_attempt_by_time on refused_attempt (occurred_at);
