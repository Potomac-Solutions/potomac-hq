-- Late fees and a call when an invoice is long overdue (2026-11-26). A late
-- fee is off until someone sets one. When on, an invoice that is a set
-- number of days late gets one late fee, once, as its own invoice. A late
-- fee is never charged on a late fee. At two weeks late, whoever made the
-- invoice gets a to-do to call the client, once per invoice.
create table late_fee_setting (
  id          integer primary key check (id = 1),
  kind        text not null check (kind in ('off', 'percent', 'flat')),
  -- Basis points for a percent (150 = 1.5%), cents for a flat fee.
  amount      integer not null check (amount >= 0 and amount <= 100000),
  after_days  integer not null check (after_days between 1 and 120),
  updated_by  text not null references user (id),
  updated_at  text not null
) strict;

create table invoice_late_fee (
  invoice_id      text primary key references invoice (id),
  fee_invoice_id  text not null unique references invoice (id),
  charged_on      text not null
) strict;

create table invoice_late_call (
  invoice_id text primary key references invoice (id),
  todo_id    text references task (id),
  made_at    text not null
) strict;
