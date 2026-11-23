-- Reminders emailed to clients about invoices coming due and overdue
-- (docs/data-model.md, "Invoice reminders"). Off until someone turns them on.
create table finance_setting (
  id            integer primary key check (id = 1),
  reminders_on  integer not null check (reminders_on in (0, 1)),
  updated_by    text not null references user (id),
  updated_at    text not null
) strict;

-- Each reminder an invoice was sent, at most one of each kind.
create table invoice_reminder (
  invoice_id  text not null references invoice (id),
  kind        text not null check (kind in ('soon', 'due', 'late-7', 'late-14')),
  sent_at     text not null,
  sent_to     text not null check (length(sent_to) <= 1000),
  primary key (invoice_id, kind)
) strict;

-- Invoices someone stopped reminders for.
create table invoice_reminder_off (
  invoice_id  text primary key references invoice (id),
  set_by      text not null references user (id),
  set_at      text not null
) strict;
