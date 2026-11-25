// AI's settings, its call log and its drafts (migration 0058).
import { DEFAULT_SETTINGS, isFeature, type Feature } from "../domain/settings.ts";
import type { AiStore, Draft, DraftStatus, StoredSettings, UsageRow } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Id } from "../../shared/index.ts";

const DRAFT_COLUMNS = "id, feature, record_type, record_id, content, status, fingerprint, attachment is not null as has_attachment, created_by, created_at, decided_by, decided_at";

function toDraft(row: Record<string, unknown>): Draft {
  return {
    id: row["id"] as Id,
    feature: row["feature"] as Feature,
    recordType: String(row["record_type"]),
    recordId: String(row["record_id"]),
    content: JSON.parse(String(row["content"])) as unknown,
    status: row["status"] as DraftStatus,
    fingerprint: String(row["fingerprint"] ?? ""),
    createdBy: (row["created_by"] as Id | null) ?? null,
    createdAt: String(row["created_at"]),
    decidedBy: (row["decided_by"] as Id | null) ?? null,
    decidedAt: (row["decided_at"] as string | null) ?? null,
    hasAttachment: Number(row["has_attachment"]) === 1,
  };
}

function toUsage(row: Record<string, unknown>): UsageRow {
  return {
    id: row["id"] as Id,
    feature: row["feature"] as Feature,
    recordType: String(row["record_type"]),
    recordId: String(row["record_id"]),
    model: String(row["model"]),
    inputCount: Number(row["input_count"]),
    outputCount: Number(row["output_count"]),
    cost: Number(row["cost"]),
    actorId: (row["actor_id"] as Id | null) ?? null,
    at: String(row["at"]),
    ok: Number(row["ok"]) === 1,
    problem: String(row["problem"] ?? ""),
    draftId: (row["draft_id"] as Id | null) ?? null,
  };
}

export function sqliteAiStore(db: Database): AiStore {
  const settings = db.prepare("select * from ai_setting where id = 1");
  const save = db.prepare(`update ai_setting set model = ?, input_price = ?, output_price = ?, long_above = ?, long_input = ?, long_output = ?, features = ?, price_guide = ?, ceiling = ?, updated_by = ?, updated_at = ? where id = 1`);
  const log = db.prepare(`insert into ai_usage (id, feature, record_type, record_id, model, input_count, output_count, cost, actor_id, at, ok, problem, draft_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const spent = db.prepare("select coalesce(sum(cost), 0) as total from ai_usage where at >= ?");
  const counts = db.prepare("select count(*) as calls, coalesce(sum(1 - ok), 0) as failed from ai_usage where at >= ?");
  const recent = db.prepare("select * from ai_usage order by at desc, rowid desc limit ?");
  const insert = db.prepare(`insert into ai_draft (id, feature, record_type, record_id, content, status, fingerprint, attachment, attachment_name, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const get = db.prepare(`select ${DRAFT_COLUMNS} from ai_draft where id = ?`);
  const latest = db.prepare(`select ${DRAFT_COLUMNS} from ai_draft where feature = ? and record_id = ? order by created_at desc, rowid desc limit 1`);
  const waiting = db.prepare(`select ${DRAFT_COLUMNS} from ai_draft where status = 'waiting' order by created_at desc, rowid desc limit ?`);
  const waitingFor = db.prepare(`select ${DRAFT_COLUMNS} from ai_draft where status = 'waiting' and feature = ? and record_id = ? order by created_at desc, rowid desc`);
  const fingerprinted = db.prepare("select 1 from ai_draft where feature = ? and fingerprint = ? limit 1");
  const decide = db.prepare("update ai_draft set status = ?, decided_by = ?, decided_at = ?, attachment = null, attachment_name = null where id = ? and status = 'waiting'");
  const attachment = db.prepare("select attachment, attachment_name from ai_draft where id = ? and attachment is not null");
  return {
    settings(): StoredSettings {
      const row = settings.get();
      if (!row) return { ...DEFAULT_SETTINGS, updatedBy: null, updatedAt: "" };
      const longAbove = row["long_above"] as number | null;
      const features = (JSON.parse(String(row["features"])) as string[]).filter(isFeature);
      return {
        model: String(row["model"]),
        price: { input: Number(row["input_price"]), output: Number(row["output_price"]), ...(longAbove !== null ? { long: { above: longAbove, input: Number(row["long_input"]), output: Number(row["long_output"]) } } : {}) },
        features,
        priceGuide: String(row["price_guide"] ?? ""),
        ceiling: String(row["ceiling"] ?? DEFAULT_SETTINGS.ceiling),
        updatedBy: (row["updated_by"] as Id | null) ?? null,
        updatedAt: String(row["updated_at"]),
      };
    },
    saveSettings(next, by, at) {
      save.run(next.model, next.price.input, next.price.output, next.price.long?.above ?? null, next.price.long?.input ?? null, next.price.long?.output ?? null, JSON.stringify(next.features), next.priceGuide, next.ceiling, by, at);
    },
    logUsage(row) {
      log.run(row.id, row.feature, row.recordType, row.recordId, row.model, row.inputCount, row.outputCount, row.cost, row.actorId, row.at, row.ok ? 1 : 0, row.problem, row.draftId);
    },
    spentSince: (since) => Number(spent.get(since)?.["total"] ?? 0),
    countSince(since) {
      const row = counts.get(since);
      return { calls: Number(row?.["calls"] ?? 0), failed: Number(row?.["failed"] ?? 0) };
    },
    recentUsage: (limit) => recent.all(limit).map(toUsage),
    insertDraft(draft, file) {
      insert.run(draft.id, draft.feature, draft.recordType, draft.recordId, JSON.stringify(draft.content), draft.status, draft.fingerprint, file?.bytes ?? null, file?.name ?? null, draft.createdBy, draft.createdAt);
    },
    getDraft(id) {
      const row = get.get(id);
      return row ? toDraft(row) : null;
    },
    latest(feature, recordId) {
      const row = latest.get(feature, recordId);
      return row ? toDraft(row) : null;
    },
    waiting: (limit) => waiting.all(limit).map(toDraft),
    waitingFor: (feature, recordId) => waitingFor.all(feature, recordId).map(toDraft),
    hasFingerprint: (feature, fingerprint) => fingerprinted.get(feature, fingerprint) !== undefined,
    decide: (id, status, by, at) => Number(decide.run(status, by, at, id).changes) === 1,
    attachment(id) {
      const row = attachment.get(id);
      return row ? { name: String(row["attachment_name"] ?? "receipt"), bytes: new Uint8Array(row["attachment"] as Uint8Array) } : null;
    },
  };
}
