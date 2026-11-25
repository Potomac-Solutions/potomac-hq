-- The monthly report to plan clients (decision 0013, section 4): drafted in
-- the first week of a month for the month before, sent only when someone
-- presses Send, and kept for the client's portal.
create table monthly_report (
  id               text primary key,
  organization_id  text not null references client_organization (id),
  month            text not null check (month glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  status           text not null check (status in ('draft', 'sent', 'skipped')),
  body             text not null check (length(body) between 1 and 20000),
  note             text not null default '' check (length(note) <= 1000),
  sent_to          text check (sent_to is null or length(sent_to) <= 254),
  sent_at          text,
  sent_by          text references user (id),
  created_at       text not null,
  updated_at       text not null,
  unique (organization_id, month),
  check ((status = 'sent') = (sent_at is not null and sent_to is not null))
) strict;

create index monthly_report_by_status on monthly_report (status, month);

insert into role_permission (role_id, permission)
select role.id, 'client-report.send' from role where role.key in ('admin', 'manager');
