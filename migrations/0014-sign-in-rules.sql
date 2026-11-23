-- Sign-in rules for the whole of HQ (docs/data-model.md, "Sign-in rules").
-- One row per rule. A rule that has no row is off.
create table sign_in_rule (
  key         text primary key check (key in ('two-factor-for-admins')),
  on_since    text not null,
  set_by      text not null references user (id)
) strict;
