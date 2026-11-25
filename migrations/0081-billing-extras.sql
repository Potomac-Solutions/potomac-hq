-- Billing extras (Mikey, 2026-11-25: "Do all of these"). Decision 0017,
-- third part. One migration for the columns and tables they need:
--
--   * who gets a client's bills: a billing contact;
--   * on an invoice: a promised payment day, a card payment link Potomac
--     makes itself, and a write-off (a void with a reason, kept apart from
--     a mistake);
--   * a renewal's price change, so the client sees what it was;
--   * receipts and monthly statements emailed, once each;
--   * prepaid hours bought by a client;
--   * how clients pay, in Potomac's words, shown in the portal;
--   * recurring invoices on a client with no project (table rebuilt, as
--     0078 did for invoices).
pragma defer_foreign_keys = on;

alter table client_organization add column billing_contact_id text references contact (id);

alter table invoice add column promised_on text check (promised_on is null or promised_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
alter table invoice add column promise_note text not null default '' check (length(promise_note) <= 300);
alter table invoice add column pay_link text check (pay_link is null or (pay_link like 'https://%' and length(pay_link) <= 500));
alter table invoice add column written_off_on text check (written_off_on is null or written_off_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
alter table invoice add column written_off_note text not null default '' check (length(written_off_note) <= 300);

alter table renewal add column price_was_minor integer check (price_was_minor is null or price_was_minor >= 0);
alter table renewal add column price_changed_on text check (price_changed_on is null or price_changed_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

create table payment_receipt (
  payment_id text primary key references payment (id),
  sent_at    text not null,
  sent_to    text not null check (length(sent_to) <= 1000)
) strict;

create table client_statement (
  organization_id text not null references client_organization (id),
  month           text not null check (month glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  sent_at         text not null,
  sent_to         text not null check (length(sent_to) <= 1000),
  primary key (organization_id, month)
) strict;

create table prepaid_block (
  id              text primary key,
  organization_id text not null references client_organization (id),
  minutes         integer not null check (minutes > 0 and minutes <= 60000),
  bought_on       text not null check (bought_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  invoice_id      text references invoice (id),
  note            text not null default '' check (length(note) <= 300),
  created_by      text not null references user (id),
  created_at      text not null
) strict;
create index prepaid_block_by_client on prepaid_block (organization_id);

alter table finance_setting add column pay_instructions text not null default '' check (length(pay_instructions) <= 2000);

create table recurring_before_clients as select * from recurring_invoice;
create table recurring_next (
  id              text primary key,
  organization_id text not null references client_organization (id),
  project_id      text references project (id),
  description     text not null check (length(description) between 1 and 200),
  amount_minor    integer not null check (amount_minor > 0),
  currency        text not null default 'USD' check (currency = 'USD'),
  every           text not null check (every in ('month', 'quarter', 'year')),
  anchor_day      integer not null check (anchor_day between 1 and 31),
  next_on         text not null check (next_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on         text check (ends_on is null or ends_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  auto_send       integer not null check (auto_send in (0, 1)),
  due_days        integer not null check (due_days between 0 and 90),
  active          integer not null check (active in (0, 1)),
  created_by      text not null references user (id),
  created_at      text not null,
  updated_at      text not null
) strict;
drop table recurring_invoice;
alter table recurring_next rename to recurring_invoice;
insert into recurring_invoice (id, organization_id, project_id, description, amount_minor, currency, every, anchor_day, next_on, ends_on, auto_send, due_days, active, created_by, created_at, updated_at)
select r.id, p.organization_id, r.project_id, r.description, r.amount_minor, r.currency, r.every, r.anchor_day, r.next_on, r.ends_on, r.auto_send, r.due_days, r.active, r.created_by, r.created_at, r.updated_at
  from recurring_before_clients r join project p on p.id = r.project_id;
drop table recurring_before_clients;
create index recurring_invoice_by_project on recurring_invoice (project_id);
create index recurring_invoice_by_client on recurring_invoice (organization_id);
create index recurring_invoice_due on recurring_invoice (active, next_on);
