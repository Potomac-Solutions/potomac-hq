import type { Automation, AutomationState } from "../domain/automation.ts";
import type { AutomationStore } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const COLUMNS = "a.id, a.organization_id, a.name, a.description, a.n8n_url, a.every_minutes, a.active, a.state, a.alerted, a.last_run_at, a.last_message, a.created_at";

function toAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row["id"] as Id,
    organizationId: row["organization_id"] as Id,
    name: String(row["name"]),
    description: String(row["description"]),
    n8nUrl: String(row["n8n_url"]),
    everyMinutes: Number(row["every_minutes"]),
    active: Number(row["active"]) === 1,
    state: row["state"] as AutomationState,
    alerted: row["alerted"] as AutomationState,
    lastRunAt: row["last_run_at"] === null || row["last_run_at"] === undefined ? null : String(row["last_run_at"]),
    lastMessage: String(row["last_message"]),
    createdAt: String(row["created_at"]),
  };
}

export function sqliteAutomationStore(db: Database): AutomationStore {
  const get = db.prepare(`select ${COLUMNS} from automation a where a.id = ?`);
  const byToken = db.prepare(`select ${COLUMNS} from automation a where a.token_hash = ?`);
  const listFor = db.prepare(`select ${COLUMNS} from automation a where a.organization_id = ? order by a.name`);
  const list = db.prepare(`select ${COLUMNS} from automation a join client_organization c on c.id = a.organization_id order by c.name, a.name`);
  const insert = db.prepare("insert into automation (id, organization_id, name, description, n8n_url, every_minutes, active, state, alerted, last_run_at, last_message, token_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const save = db.prepare("update automation set name = ?, description = ?, n8n_url = ?, every_minutes = ?, active = ?, state = ?, alerted = ?, last_run_at = ?, last_message = ?, created_at = ?, updated_at = ? where id = ?");
  const setToken = db.prepare("update automation set token_hash = ?, updated_at = ? where id = ?");
  const remove = db.prepare("delete from automation where id = ?");
  const addRun = db.prepare("insert into automation_run (automation_id, ran_at, status, message) values (?, ?, ?, ?)");
  const trim = db.prepare("delete from automation_run where automation_id = ? and rowid not in (select rowid from automation_run where automation_id = ? order by ran_at desc, rowid desc limit ?)");
  const runs = db.prepare("select ran_at, status, message from automation_run where automation_id = ? order by ran_at desc, rowid desc limit ?");
  const one = (row: Record<string, unknown> | undefined) => (row ? toAutomation(row) : null);
  return {
    get: (id) => one(get.get(id)),
    byTokenHash: (hash) => one(byToken.get(hash)),
    listFor: (organizationId) => listFor.all(organizationId).map(toAutomation),
    list: () => list.all().map(toAutomation),
    insert(a, tokenHash, at) {
      insert.run(a.id, a.organizationId, a.name, a.description, a.n8nUrl, a.everyMinutes, a.active ? 1 : 0, a.state, a.alerted, a.lastRunAt, a.lastMessage, tokenHash, a.createdAt, at);
    },
    save(a, at) {
      save.run(a.name, a.description, a.n8nUrl, a.everyMinutes, a.active ? 1 : 0, a.state, a.alerted, a.lastRunAt, a.lastMessage, a.createdAt, at, a.id);
    },
    setToken(id, tokenHash, at) {
      setToken.run(tokenHash, at, id);
    },
    remove(id) {
      remove.run(id);
    },
    addRun(id, run, keep) {
      addRun.run(id, run.at, run.status, run.message);
      trim.run(id, id, keep);
    },
    runs: (id, limit) => runs.all(id, limit).map((row) => ({ at: String(row["ran_at"]), status: row["status"] as "ok" | "failed", message: String(row["message"]) })),
  };
}
