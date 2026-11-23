// Importing clients from a pasted CSV: for each row a client, its primary
// contact, and, when the row names one, a project already won, with links to
// its code and live site. Every row is checked first, then all are saved in
// one transaction, through the same steps and history events as adding them
// by hand: nothing half-done. A client already in HQ (by name) is skipped, so
// pasting the same list again adds only what is new.
import { newClient } from "../domain/client.ts";
import { newContact } from "../domain/contact.ts";
import { readImport, type ImportError, type ImportRow } from "../domain/import.ts";
import { newOpportunity } from "../domain/opportunity.ts";
import { authorize } from "../../identity/index.ts";
import { newProjectLink, type ProjectLinkStore } from "../../projects/index.ts";
import { err, ok, parseAmount, recordActivity, type Id, type Result } from "../../shared/index.ts";
import { applyConversion, applyOpportunityValue, applyStageMove, type CrmDeps } from "./commands.ts";

export type ImportDeps = CrmDeps & { readonly links: ProjectLinkStore };

/** Every permission adding these by hand would take. */
export const IMPORT_PERMISSIONS = ["client.create", "contact.edit", "opportunity.create", "opportunity.set-value", "opportunity.set-stage", "opportunity.convert", "project.edit"] as const;

export type ImportResult = { readonly added: readonly string[]; readonly skipped: readonly string[]; readonly projects: number; readonly demos: number };
export type ImportFailure = "forbidden" | ImportError;

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
const fail = (line: number, problem: string): Result<never, ImportFailure> => err(`row:${line}:${problem}`);

const CLIENT_PROBLEMS: Readonly<Record<string, string>> = {
  "name-too-long": "the client’s name is over 200 characters.",
  "invalid-website": "the website isn’t a web address, like https://example.com.",
};
const CONTACT_PROBLEMS: Readonly<Record<string, string>> = {
  "name-too-long": "the contact’s name is too long.",
  "invalid-email": "the email isn’t an email address.",
  "invalid-phone": "the phone number isn’t one: like 301-555-0142 or +13015550142.",
  "title-too-long": "the title is too long.",
};
const LINK_PROBLEMS: Readonly<Record<string, string>> = { "invalid-url": "isn’t a web address starting with https://." };

/** Whether the person may import: everything adding the rows by hand would take. */
export const mayImport = (deps: CrmDeps, actorId: Id | null): actorId is Id => actorId !== null && IMPORT_PERMISSIONS.every((action) => authorize(deps, actorId, action).ok);

export function importClients(deps: ImportDeps, actorId: Id | null, text: string): Result<ImportResult, ImportFailure> {
  if (!mayImport(deps, actorId)) return err("forbidden");
  const read = readImport(text);
  if (!read.ok) return read;
  return deps.transact(() => {
    const existing = deps.clients.list();
    const added: string[] = [];
    const skipped: string[] = [];
    let projects = 0;
    let demos = 0;
    for (const row of read.value) {
      if (existing.some((one) => sameName(one.name, row.client))) {
        skipped.push(row.client);
        continue;
      }
      const done = importRow(deps, actorId, row);
      // Throwing rolls back every row before this one, so a refusal saves nothing.
      if (!done.ok) throw new RowRefused(done.error);
      added.push(row.client);
      if (row.project) projects += 1;
      if (row.demo) demos += 1;
    }
    if (added.length > 0) recordActivity(deps, { actorId, action: "client.imported", recordType: "client-organization", recordId: deps.newId(), context: { added: added.length, skipped: skipped.length, projects, demos } });
    return ok({ added, skipped, projects, demos });
  });
}

class RowRefused extends Error {
  readonly failure: ImportFailure;
  constructor(failure: ImportFailure) {
    super("import row refused");
    this.failure = failure;
  }
}

/** Imports, answering a refused row as a refusal rather than a thrown error. */
export function importClientsSafely(deps: ImportDeps, actorId: Id | null, text: string): Result<ImportResult, ImportFailure> {
  try {
    return importClients(deps, actorId, text);
  } catch (error) {
    if (error instanceof RowRefused) return err(error.failure);
    throw error;
  }
}

function importRow(deps: ImportDeps, actorId: Id, row: ImportRow): Result<true, ImportFailure> {
  const at = deps.clock();
  const client = newClient(deps.newId(), { name: row.client, website: row.website, demo: row.demo });
  if (!client.ok) return fail(row.line, CLIENT_PROBLEMS[client.error] ?? "the client couldn’t be read.");
  deps.clients.insert(client.value, at);
  recordActivity(deps, { actorId, action: "client.created", recordType: "client-organization", recordId: client.value.id, context: { name: client.value.name, imported: true, ...(row.demo ? { demo: true } : {}) } });

  let contactId: Id | null = null;
  if (row.contact) {
    const contact = newContact(deps.newId(), client.value.id, { ...row.contact, isPrimary: true });
    if (!contact.ok) return fail(row.line, CONTACT_PROBLEMS[contact.error] ?? "the contact couldn’t be read.");
    deps.contacts.insert(contact.value, at);
    recordActivity(deps, { actorId, action: "contact.created", recordType: "contact", recordId: contact.value.id, context: { clientId: client.value.id, primary: true } });
    contactId = contact.value.id;
  }

  if (!row.project) return ok(true as const);
  const project = row.project;
  const made = newOpportunity({ id: deps.newId(), organizationId: client.value.id, ownerId: actorId }, { title: project.name, leadSource: project.source, service: project.service, contactId });
  if (!made.ok) return fail(row.line, made.error === "title-too-long" ? "the project’s name is too long." : "the project couldn’t be read.");
  deps.opportunities.insert(made.value, at);
  recordActivity(deps, { actorId, action: "opportunity.created", recordType: "opportunity", recordId: made.value.id, context: { clientId: client.value.id, title: made.value.title, service: made.value.service, leadSource: made.value.leadSource, imported: true } });
  const amount = parseAmount(project.pricing === "free" ? "0" : project.price, "USD");
  if (!amount.ok) return fail(row.line, `“${project.price}” isn’t a price, like 1500 or 1,500.00.`);
  const priced = applyOpportunityValue(deps, actorId, made.value, project.pricing, amount.value);
  if (!priced.ok) return fail(row.line, priced.error === "value-must-be-positive" ? "the price must be more than 0, or the pricing free." : "the price couldn’t be set.");
  // Won work: forward through each stage, as it would have gone.
  let opportunity = priced.value;
  for (const to of ["consult-booked", "consulted", "quoted", "won"]) {
    const moved = applyStageMove(deps, actorId, opportunity, { to });
    if (!moved.ok) return fail(row.line, "the project couldn’t be marked won.");
    opportunity = moved.value;
  }
  const converted = applyConversion(deps, actorId, opportunity);
  if (!converted.ok) return fail(row.line, "the project couldn’t be started.");

  const links = [
    { kind: "repository", url: project.repository, label: "Code", shared: false },
    { kind: "live", url: project.live, label: "Live site", shared: true },
  ];
  for (const link of links) {
    if (!link.url) continue;
    const added = newProjectLink({ id: deps.newId(), projectId: converted.value.id, createdBy: actorId }, { kind: link.kind, label: link.label, url: link.url, shared: link.shared });
    if (!added.ok) return fail(row.line, `the ${link.kind === "live" ? "live site" : "repository"} ${LINK_PROBLEMS[added.error] ?? "couldn’t be added."}`);
    deps.links.insert(added.value, at);
    recordActivity(deps, { actorId, action: "project.link-added", recordType: "project", recordId: converted.value.id, context: { kind: added.value.kind, url: added.value.url, shared: added.value.shared } });
  }
  return ok(true as const);
}

/** One line for a refusal. */
export function importProblem(failure: ImportFailure): string {
  const [code, first = "", ...rest] = failure.split(":");
  switch (code) {
    case "forbidden":
      return "You don’t have permission to import clients.";
    case "empty":
      return "Paste a header line, then at least one client.";
    case "too-many-rows":
      return "Up to 200 clients at a time.";
    case "unknown-column":
      return `“${[first, ...rest].join(":")}” isn’t a column HQ knows. The columns are listed under the box.`;
    case "no-client-column":
      return "The header needs a Client column.";
    case "unclosed-quote":
      return `Line ${first} opens a quote it doesn’t close.`;
    case "row":
      return `Line ${first}: ${rest.join(":")} Nothing was imported.`;
    default:
      return "That didn’t work. Try again.";
  }
}
