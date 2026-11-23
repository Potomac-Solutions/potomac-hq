// Importing clients from a pasted CSV. Done, it says what was added and
// what was skipped; refused, it says which line and why, and nothing is saved.
import { Hono } from "hono";
import { importClientsSafely, importProblem, type ImportDeps } from "../application/import.ts";
import { readForm, withMessage, type Id } from "../../shared/index.ts";

export type ImportRoutesDeps = {
  readonly clientImport: ImportDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function importRoutes(deps: ImportRoutesDeps): Hono {
  const app = new Hono();
  app.post("/clients/import", async (c) => {
    const { fields } = await readForm(c);
    const go = (to: string, name: "done" | "problem", message: string) => c.redirect(deps.sign(withMessage(to, name, message)), 303);
    const done = importClientsSafely(deps.clientImport, deps.actorOf(c.req.header("cookie") ?? ""), fields["rows"] ?? "");
    if (!done.ok) return go("/clients/import", "problem", importProblem(done.error));
    const { added, skipped, projects, demos } = done.value;
    if (added.length === 0) return go("/clients/import", "problem", `Every client there is already in HQ (${skipped.length}), so nothing was added.`);
    const parts = [`Imported ${count(added.length, "client")}`];
    if (projects > 0) parts.push(`with ${count(projects, "project")}`);
    const tail = [demos > 0 ? `${count(demos, "is a demo", "are demos")}.` : "", skipped.length > 0 ? `Skipped ${count(skipped.length, "client")} already in HQ: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}.` : ""].filter(Boolean);
    return go(demos === added.length ? "/clients?kind=demo" : "/clients", "done", `${parts.join(" ")}. ${tail.join(" ")}`.trim());
  });
  return app;
}
