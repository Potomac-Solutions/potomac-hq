-- Two expense categories for Potomac's own costs (decision 0021):
-- `training` (courses, exams, certifications) and `licenses` (business
-- licenses, permits and filing fees, like forming the LLC). SQLite can't
-- change a check, so the table is rebuilt with every row kept. Nothing
-- refers to an expense, so no foreign keys need deferring.
create table expense_next (
  id              text primary key,
  project_id      text not null references project (id),
  category        text not null check (category in ('software', 'hosting', 'domain', 'contractor', 'hardware', 'travel', 'supplies', 'training', 'licenses', 'other')),
  amount_minor    integer not null check (amount_minor > 0),
  currency        text not null default 'USD' check (currency = 'USD'),
  spent_on        text not null check (spent_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note            text not null default '',
  receipt_file_id text references file (id),
  recorded_by     text not null references user (id),
  removed_at      text,
  created_at      text not null
) strict;

insert into expense_next (id, project_id, category, amount_minor, currency, spent_on, note, receipt_file_id, recorded_by, removed_at, created_at)
select id, project_id, category, amount_minor, currency, spent_on, note, receipt_file_id, recorded_by, removed_at, created_at
  from expense;

drop table expense;
alter table expense_next rename to expense;
create index expense_by_project on expense (project_id, spent_on);
