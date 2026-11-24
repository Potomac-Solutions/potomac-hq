-- Decision 0007, section 9: the timeline. A task may have a day work starts,
-- never after its due date, so it's drawn as a bar from start to due.
alter table task add column start_on text check (start_on is null or start_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
