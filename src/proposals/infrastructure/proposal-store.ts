import type { Agreement, ProposalRow, ProposalStore } from "../application/ports.ts";
import type { EstimateLine } from "../domain/estimate.ts";
import type { Decision, DecisionMethod, Pricing, Proposal, ProposalStatus, ProposalVersion } from "../domain/proposal.ts";
import type { Database } from "../../shared/adapters.ts";
import type { Currency, Id } from "../../shared/index.ts";

type Row = Record<string, string | number | null>;
const text = (row: Row, key: string) => row[key] as string;
const lines = (row: Row) => JSON.parse(text(row, "lines")) as EstimateLine[];

const toProposal = (r: Row): Proposal => ({
  id: text(r, "id") as Id,
  opportunityId: text(r, "opportunity_id") as Id,
  title: text(r, "title"),
  status: text(r, "status") as ProposalStatus,
  pricing: text(r, "pricing") as Pricing,
  scope: text(r, "scope"),
  assumptions: text(r, "assumptions"),
  exclusions: text(r, "exclusions"),
  deliverables: text(r, "deliverables"),
  lines: lines(r),
  currentVersion: r["current_version"] as number,
  sharedWithClient: r["shared_with_client"] === 1,
  createdBy: text(r, "created_by") as Id,
});

const toVersion = (r: Row): ProposalVersion => ({
  proposalId: text(r, "proposal_id") as Id,
  number: r["number"] as number,
  title: text(r, "title"),
  pricing: text(r, "pricing") as Pricing,
  scope: text(r, "scope"),
  assumptions: text(r, "assumptions"),
  exclusions: text(r, "exclusions"),
  deliverables: text(r, "deliverables"),
  lines: lines(r),
  total: { minor: r["total_minor"] as number, currency: text(r, "currency") as Currency },
  minutes: r["minutes"] as number,
  sentBy: text(r, "sent_by") as Id,
  sentAt: text(r, "sent_at"),
});

export function sqliteProposalStore(db: Database): ProposalStore {
  const cols = "id, opportunity_id, title, status, pricing, scope, assumptions, exclusions, deliverables, lines, current_version, shared_with_client, created_by";
  const insert = db.prepare(`insert into proposal (${cols}, created_at, updated_at) values (${Array(15).fill("?").join(", ")})`);
  const update = db.prepare(
    "update proposal set title = ?, status = ?, pricing = ?, scope = ?, assumptions = ?, exclusions = ?, deliverables = ?, lines = ?, current_version = ?, shared_with_client = ?, updated_at = ? where id = ?",
  );
  const get = db.prepare(`select ${cols} from proposal where id = ?`);
  const listFor = db.prepare(`select ${cols} from proposal where opportunity_id = ? order by rowid desc`);
  const joined = `select ${cols.split(", ").map((c) => `p.${c}`).join(", ")}, o.title as opportunity_title, c.id as client_id, c.name as client_name
       from proposal p join opportunity o on o.id = p.opportunity_id join client_organization c on c.id = o.organization_id`;
  const list = db.prepare(`${joined} order by p.rowid desc`);
  const sharedWith = db.prepare(`${joined} where c.id = ? and p.shared_with_client = 1 and p.current_version > 0 order by p.rowid desc`);
  const vcols = "proposal_id, number, title, pricing, scope, assumptions, exclusions, deliverables, lines, total_minor, currency, minutes, sent_by, sent_at";
  const insertVersion = db.prepare(`insert into proposal_version (${vcols}) values (${Array(14).fill("?").join(", ")})`);
  const versions = db.prepare(`select ${vcols} from proposal_version where proposal_id = ? order by number desc`);
  const version = db.prepare(`select ${vcols} from proposal_version where proposal_id = ? and number = ?`);
  const saveDecision = db.prepare("insert into proposal_decision (proposal_id, version, decision, by_name, decided_on, method, note, recorded_by, recorded_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const decision = db.prepare("select proposal_id, version, decision, by_name, decided_on, method, note, recorded_by, recorded_at from proposal_decision where proposal_id = ?");
  const insertAgreement = db.prepare("insert into agreement (id, proposal_id, version, reference, signed_on, file_id, recorded_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  const agreements = db.prepare(
    `select a.id, a.proposal_id, a.version, a.reference, a.signed_on, a.file_id, a.recorded_by, f.name as file_name
       from agreement a left join file f on f.id = a.file_id where a.proposal_id = ? order by a.rowid desc`,
  );
  const row = (r: Row): ProposalRow => ({ ...toProposal(r), opportunityTitle: text(r, "opportunity_title"), clientId: text(r, "client_id") as Id, clientName: text(r, "client_name") });
  return {
    insert(p, at) {
      insert.run(p.id, p.opportunityId, p.title, p.status, p.pricing, p.scope, p.assumptions, p.exclusions, p.deliverables, JSON.stringify(p.lines), p.currentVersion, p.sharedWithClient ? 1 : 0, p.createdBy, at, at);
    },
    update(p, at) {
      update.run(p.title, p.status, p.pricing, p.scope, p.assumptions, p.exclusions, p.deliverables, JSON.stringify(p.lines), p.currentVersion, p.sharedWithClient ? 1 : 0, at, p.id);
    },
    get(id) {
      const r = get.get(id) as Row | undefined;
      return r ? toProposal(r) : null;
    },
    listFor(opportunityId) {
      return (listFor.all(opportunityId) as Row[]).map(toProposal);
    },
    list() {
      return (list.all() as Row[]).map(row);
    },
    sharedWith(organizationId) {
      return (sharedWith.all(organizationId) as Row[]).map(row);
    },
    insertVersion(v) {
      insertVersion.run(v.proposalId, v.number, v.title, v.pricing, v.scope, v.assumptions, v.exclusions, v.deliverables, JSON.stringify(v.lines), v.total.minor, v.total.currency, v.minutes, v.sentBy, v.sentAt);
    },
    versions(proposalId) {
      return (versions.all(proposalId) as Row[]).map(toVersion);
    },
    version(proposalId, number) {
      const r = version.get(proposalId, number) as Row | undefined;
      return r ? toVersion(r) : null;
    },
    saveDecision(d) {
      saveDecision.run(d.proposalId, d.version, d.decision, d.byName, d.on, d.method, d.note, d.recordedBy, d.recordedAt);
    },
    decision(proposalId) {
      const r = decision.get(proposalId) as Row | undefined;
      if (!r) return null;
      return {
        proposalId: text(r, "proposal_id") as Id,
        version: r["version"] as number,
        decision: text(r, "decision") as Decision["decision"],
        byName: text(r, "by_name"),
        on: text(r, "decided_on"),
        method: text(r, "method") as DecisionMethod,
        note: (r["note"] ?? null) as string | null,
        recordedBy: (r["recorded_by"] ?? null) as Id | null,
        recordedAt: text(r, "recorded_at"),
      };
    },
    insertAgreement(a: Agreement, at) {
      insertAgreement.run(a.id, a.proposalId, a.version, a.reference, a.signedOn, a.fileId, a.recordedBy, at);
    },
    agreements(proposalId) {
      return (agreements.all(proposalId) as Row[]).map((r) => ({
        id: text(r, "id") as Id,
        proposalId: text(r, "proposal_id") as Id,
        version: r["version"] as number,
        reference: text(r, "reference"),
        signedOn: text(r, "signed_on"),
        fileId: (r["file_id"] ?? null) as Id | null,
        recordedBy: text(r, "recorded_by") as Id,
        fileName: (r["file_name"] ?? null) as string | null,
      }));
    },
  };
}
