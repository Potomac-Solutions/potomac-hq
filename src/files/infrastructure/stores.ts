import { createHash } from "node:crypto";
import type { BlobStore, FileRecordStore } from "../application/files.ts";
import type { FileRecord } from "../domain/file.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

type Row = {
  id: string;
  name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  owner_type: string;
  owner_id: string;
  organization_id: string | null;
  client_visible: number;
  uploaded_by: string | null;
  uploaded_by_client: string | null;
};

const toRecord = (r: Row): FileRecord => ({
  id: r.id as Id,
  name: r.name,
  contentType: r.content_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256,
  ownerType: r.owner_type,
  ownerId: r.owner_id as Id,
  organizationId: r.organization_id as Id | null,
  clientVisible: r.client_visible === 1,
  uploadedBy: r.uploaded_by as Id | null,
  uploadedByClient: r.uploaded_by_client as Id | null,
});

export function sqliteFileRecordStore(db: Database): FileRecordStore {
  const cols = "id, name, content_type, size_bytes, sha256, owner_type, owner_id, organization_id, client_visible, uploaded_by, uploaded_by_client";
  const insert = db.prepare(`insert into file (${cols}, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const byOwner = db.prepare(
    `select ${cols.split(", ").map((c) => `f.${c}`).join(", ")}, f.created_at, u.name as client_user_name
       from file f left join client_user u on u.id = f.uploaded_by_client
      where f.owner_type = ? and f.owner_id = ? order by f.created_at desc, f.rowid desc`,
  );
  const get = db.prepare(`select ${cols} from file where id = ?`);
  const visible = db.prepare("update file set client_visible = ? where id = ?");
  const remove = db.prepare("delete from file where id = ?");
  return {
    insert(f, at) {
      insert.run(f.id, f.name, f.contentType, f.sizeBytes, f.sha256, f.ownerType, f.ownerId, f.organizationId, f.clientVisible ? 1 : 0, f.uploadedBy, f.uploadedByClient ?? null, at);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? toRecord(r) : null;
    },
    listForOwner(ownerType, ownerId) {
      return (byOwner.all(ownerType, ownerId) as (Row & { created_at: string; client_user_name: string | null })[]).map((r) => ({ ...toRecord(r), createdAt: r.created_at, clientUserName: r.client_user_name }));
    },
    setClientVisible(id, on) {
      visible.run(on ? 1 : 0, id);
    },
    remove(id) {
      remove.run(id);
    },
  };
}

/**
 * Keeps a file's bytes in the database (decision 0002), so the nightly sealed
 * backup holds them and a restore brings them back with everything else.
 */
export function sqliteBlobStore(db: Database): BlobStore {
  const put = db.prepare("insert into file_blob (file_id, body) values (?, ?)");
  const get = db.prepare("select body from file_blob where file_id = ?");
  const remove = db.prepare("delete from file_blob where file_id = ?");
  return {
    put(fileId, body) {
      put.run(fileId, body);
    },
    get(fileId) {
      const row = get.get(fileId) as { body: Uint8Array } | undefined;
      return row ? new Uint8Array(row.body) : null;
    },
    remove(fileId) {
      remove.run(fileId);
    },
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
