-- Decision 0007, section 7: repeating tasks. A repeat is every N days, weeks,
-- months or years, counted from the due date or the day it was done; all
-- three columns are set or none is. previous_id links a task to the one whose
-- finishing made it.
alter table task add column repeat_every integer check (repeat_every is null or repeat_every between 1 and 365);
alter table task add column repeat_unit text check (repeat_unit is null or repeat_unit in ('day', 'week', 'month', 'year'));
alter table task add column repeat_from text check (repeat_from is null or repeat_from in ('due', 'done'));
alter table task add column previous_id text references task (id);
create unique index task_by_previous on task (previous_id) where previous_id is not null;
