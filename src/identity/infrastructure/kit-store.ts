// The kit's store contract over SQLite. Reads are synchronous and a write is
// stored before it returns, which every "exactly one wins" rule in the kit
// depends on. A test runs the kit's own checkStore against this.
import type { KitStore } from "@potomac-solutions/kit/store";
import type { Database } from "../../shared/adapters.ts";

export function sqliteKitStore(db: Database): KitStore {
  const one = db.prepare("select fields from kit_document where collection = ? and key = ?");
  const all = db.prepare("select key, fields from kit_document where collection = ? order by key");
  // json_patch would drop keys set to null, so the merge is done here.
  const upsert = db.prepare(
    `insert into kit_document (collection, key, fields) values (?, ?, ?)
     on conflict (collection, key) do update set fields = excluded.fields`,
  );
  const parse = (text: unknown) => JSON.parse(text as string) as Record<string, unknown>;

  return {
    get(collection, key) {
      const row = one.get(collection, key);
      return row ? parse(row["fields"]) : null;
    },
    under(collection, prefix = "") {
      return all
        .all(collection)
        .filter((row) => (row["key"] as string).startsWith(prefix))
        .map((row) => ({ key: row["key"] as string, ...parse(row["fields"]) }));
    },
    write(collection, key, fields) {
      const row = one.get(collection, key);
      const merged = { ...(row ? parse(row["fields"]) : {}), ...fields };
      upsert.run(collection, key, JSON.stringify(merged));
      return Promise.resolve();
    },
  };
}
