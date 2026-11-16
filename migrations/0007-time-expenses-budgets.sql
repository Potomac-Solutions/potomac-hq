-- v0.5: time, expenses and budgets (docs/data-model.md, "v0.5"). A management
-- view of whether a job is costing what its proposal said. Not the books.

create table time_entry (
  id         text primary key,
  project_id text not null references project (id),
  task_id    text references task (id),
  user_id    text not null references user (id),
  worked_on  text not null check (worked_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Null while the timer is still running.
  minutes    integer check (minutes is null or (minutes > 0 and minutes <= 1440)),
  note       text not null default '',
  billable   integer not null default 1 check (billable in (0, 1)),
  started_at text,
  -- A mistaken entry is removed, not deleted: the row stays as the record.
  removed_at text,
  created_at text not null,
  updated_at text not null,
  check (minutes is not null or started_at is not null)
) strict;

create index time_entry_by_project on time_entry (project_id, worked_on);
create index time_entry_by_user on time_entry (user_id, worked_on);
create index time_entry_by_task on time_entry (task_id) where task_id is not null;
-- One running timer per person.
create unique index time_entry_one_running on time_entry (user_id) where minutes is null and removed_at is null;

create table expense (
  id              text primary key,
  project_id      text not null references project (id),
  category        text not null check (category in ('software', 'hosting', 'domain', 'contractor', 'hardware', 'travel', 'supplies', 'other')),
  amount_minor    integer not null check (amount_minor > 0),
  currency        text not null default 'USD' check (currency = 'USD'),
  spent_on        text not null check (spent_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note            text not null default '',
  receipt_file_id text references file (id),
  recorded_by     text not null references user (id),
  removed_at      text,
  created_at      text not null
) strict;

create index expense_by_project on expense (project_id, spent_on);

-- A project's budget, the rate its hours are costed at, and where its
-- payment stands. A missing row means the defaults: the accepted proposal's
-- budget, $75 an hour, not invoiced.
create table project_finance (
  project_id     text primary key references project (id),
  budget_minor   integer check (budget_minor is null or budget_minor >= 0),
  currency       text not null default 'USD' check (currency = 'USD'),
  budget_minutes integer check (budget_minutes is null or budget_minutes >= 0),
  rate_minor     integer not null check (rate_minor > 0),
  payment_status text not null check (payment_status in ('not-invoiced', 'deposit-paid', 'invoiced', 'paid')),
  invoice_ref    text not null default '',
  updated_at     text not null
) strict;

-- New permissions (docs/authorization-matrix.md, "v0.5"). Everyone logs their
-- own time. Money is for admins and managers.
insert into role_permission (role_id, permission)
select role.id, 'time.log' from role;

insert into role_permission (role_id, permission)
select role.id, added.column1
  from role,
       (values ('time.view-all'), ('expense.edit'), ('finance.view'), ('finance.edit'), ('finance.export')) as added
 where role.key in ('admin', 'manager');
