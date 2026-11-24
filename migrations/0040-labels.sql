-- Labels on tasks (decision 0007, section 2). A label is a name, unique
-- whatever its capitals, and one of twelve colours. A task has any number.
-- Anyone who edits tasks may make a label and put it on; renaming,
-- recolouring and deleting one is admin and manager (label.manage).
create table label (
  id         text primary key,
  name       text not null check (length(trim(name)) between 1 and 40),
  name_key   text not null unique,
  colour     text not null check (colour in ('slate', 'red', 'orange', 'amber', 'green', 'teal', 'sky', 'blue', 'indigo', 'violet', 'pink', 'brown')),
  created_at text not null,
  updated_at text not null
) strict;

create table task_label (
  task_id  text not null references task (id),
  label_id text not null references label (id),
  primary key (task_id, label_id)
) strict, without rowid;
create index task_label_by_label on task_label (label_id);

insert into role_permission (role_id, permission) select role.id, 'label.manage' from role where role.key in ('admin', 'manager');
