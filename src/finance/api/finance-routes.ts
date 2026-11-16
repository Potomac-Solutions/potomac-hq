// The finance module's form posts, and its CSV downloads.
import { Hono } from "hono";
import * as finance from "../application/commands.ts";
import { exportFinance } from "../application/queries.ts";
import { formPosts, parseId, type FormFields, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export type FinanceRoutesDeps = {
  readonly finance: finance.FinanceDeps;
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
    { done: (_, _id, f) => back(f, "/time"), back: (_id, f) => back(f, "/time"), message: "Time logged." },
  );
  post("/time/:id/remove", (actor, _f, id) => finance.removeTime(deps.finance, actor, id as Id), { done: (_, _id, f) => back(f, "/time"), back: (_id, f) => back(f, "/time"), message: "Entry removed." });
  post("/timer/stop", (actor) => finance.stopTimer(deps.finance, actor), { done: (_, _id, f) => back(f, "/time"), back: (_id, f) => back(f, "/time"), message: "Timer stopped and the time logged." });
  post(
    "/projects/:id/expenses",
    (actor, f, id, files) => finance.addExpense(deps.finance, actor, id as Id, { category: f["category"] ?? "", amount: f["amount"] ?? "", on: f["on"] ?? "", note: f["note"] ?? null, receipt: files["receipt"] ?? null }),
    { done: (_, id) => `${money(id)}#expenses`, back: (id) => `${money(id)}#expenses`, message: "Expense recorded." },
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
  return app;
}

/** GET /exports/time.csv, /exports/expenses.csv and /exports/projects.csv. Refused and unknown both answer 404. */
export function financeDownloads(deps: Pick<FinanceRoutesDeps, "finance" | "actorOf">): Hono {
  const app = new Hono();
  app.get("/exports/:file", (c) => {
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
