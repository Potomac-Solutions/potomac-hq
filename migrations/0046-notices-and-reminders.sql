-- Decision 0007, section 8: notices and reminders.
--
-- A notice is something new for one person: a task given to them, a mention
-- in a comment, or a reminder of theirs coming due.
create table notice (
  id         text primary key,
  user_id    text not null references user (id),
  kind       text not null check (kind in ('assigned', 'mentioned', 'reminder')),
  task_id    text not null references task (id),
  actor_id   text references user (id),
  detail     text not null default '' check (length(detail) <= 200),
  created_at text not null,
  read_at    text,
  emailed_at text
) strict;
create index notice_by_user on notice (user_id, created_at);
create index notice_unread on notice (user_id) where read_at is null;

-- A reminder is the person's own. One at a time fires once; one a number of
-- days before the due date fires again when the due date moves.
create table task_reminder (
  id            text primary key,
  task_id       text not null references task (id),
  user_id       text not null references user (id),
  at            text,
  days_before   integer check (days_before is null or days_before between 0 and 30),
  time_of_day   text check (time_of_day is null or time_of_day glob '[0-2][0-9]:[0-5][0-9]'),
  sent_at       text,
  sent_for_due  text,
  created_at    text not null,
  check ((at is not null and days_before is null and time_of_day is null) or (at is null and days_before is not null and time_of_day is not null))
) strict;
create index task_reminder_by_task on task_reminder (task_id, user_id);

-- Emailing your notices is off until you turn it on.
create table notice_setting (
  user_id    text primary key references user (id),
  email      integer not null check (email in (0, 1)),
  updated_at text not null
) strict;
