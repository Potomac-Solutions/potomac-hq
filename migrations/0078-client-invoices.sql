-- Invoices on a client, with or without a project (Mikey, 2026-11-25: "I want
-- to bill him for just the domain name, but I can't without starting a
-- project"). Every invoice now names its client; the project is optional.
-- The table is rebuilt so project_id may be empty, each invoice taking its
-- client from its project. Numbers, ids and every other column are kept.
--
-- As in 0041: foreign keys can't be turned off inside the migration's
-- transaction, so they are deferred while the old table goes and its rows
-- come back. Payments, reminders, change requests, renewals and referral
-- credits point at invoice ids, answered again before commit.
pragma defer_foreign_keys = on;

create table invoice_before_clients as select * from invoice;

create table invoice_next (
  id              text primary key,
  organization_id text not null references client_organization (id),
  project_id      text references project (id),
  number          integer not null unique check (number > 0),
  kind            text not null check (kind in ('deposit', 'balance', 'full', 'other')),
  status          text not null check (status in ('draft', 'sent', 'paid', 'void')),
  lines           text not null check (json_valid(lines) and json_type(lines) = 'array'),
  total_minor     integer not null check (total_minor > 0),
  currency        text not null default 'USD' check (currency = 'USD'),
  issued_on       text check (issued_on is null or issued_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_on          text check (due_on is null or due_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note            text not null default '',
  created_by      text not null references user (id),
  created_at      text not null,
  updated_at      text not null,
  recurring_id    text references recurring_invoice (id),
  -- A deposit or a balance is always against a project's budget.
  check (project_id is not null or kind in ('full', 'other')),
  check (status = 'draft' or status = 'void' or issued_on is not null)
) strict;

drop table invoice;
alter table invoice_next rename to invoice;

insert into invoice (id, organization_id, project_id, number, kind, status, lines, total_minor, currency, issued_on, due_on, note, created_by, created_at, updated_at, recurring_id)
select i.id, p.organization_id, i.project_id, i.number, i.kind, i.status, i.lines, i.total_minor, i.currency, i.issued_on, i.due_on, i.note, i.created_by, i.created_at, i.updated_at, i.recurring_id
  from invoice_before_clients i join project p on p.id = i.project_id;
drop table invoice_before_clients;

create index invoice_by_project on invoice (project_id);
create index invoice_by_client on invoice (organization_id);
