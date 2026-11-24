-- Decision 0007, section 5: subtasks and blocking.
--
-- A subtask is a task with a parent, one level deep, in the parent's project.
-- The rule lives in the projects module; the column only points at a task.
alter table task add column parent_id text references task (id);
create index task_by_parent on task (parent_id) where parent_id is not null;

-- One task waiting on another. No task waits on itself; circles are refused
-- by the projects module, which can see the whole chain.
create table task_block (
  blocked_id text not null references task (id),
  blocker_id text not null references task (id),
  created_by text references user (id),
  created_at text not null,
  primary key (blocked_id, blocker_id),
  check (blocked_id <> blocker_id)
) strict, without rowid;
create index task_block_by_blocker on task_block (blocker_id);
