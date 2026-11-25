// Who looked at a demo (decision 0013, section 8). Potomac keeps the Lab's
// demos and their demo sign-ins (`demo.manage`). From an opportunity, anyone
// who may log a call (`contact.edit`) emails the contact a link to each demo
// chosen; each link is its own short address that counts opens and sends
// them on. Opens show on the opportunity, and on Today until someone talks
// to them or two days pass.
import { demoEmail, demoFields, FOLLOW_UP_HOURS, isAutomated, isLinkCode, linkCode, type Demo, type DemoError } from "../domain/demo.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { DemoLinkStore, DemoStore } from "./ports.ts";

export type DemosDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly demos: DemoStore;
  readonly links: DemoLinkStore;
  readonly formatWhen: (instant: string) => string;
  readonly random: (length: number) => Uint8Array;
  /** An opportunity's title, client, and who to email: its contact, or the client's primary. */
  readonly opportunity: (id: Id) => { readonly title: string; readonly organizationId: Id; readonly clientName: string; readonly to: { readonly name: string; readonly email: string } | null } | null;
  /** When someone last logged a call, email or meeting with the opportunity's client. */
  readonly lastTouchAt: (opportunityId: Id) => string | null;
};

type Refused = "forbidden" | "not-found";
const may = (deps: DemosDeps, actorId: Id | null, permission: string): actorId is Id => actorId !== null && authorize(deps, actorId, permission).ok;

// ---------- The demos ----------

export type DemoInput = { readonly name: string; readonly url: string; readonly description?: string | null; readonly signIn?: string | null };

export function addDemo(deps: DemosDeps, actorId: Id | null, input: DemoInput): Result<Demo, "forbidden" | DemoError> {
  if (!may(deps, actorId, "demo.manage")) return err("forbidden");
  const fields = demoFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    const demo: Demo = { id: deps.newId(), ...fields.value, active: true };
    deps.demos.insert(demo, deps.clock());
    recordActivity(deps, { actorId, action: "demo.added", recordType: "demo", recordId: demo.id, context: { name: demo.name } });
    return ok(demo);
  });
}

export function editDemo(deps: DemosDeps, actorId: Id | null, id: Id, input: DemoInput & { readonly active: boolean }): Result<Demo, Refused | DemoError> {
  if (!may(deps, actorId, "demo.manage")) return err("forbidden");
  const fields = demoFields(input);
  if (!fields.ok) return fields;
  return deps.transact(() => {
    const found = deps.demos.get(id);
    if (!found) return err("not-found");
    const demo: Demo = { ...found, ...fields.value, active: input.active };
    deps.demos.save(demo, deps.clock());
    recordActivity(deps, { actorId, action: "demo.changed", recordType: "demo", recordId: id, context: { name: demo.name, active: demo.active } });
    return ok(demo);
  });
}

/** Removes a demo never sent. One that was sent stays, so its links keep working: turn it off instead. */
export function removeDemo(deps: DemosDeps, actorId: Id | null, id: Id): Result<Demo, Refused | "in-use"> {
  if (!may(deps, actorId, "demo.manage")) return err("forbidden");
  return deps.transact(() => {
    const found = deps.demos.get(id);
    if (!found) return err("not-found");
    if (deps.demos.everSent(id)) return err("in-use");
    deps.demos.remove(id);
    recordActivity(deps, { actorId, action: "demo.removed", recordType: "demo", recordId: id, context: { name: found.name } });
    return ok(found);
  });
}

export type DemosView = { readonly demos: readonly (Demo & { readonly sent: boolean })[] };

export function demosList(deps: DemosDeps, actorId: Id | null): Result<DemosView, "forbidden"> {
  if (!may(deps, actorId, "demo.manage")) return err("forbidden");
  return ok({ demos: deps.demos.list().map((one) => ({ ...one, sent: deps.demos.everSent(one.id) })) });
}

// ---------- Sending, and opening ----------

/**
 * Makes a link for each chosen demo and writes the email that sends them.
 * Emailing it is the route's job; the links are only kept once it went.
 */
export function prepareDemoEmail(deps: DemosDeps, actorId: Id | null, opportunityId: Id, input: { readonly demoIds: readonly Id[]; readonly note: string }, publicUrl: string): Result<{ readonly to: { readonly name: string; readonly email: string }; readonly subject: string; readonly body: string; readonly links: readonly { readonly id: Id; readonly code: string; readonly demoId: Id }[] }, Refused | "no-demos" | "no-email" | "note-too-long"> {
  if (!may(deps, actorId, "contact.edit")) return err("forbidden");
  const opportunity = deps.opportunity(opportunityId);
  if (!opportunity) return err("not-found");
  if (!opportunity.to) return err("no-email");
  const note = input.note.replace(/\r\n/g, "\n").trim();
  if (note.length > 1000) return err("note-too-long");
  const demos = input.demoIds.map((id) => deps.demos.get(id)).filter((one): one is Demo => one !== null && one.active);
  if (demos.length === 0) return err("no-demos");
  const links = demos.map((demo) => ({ id: deps.newId(), code: linkCode(deps.random(8)), demoId: demo.id }));
  const mail = demoEmail({ firstName: opportunity.to.name.split(/\s+/)[0] ?? "", note, demos: demos.map((demo, i) => ({ name: demo.name, description: demo.description, link: `${publicUrl}/d/${links[i]?.code ?? ""}`, signIn: demo.signIn })) });
  return ok({ to: opportunity.to, ...mail, links });
}

/** The email went: its links start counting. */
export function recordDemosSent(deps: DemosDeps, actorId: Id, opportunityId: Id, links: readonly { readonly id: Id; readonly code: string; readonly demoId: Id }[]): void {
  deps.transact(() => {
    const at = deps.clock();
    for (const link of links) deps.links.insert({ ...link, opportunityId, sentAt: at, sentBy: actorId });
    recordActivity(deps, { actorId, action: "demo.sent", recordType: "opportunity", recordId: opportunityId, context: { demos: links.map((one) => one.demoId) } });
  });
}

/**
 * Someone opened /d/<code>: count it, unless it's a program, and send them on.
 * No activity event: an open is a fact about a link, not a change anyone made.
 */
export function openDemoLink(deps: DemosDeps, typedCode: string, userAgent: string): string | null {
  const code = typedCode.trim().toLowerCase();
  if (!isLinkCode(code)) return null;
  const link = deps.links.byCode(code);
  const demo = link ? deps.demos.get(link.demoId) : null;
  if (!link || !demo) return null;
  if (!isAutomated(userAgent)) deps.links.addOpen(link.id, deps.clock());
  return demo.url;
}

export type OpportunityDemos = {
  readonly canSend: boolean;
  readonly emailTo: string;
  readonly choices: readonly { readonly id: string; readonly name: string }[];
  readonly sent: readonly { readonly id: string; readonly name: string; readonly sent: string; readonly opens: number; readonly lastOpened: string }[];
};

/** What demos an opportunity was sent and opened, and what can be sent. */
export function opportunityDemos(deps: DemosDeps, actorId: Id | null, opportunityId: Id): OpportunityDemos | null {
  if (!may(deps, actorId, "opportunity.view")) return null;
  const opportunity = deps.opportunity(opportunityId);
  if (!opportunity) return null;
  const names = new Map(deps.demos.list().map((one) => [one.id, one.name]));
  return {
    canSend: may(deps, actorId, "contact.edit"),
    emailTo: opportunity.to?.email ?? "",
    choices: deps.demos.list().filter((one) => one.active).map((one) => ({ id: one.id, name: one.name })),
    sent: deps.links.forOpportunity(opportunityId).map((link) => ({ id: link.id, name: names.get(link.demoId) ?? "A demo", sent: deps.formatWhen(link.sentAt), opens: link.opens, lastOpened: link.lastOpenedAt ? deps.formatWhen(link.lastOpenedAt) : "" })),
  };
}

export type DemoFollowUp = { readonly opportunityId: string; readonly text: string; readonly detail: string; readonly at: string };

/** Prospects who opened a demo in the last two days and haven't been talked to since, for Today. */
export function demoFollowUps(deps: DemosDeps, actorId: Id | null): readonly DemoFollowUp[] {
  if (!may(deps, actorId, "opportunity.view")) return [];
  const since = Temporal.Instant.from(deps.clock()).subtract({ hours: FOLLOW_UP_HOURS }).toString();
  return deps.links.openedSince(since).flatMap((one) => {
    const touched = deps.lastTouchAt(one.opportunityId);
    if (touched && Temporal.Instant.compare(touched, one.lastOpenedAt) > 0) return [];
    const opportunity = deps.opportunity(one.opportunityId);
    if (!opportunity) return [];
    const who = opportunity.to?.name || opportunity.clientName;
    return [{ opportunityId: one.opportunityId, text: `${who} looked at ${one.demos.join(" and ")}: follow up`, detail: `${opportunity.clientName} · ${one.opens} ${one.opens === 1 ? "open" : "opens"}, last ${deps.formatWhen(one.lastOpenedAt)}`, at: one.lastOpenedAt }];
  });
}
