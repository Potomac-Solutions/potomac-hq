// Pins (migration 0074).
import type { PinStore } from "../application/pins.ts";
import type { Database } from "../../shared/adapters.ts";

export function sqlitePinStore(db: Database): PinStore {
  const list = db.prepare("select href, label from nav_pin where user_id = ? order by at, rowid");
  const add = db.prepare("insert into nav_pin (user_id, href, label, at) values (?, ?, ?, ?) on conflict (user_id, href) do nothing");
  const remove = db.prepare("delete from nav_pin where user_id = ? and href = ?");
  return {
    list: (userId) => list.all(userId).map((row) => ({ href: String(row["href"]), label: String(row["label"]) })),
    add(userId, pin, at) {
      add.run(userId, pin.href, pin.label, at);
    },
    remove: (userId, href) => Number(remove.run(userId, href).changes) > 0,
  };
}
