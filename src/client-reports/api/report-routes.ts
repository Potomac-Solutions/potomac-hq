// Monthly reports' forms (decision 0013, section 4).
import { Hono } from "hono";
import { draftReportsNow, saveReportNote, sendReport, skipReport, type ReportsDeps } from "../application/reports.ts";
import { formPosts, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "note-too-long": "Keep your line under 1,000 characters.",
  "not-draft": "That report has already been sent or skipped.",
  "no-email": "Nobody at this client has an email to send it to. Add one to their primary contact.",
  "email-off": "Email isn’t set up, so nothing can be sent yet.",
  "send-failed": "The email couldn’t be sent. It’s still a draft; try again in a minute.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

export function reportRoutes(deps: { readonly reports: ReportsDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string; readonly mail: ((message: { readonly to: string; readonly subject: string; readonly body: string }) => Promise<boolean>) | null; readonly contactLine: string }): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/monthly-reports" });
  post("/monthly-reports/draft", (actor) => draftReportsNow(deps.reports, actor), {
    done: () => "/monthly-reports",
    back: () => "/monthly-reports",
    message: (made) => (made.drafted === 0 ? "Every plan client already has last month’s report." : `Drafted ${made.drafted} ${made.drafted === 1 ? "report" : "reports"}.`),
  });
  post("/monthly-reports/:id/note", (actor, f, id) => saveReportNote(deps.reports, actor, id as Id, f["note"] ?? ""), {
    done: (_r, id) => `/monthly-reports/${id}`,
    back: (id) => `/monthly-reports/${id}`,
    message: "Saved. It’s at the top of the email.",
  });
  post("/monthly-reports/:id/send", (actor, _f, id) => sendReport(deps.reports, actor, id as Id, deps.mail, deps.contactLine), {
    done: () => "/monthly-reports",
    back: (id) => `/monthly-reports/${id}`,
    message: (sent) => `Sent to ${sent.to}. It’s in their portal too.`,
  });
  post("/monthly-reports/:id/skip", (actor, _f, id) => skipReport(deps.reports, actor, id as Id), {
    done: () => "/monthly-reports",
    back: (id) => `/monthly-reports/${id}`,
    message: "Skipped. Nothing was sent.",
  });
  return app;
}
