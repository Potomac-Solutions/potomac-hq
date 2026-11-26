// Taking back the next one a repeating task made (pre-staging, 2026-11-25):
// when finishing a repeating task is undone, the next one it made goes too,
// but only if nothing has happened to it. "Nothing" is read from the schema's
// own foreign keys, so a table added later counts, plus files (kept by owner,
// with no foreign key): any comment, time entry, file, reminder, share or
// blocking link on it, or on one of the subtasks it copied, and it stays. Its labels and copied subtasks go with it.
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

/** What goes along with the task itself, and is no sign of work on it. */
const ITS_OWN = new Set(["task_label.task_id", "task.parent_id", "task.previous_id"]);

export function sqliteRepeatTaker(db: Database): (taskId: Id) => boolean {
  const pointers = db
    .prepare("select m.name as tbl, p.\"from\" as col from sqlite_master m join pragma_foreign_key_list(m.name) p where m.type = 'table' and p.\"table\" = 'task'")
    .all()
    .map((row) => ({ table: String(row["tbl"]), column: String(row["col"]) }))
    // Names come from the schema itself, never from a person; checked anyway.
    .filter((one) => /^[a-z_]+$/.test(one.table) && /^[a-z_]+$/.test(one.column));
  const others = pointers.filter((one) => !ITS_OWN.has(`${one.table}.${one.column}`)).map((one) => db.prepare(`select 1 from ${one.table} where ${one.column} = ? limit 1`));
  others.push(db.prepare("select 1 from file where owner_type = 'task' and owner_id = ? limit 1"));
  const task = db.prepare("select status from task where id = ?");
  const subtasks = db.prepare("select id from task where parent_id = ?");
  const dropLabels = db.prepare("delete from task_label where task_id = ?");
  const drop = db.prepare("delete from task where id = ?");
  const untouched = (id: string): boolean => task.get(id)?.["status"] === "todo" && others.every((one) => one.get(id) === undefined);
  return (taskId) => {
    const subs = subtasks.all(taskId).map((row) => String(row["id"]));
    if (!untouched(taskId) || !subs.every(untouched)) return false;
    for (const id of [...subs, taskId]) {
      dropLabels.run(id);
      drop.run(id);
    }
    return true;
  };
}
