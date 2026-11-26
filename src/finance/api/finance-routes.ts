// The finance module's form posts, and its CSV downloads.
import { Hono } from "hono";
import * as finance from "../application/commands.ts";
import { exportFinance, invoiceDocument, type InvoiceDocument } from "../application/queries.ts";
import * as reminders from "../application/reminders.ts";
import * as changes from "../application/change-requests.ts";
import { setLateFee, type LateDeps } from "../application/late-invoices.ts";
import { taxPack } from "../application/tax-pack.ts";
import { formPosts, parseId, type FormFields, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export type FinanceRoutesDeps = {
  readonly finance: finance.FinanceDeps;
  readonly reminders?: LateDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

// Where a timer or a removal may send the browser back to. Nothing else.
const RETURN = /^\/(time(\?[a-z0-9=&-]{0,60})?|board(\?mine=1)?|tasks\/[0-9a-f-]{36}|projects\/[0-9a-f-]{36}\/(money|board|tasks))?$/;
const back = (form: FormFields, otherwise: string): string => (RETURN.test(form["returnTo"] ?? "") && form["returnTo"] ? (form["returnTo"] as string) : otherwise);

/** "projectId" or "projectId:taskId", from the quick-entry form's one select. */
function target(value: string | undefined): { projectId: Id; taskId: Id | null } | null {
  const [projectText = "", taskText] = (value ?? "").split(":");
  const project = parseId(projectText);
  const task = taskText === undefined ? null : parseId(taskText);
  if (!project.ok || (task !== null && !task.ok)) return null;
  return { projectId: project.value, taskId: task ? task.value : null };
}

export function financeRoutes(deps: FinanceRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/time" });
  const money = (id: Id | null) => (id ? `/projects/${id}/money` : "/money");

  post(
    "/time",
    (actor, f) => {
      const where = target(f["target"]);
      if (!where) return { ok: false as const, error: "task-not-in-project" };
      return finance.logTime(deps.finance, actor, where, { on: f["on"] ?? "", hours: f["hours"] ?? "", note: f["note"] ?? null, billable: f["billable"] === "on" });
    },
    {
      done: (_, _id, f) => back(f, "/time"),
      back: (_id, f) => back(f, "/time"),
      message: "Time logged.",
      undo: (entry, _id, f) => ({ label: "Time logged", action: `/time/${entry.id}/remove`, fields: f["returnTo"] ? { returnTo: f["returnTo"] } : {} }),
    },
  );
  post("/time/:id/remove", (actor, _f, id) => finance.removeTime(deps.finance, actor, id as Id), { done: (_, _id, f) => back(f, "/time"), back: (_id, f) => back(f, "/time"), message: "Entry removed." });
  post("/timer/stop", (actor) => finance.stopTimer(deps.finance, actor), { done: (_, _id, f) => back(f, "/time"), back: (_id, f) => back(f, "/time"), message: "Timer stopped and the time logged." });
  post(
    "/projects/:id/expenses",
    (actor, f, id, files) => finance.addExpense(deps.finance, actor, id as Id, { category: f["category"] ?? "", amount: f["amount"] ?? "", on: f["on"] ?? "", note: f["note"] ?? null, receipt: files["receipt"] ?? null }),
    {
      done: (_, id) => `${money(id)}#expenses`,
      back: (id) => `${money(id)}#expenses`,
      message: "Expense recorded.",
      undo: (expense) => ({ label: "Expense recorded", action: `/expenses/${expense.id}/remove`, fields: {} }),
    },
  );
  post("/expenses/:id/remove", (actor, _f, id) => finance.removeExpense(deps.finance, actor, id as Id), {
    done: (expense) => `${money(expense.projectId)}#expenses`,
    back: (_id, f) => back(f, "/money"),
    message: "Expense removed.",
  });
  post("/projects/:id/budget", (actor, f, id) => finance.setProjectBudget(deps.finance, actor, id as Id, { amount: f["amount"] ?? "", hours: f["hours"] ?? "", rate: f["rate"] ?? "" }), {
    done: (_, id) => money(id),
    back: (id) => money(id),
    message: "Budget saved.",
  });
  post("/projects/:id/payment", (actor, f, id) => finance.setProjectPayment(deps.finance, actor, id as Id, { status: f["status"] ?? "", invoiceRef: f["invoiceRef"] ?? null }), {
    done: (_, id) => money(id),
    back: (id) => money(id),
    message: "Payment status saved.",
  });
  const invoice = (id: Id | null) => (id ? `/invoices/${id}` : "/money");
  post(
    "/projects/:id/invoices",
    (actor, f, id) => finance.createInvoice(deps.finance, actor, id as Id, { kind: f["kind"] ?? "", description: f["description"] ?? "", amount: f["amount"] ?? "", dueOn: f["dueOn"] ?? null, note: f["note"] ?? null }),
    { done: (made) => invoice(made.id), back: (id) => `${money(id)}#invoices`, message: "Invoice drafted. Check it, then send it." },
  );
  post(
    "/clients/:id/invoices",
    (actor, f, id) => finance.createClientInvoice(deps.finance, actor, id as Id, { kind: f["kind"] ?? "other", description: f["description"] ?? "", amount: f["amount"] ?? "", dueOn: f["dueOn"] ?? null, note: f["note"] ?? null }, { send: f["send"] === "on" }),
    { done: (made) => invoice(made.id), back: (id) => `/clients/${id ?? ""}#invoices`, message: (made) => (made.status === "sent" ? "Invoice sent. It’s in the client’s portal." : "Invoice drafted. Check it, then send it.") },
  );
  post("/invoices/:id/lines", (actor, f, id) => finance.addLineToInvoice(deps.finance, actor, id as Id, { description: f["description"] ?? "", amount: f["amount"] ?? "" }), {
    done: (_, id) => invoice(id),
    back: (id) => invoice(id),
    message: "Line added.",
  });
  if (deps.reminders) {
    const remindersDeps = deps.reminders;
    post("/money/late-fee", (actor, f) => setLateFee(remindersDeps, actor, { kind: f["kind"] ?? "", amount: f["amount"] ?? null, afterDays: f["afterDays"] ?? null }), {
      done: () => "/money#late-fees",
      back: () => "/money#late-fees",
      message: (setting) => (setting.kind === "off" ? "Late fees are off." : "Saved. HQ charges it each morning on invoices that reach the day."),
    });
    post("/money/reminders", (actor, f) => reminders.setInvoiceReminders(remindersDeps, actor, f["on"] === "1"), {
      done: (made) => "/money#reminders",
      back: () => "/money#reminders",
      message: "Saved.",
    });
    post("/invoices/:id/reminders", (actor, f, id) => reminders.setRemindersForInvoice(remindersDeps, actor, id as Id, f["off"] === "1"), { done: (_, id) => `${invoice(id)}#reminders`, back: (id) => invoice(id), message: "Saved." });
  }
  post("/projects/:id/changes", (actor, f, id) => changes.addChangeRequest(deps.finance, actor, id as Id, { title: f["title"] ?? "", description: f["description"] ?? null, amount: f["amount"] ?? "", hours: f["hours"] ?? null }), {
    done: (_, id) => `/projects/${id}/money#changes`,
    back: (id) => `/projects/${id}/money#changes`,
    message: "Change drafted. Send it when it’s right.",
  });
  post("/changes/:id/send", (actor, _f, id) => changes.sendChangeRequest(deps.finance, actor, id as Id), { done: (c) => `/projects/${c.projectId}/money#changes`, back: () => "/money", message: "Sent. It’s in the client’s portal, waiting for their answer." });
  post("/changes/:id/withdraw", (actor, _f, id) => changes.withdrawChangeRequest(deps.finance, actor, id as Id), { done: (c) => `/projects/${c.projectId}/money#changes`, back: () => "/money", message: "Withdrawn." });
  post("/changes/:id/decision", (actor, f, id) => changes.recordChangeDecision(deps.finance, actor, id as Id, { decision: f["decision"] ?? "", note: f["note"] ?? null }), {
    done: (c) => `/projects/${c.projectId}/money#changes`,
    back: () => "/money",
    message: "Answer recorded.",
  });
  post("/projects/:id/recurring", (actor, f, id) => finance.addRecurringInvoice(deps.finance, actor, id as Id, { description: f["description"] ?? "", amount: f["amount"] ?? "", every: f["every"] ?? "", firstOn: f["firstOn"] ?? "", endsOn: f["endsOn"] ?? null, autoSend: f["autoSend"] === "1", dueDays: f["dueDays"] ?? null }), {
    done: (_, id) => `${money(id)}#recurring`,
    back: (id) => `${money(id)}#recurring`,
    message: "Recurring invoice set up. HQ makes each one on its day.",
  });
  // A plan on the client alone: hosting, upkeep. Billed by HQ the same way.
  post("/clients/:id/recurring", (actor, f, id) => finance.addClientRecurringInvoice(deps.finance, actor, id as Id, { description: f["description"] ?? "", amount: f["amount"] ?? "", every: f["every"] ?? "", firstOn: f["firstOn"] ?? "", endsOn: f["endsOn"] ?? null, autoSend: f["autoSend"] === "1", dueDays: f["dueDays"] ?? null }), {
    done: (_, id) => `/clients/${id ?? ""}#billing`,
    back: (id) => `/clients/${id ?? ""}#billing`,
    message: "Saved. HQ makes each invoice on its day.",
  });
  post("/clients/:id/prepaid", (actor, f, id) => finance.addPrepaidHours(deps.finance, actor, id as Id, { hours: f["hours"] ?? "", boughtOn: f["boughtOn"] ?? "", note: f["note"] ?? null, price: f["price"] ?? null, send: f["send"] === "on" }), {
    done: (_, id) => `/clients/${id ?? ""}#billing`,
    back: (id) => `/clients/${id ?? ""}#billing`,
    message: (block) => (block.invoiceId ? "Saved, with its invoice." : "Saved. Time logged on their projects now draws it down."),
  });
  post("/money/pay-instructions", (actor, f) => finance.setPayInstructions(deps.finance, actor, f["instructions"] ?? ""), { done: () => "/money#how-to-pay", back: () => "/money#how-to-pay", message: "Saved. Clients see it in their portal." });
  const recurringHome = (made: { readonly projectId: Id | null; readonly organizationId: Id }) => (made.projectId ? `${money(made.projectId)}#recurring` : `/clients/${made.organizationId}#billing`);
  post("/recurring/:id/pause", (actor, f, id) => finance.setRecurringActive(deps.finance, actor, id as Id, false), { done: (made) => recurringHome(made), back: () => "/money#recurring", message: "Paused. No invoices until it is started again." });
  post("/recurring/:id/resume", (actor, f, id) => finance.setRecurringActive(deps.finance, actor, id as Id, true), { done: (made) => recurringHome(made), back: () => "/money#recurring", message: "Started again, from its next day. Nothing is billed for the paused time." });
  // Several drafts at once: each ticked box is invoice-<id>.
  post("/projects/:id/invoices/send", (actor, f, id) => finance.sendInvoicesNow(deps.finance, actor, id as Id, Object.keys(f).filter((key) => key.startsWith("invoice-") && f[key] === "on").map((key) => key.slice(8)), f["checked"] === "on"), {
    done: (_, id) => `/projects/${id ?? ""}/money#invoices`,
    back: (id) => `/projects/${id ?? ""}/money#invoices`,
    message: (result) => (result.skipped > 0 ? `Marked ${result.sent} sent. ${result.skipped} couldn’t be (only drafts can).` : result.sent === 1 ? "Marked 1 sent." : `Marked ${result.sent} sent.`),
  });
  post("/invoices/:id/send", (actor, _f, id) => finance.sendInvoiceNow(deps.finance, actor, id as Id), { done: (_, id) => invoice(id), back: (id) => invoice(id), message: "Invoice sent. Download the PDF to give it to the client." });
  post("/invoices/:id/promise", (actor, f, id) => finance.promiseInvoicePayment(deps.finance, actor, id as Id, { on: f["on"] ?? "", note: f["note"] ?? null }), { done: (_, id) => `${invoice(id)}#follow-up`, back: (id) => `${invoice(id)}#follow-up`, message: (changed) => (changed.promisedOn ? "Saved. Today will remind you that day." : "The promise is cleared.") });
  post("/invoices/:id/pay-link", (actor, f, id) => finance.setInvoicePayLink(deps.finance, actor, id as Id, f["link"] ?? ""), { done: (_, id) => `${invoice(id)}#follow-up`, back: (id) => `${invoice(id)}#follow-up`, message: (changed) => (changed.payLink ? "Saved. The client sees “Pay by card” in their portal." : "The link is removed.") });
  post("/invoices/:id/write-off", (actor, f, id) => finance.writeOffInvoice(deps.finance, actor, id as Id, { note: f["note"] ?? "" }), { done: (_, id) => invoice(id), back: (id) => `${invoice(id)}#follow-up`, message: "Written off. It’s no longer owed." });
  post("/invoices/:id/void", (actor, _f, id) => finance.voidInvoiceNow(deps.finance, actor, id as Id), { done: (_, id) => invoice(id), back: (id) => invoice(id), message: "Invoice voided." });
  post(
    "/invoices/:id/payments",
    (actor, f, id) => finance.recordPayment(deps.finance, actor, id as Id, { amount: f["amount"] ?? "", method: f["method"] ?? "", on: f["on"] ?? "", reference: f["reference"] ?? null }),
    { done: (_, id) => invoice(id), back: (id) => invoice(id), message: "Payment recorded." },
  );
  return app;
}

/** The CSV exports under /exports, and an invoice's PDF. Refused and unknown both answer 404. */
export function financeDownloads(deps: Pick<FinanceRoutesDeps, "finance" | "actorOf"> & { readonly renderInvoicePdf: (document: InvoiceDocument) => Uint8Array<ArrayBuffer> }): Hono {
  const app = new Hono();
  app.get("/invoices/:id/pdf", (c) => {
    const id = parseId(c.req.param("id"));
    const found = id.ok ? invoiceDocument(deps.finance, deps.actorOf(c.req.header("cookie") ?? ""), id.value) : null;
    if (!found || !found.ok) return c.text("Not found", 404);
    const body = deps.renderInvoicePdf(found.value);
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/pdf", "content-length": String(body.length), "content-disposition": `attachment; filename="${found.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  });
  app.get("/exports/:file", (c) => {
    // The year-end tax pack (2026-11-26): a zip.
    const pack = /^tax-pack-(\d{4})\.zip$/.exec(c.req.param("file"));
    if (pack) {
      const made = taxPack(deps.finance, deps.actorOf(c.req.header("cookie") ?? ""), Number(pack[1]));
      if (!made.ok) return c.text("Not found", 404);
      return new Response(made.value.bytes, {
        status: 200,
        headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${made.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }
    const match = /^([a-z]+)\.csv$/.exec(c.req.param("file"));
    const made = match ? exportFinance(deps.finance, deps.actorOf(c.req.header("cookie") ?? ""), match[1] as string) : null;
    if (!made || !made.ok) return c.text("Not found", 404);
    return new Response(made.value.csv, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${made.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  });
  return app;
}
