-- Decision 0008, section 1: task keys. Each project gets a short key made
-- from its name, and each task a number in its project (to-dos share one
-- count), so a task is BDW-12. Existing ones get theirs here, in the order
-- they were made, by the rule in src/projects/domain/task-key.ts: the
-- initials of up to five words, or a single word's first three letters; a
-- key already taken gets a digit.
alter table project add column key text check (key is null or (key glob '[A-Z]*' and length(key) between 2 and 6));
alter table task add column number integer check (number is null or number > 0);

-- Every key a project has had, so an old key still finds its tasks.
create table project_key (
  key        text primary key,
  project_id text not null references project (id)
) strict;

-- Words of each name, in capitals, split on spaces and common punctuation.
create temp table key_word as
with recursive split (project_id, rest, word, n) as (
  select id,
         trim(upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(name, '.', ' '), ',', ' '), ':', ' '), ';', ' '), '&', ' '), '-', ' '), '''', ' '), '/', ' '), '(', ' '), ')', ' '))) || ' ',
         '', 0
    from project
  union all
  select project_id, ltrim(substr(rest, instr(rest, ' ') + 1)), substr(rest, 1, instr(rest, ' ') - 1), n + 1
    from split
   where rest <> ''
)
select project_id, word, n from split where n > 0 and word <> '';

create temp table key_base as
select p.id as project_id,
       case
         when (select count(*) from key_word w where w.project_id = p.id) > 1
           then (select group_concat(i, '') from (select substr(w.word, 1, 1) as i from key_word w where w.project_id = p.id and substr(w.word, 1, 1) glob '[A-Z0-9]' order by w.n limit 5))
         else (select substr(w.word, 1, 3) from key_word w where w.project_id = p.id order by w.n limit 1)
       end as base
  from project p;

-- Keys must start with a letter and be letters and digits only; anything
-- else (a name in other scripts, or none) falls back to PRJ.
update key_base set base = case when base glob '[0-9]*' then 'P' || base else base end;
update key_base set base = 'PRJ' where base is null or base glob '*[^A-Z0-9]*' or length(base) < 1;
update key_base set base = substr(base || 'X', 1, 2) where length(base) < 2;
update key_base set base = base || '2' where base in ('TODO', 'INV');

update project set key = (
  select case when r.rn = 1 then r.base else substr(r.base, 1, 6 - length(r.rn)) || r.rn end
    from (select b.project_id, b.base, row_number() over (partition by b.base order by p2.created_at, p2.rowid) as rn
            from key_base b join project p2 on p2.id = b.project_id) r
   where r.project_id = project.id
);
-- A digit added above could, rarely, meet another project's own key. Any
-- left the same are told apart by their row, after a Z no initials make.
update project set key = 'Z' || rowid
 where key in (select key from project group by key having count(*) > 1)
   and rowid not in (select min(rowid) from project group by key);

drop table key_word;
drop table key_base;

create unique index project_by_key on project (key) where key is not null;
insert into project_key (key, project_id) select key, id from project;

-- Numbers, in the order the tasks were made: per project, and across to-dos.
update task set number = (
  select count(*) from task t2
   where t2.project_id is task.project_id
     and (t2.created_at < task.created_at or (t2.created_at = task.created_at and t2.rowid <= task.rowid))
);
create unique index task_number_in_project on task (project_id, number) where project_id is not null;
create unique index todo_number on task (number) where project_id is null;
