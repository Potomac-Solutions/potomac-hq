-- Recurring invoices (docs/data-model.md, "Recurring invoices"): the same
-- charge on a project every month, quarter or year.
create table recurring_invoice (
  id            text primary key,
  project_id    text not null references project (id),
  description   text not null check (length(description) between 1 and 200),
  amount_minor  integer not null check (amount_minor > 0),
  currency      text not null default 'USD' check (currency = 'USD'),
  every         text not null check (every in ('month', 'quarter', 'year')),
  anchor_day    integer not null check (anchor_day between 1 and 31),
  next_on       text not null check (next_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on       text check (ends_on is null or ends_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  auto_send     integer not null check (auto_send in (0, 1)),
  due_days      integer not null check (due_days between 0 and 90),
  active        integer not null check (active in (0, 1)),
  created_by    text not null references user (id),
  created_at    text not null,
  updated_at    text not null
) strict;

create index recurring_invoice_by_project on recurring_invoice (project_id);
create index recurring_invoice_due on recurring_invoice (active, next_on);

-- Which recurring invoice made an invoice, if one did.
alter table invoice add column recurring_id text references recurring_invoice (id);
