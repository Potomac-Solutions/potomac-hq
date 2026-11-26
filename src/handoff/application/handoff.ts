// The handoff pack (2026-11-26): one download for a client who is leaving
// or wants to host their own site. Their renewals (what renews when, where,
// and what it costs there), their sites and where the code lives, the files
// they were given, their invoices, and what they told us about the business.
// Made by staff and handed over; the client's own portal doesn't offer it.
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, toCsv, zipFiles, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";

export type HandoffFacts = {
  readonly clientName: string;
  readonly renewals: readonly { readonly kind: string; readonly name: string; readonly provider: string; readonly renewsOn: string; readonly termMonths: number; readonly costMinor: number | null; readonly autoRenews: boolean; readonly note: string }[];
  readonly sites: readonly { readonly what: string; readonly address: string; readonly code: string }[];
  readonly files: readonly { readonly id: Id; readonly name: string; readonly project: string }[];
  readonly invoices: readonly { readonly number: number; readonly sentOn: string; readonly status: string; readonly totalMinor: number; readonly paidMinor: number; readonly what: string }[];
  readonly about: string;
};

export type HandoffDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly today: () => string;
  readonly facts: (organizationId: Id) => HandoffFacts | null;
  readonly fileBytes: (fileId: Id) => Uint8Array | null;
  /** The newest built site's code as a zip, when the client has one and the person may get it. */
  readonly builtSite: (actorId: Id, organizationId: Id) => { readonly name: string; readonly bytes: Uint8Array } | null;
};

const KINDS: Readonly<Record<string, string>> = { domain: "Domain", hosting: "Hosting", ssl: "Security certificate", email: "Email", software: "Software", other: "Other" };
const dollars = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2));
const safe = (name: string) => name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "file";

export function handoffPack(deps: HandoffDeps, actorId: Id | null, organizationId: Id): Result<{ readonly fileName: string; readonly bytes: Uint8Array<ArrayBuffer> }, "forbidden" | "not-found"> {
  if (actorId === null || !authorize(deps, actorId, "client.set-status").ok) return err("forbidden");
  const facts = deps.facts(organizationId);
  if (!facts) return err("not-found");
  const withMoney = authorize(deps, actorId, "invoice.view").ok;
  const files: Record<string, string | Uint8Array> = {};
  const given: string[] = [];
  for (const one of facts.files) {
    const bytes = deps.fileBytes(one.id);
    if (!bytes) continue;
    let path = `files/${safe(one.project || "general")}/${safe(one.name)}`;
    let n = 2;
    while (files[path]) path = path.replace(/(\.[^./]+)?$/, (ext) => `-${n++}${ext}`);
    files[path] = bytes;
    given.push(path);
  }
  const site = deps.builtSite(actorId, organizationId);
  if (site) files[`site-code/${safe(site.name)}`] = site.bytes;
  const today = deps.today();
  const readme = [
    `${facts.clientName}: everything in one place`,
    `From Potomac Solutions, ${today}.`,
    "",
    "What's here:",
    "  renewals.csv    what renews, when, where it's from and what it costs there. Move each to your own account before its date.",
    "  websites.txt    your sites, and where their code is kept",
    ...(site ? ["  site-code/      your website's files, ready to put on any host"] : []),
    ...(given.length > 0 ? [`  files/          the ${given.length} file${given.length === 1 ? "" : "s"} shared with you, by project`] : []),
    ...(withMoney ? ["  invoices.csv    every invoice we sent you, and what was paid"] : []),
    ...(facts.about ? ["  about-your-business.txt  what you told us, for whoever helps you next"] : []),
    "",
    "Next steps:",
    "  1. Domain: ask its registrar (in renewals.csv) for a transfer to your own account, or for us to add you as owner.",
    "  2. Hosting: if your site moves, point the domain at the new host once the site is up there.",
    "  3. Logins: we'll remove ourselves from your accounts once you say everything works.",
    "",
    "Questions? Call or email Potomac Solutions any time.",
  ];
  Object.assign(files, {
    "README.txt": readme.join("\n") + "\n",
    "renewals.csv": toCsv(["What", "Name", "From", "Renews on", "Every (months)", "Renews by itself", "Costs there", "Note"], facts.renewals.map((r) => [KINDS[r.kind] ?? r.kind, r.name, r.provider, r.renewsOn, r.termMonths, r.autoRenews ? "yes" : "no", dollars(r.costMinor), r.note])),
    "websites.txt": (facts.sites.length === 0 ? ["No websites on record."] : facts.sites.map((s) => `${s.what}\n  Address: ${s.address || "none yet"}\n  Code: ${s.code || "not kept by Potomac"}`)).join("\n\n") + "\n",
  });
  if (withMoney) files["invoices.csv"] = toCsv(["Invoice", "Sent", "For", "Total", "Paid", "Status"], facts.invoices.map((i) => [`INV-${String(i.number).padStart(4, "0")}`, i.sentOn, i.what, dollars(i.totalMinor), dollars(i.paidMinor), i.status]));
  if (facts.about) files["about-your-business.txt"] = facts.about + "\n";
  deps.transact(() => recordActivity(deps, { actorId, action: "client.handoff-pack", recordType: "client", recordId: organizationId, context: { files: given.length, site: site !== null } }));
  const folder = `${safe(facts.clientName.toLowerCase())}-handoff`;
  return ok({ fileName: `${folder}-${today}.zip`, bytes: zipFiles(files, folder, new Date(deps.clock())) });
}
