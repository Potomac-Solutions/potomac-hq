// Notices' addresses: opening one (marks it read and goes to its task),
// marking all read, emailing them or not, and a task's reminders.
import { Hono } from "hono";
import { addReminder, markAllNoticesRead, openNotice, removeReminder, setNoticeEmail, setNoticePreferences, type NoticesDeps } from "../application/notices.ts";
import { formPosts, parseId, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  unchanged: "Nothing changed.",
  "invalid-reminder": "Choose a day and time, or how many days before it's due (0 to 30) and a time.",
  "reminder-in-the-past": "That time has passed. Choose a time from now on.",
  "invalid-mode": "Choose right away, the morning digest or never for each kind.",
  "invalid-hours": "Choose when quiet hours start and end, and make them different, or choose no quiet hours for both.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

type Deps = { readonly notices: NoticesDeps; readonly actorOf: (cookieHeader: string) => Id | null; readonly sign: (location: string) => string };

/** Forms. */
export function noticeRoutes(deps: Deps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/notices" });
  const task = (id: Id | null) => `/tasks/${id ?? ""}#reminders`;
  post("/notices/read-all", (actor) => markAllNoticesRead(deps.notices, actor), { done: () => "/notices", back: () => "/notices", message: "All marked read." });
  post("/notices/email", (actor, f) => setNoticeEmail(deps.notices, actor, f["on"] === "1"), {
    done: () => "/notices#email",
    back: () => "/notices#email",
    message: (on) => (on ? "Your notices will be emailed to you." : "Your notices won't be emailed."),
  });
  post("/notices/preferences", (actor, f) => setNoticePreferences(deps.notices, actor, { modes: { assigned: f["assigned"] ?? "now", mentioned: f["mentioned"] ?? "now", reminder: f["reminder"] ?? "now" }, quietFrom: f["quietFrom"] ?? "", quietTo: f["quietTo"] ?? "" }), {
    done: () => "/notices#email",
    back: () => "/notices#email",
    message: "Saved. The bell still shows every notice.",
  });
  post(
    "/tasks/:id/reminders",
    (actor, f, id) =>
      addReminder(deps.notices, actor, id as Id, {
        ...(f["kind"] === "at" ? { kind: "at" as const, when: f["when"] ?? "" } : { kind: "before" as const, daysBefore: f["daysBefore"] ?? "", time: f["time"] ?? "" }),
        forWhom: f["forWhom"] ?? "me",
        carry: f["carry"] === "1",
      }),
    { done: (_, id) => task(id), back: (id) => task(id), message: "Reminder set." },
  );
  post("/reminders/:id/remove", (actor, _f, id) => removeReminder(deps.notices, actor, id as Id), {
    done: (reminder) => task(reminder.taskId),
    back: () => "/notices",
    message: "Reminder removed.",
  });
  return app;
}

/** Opening a notice: a plain link, so it marks it read on the way to its task. */
export function noticeLinks(deps: Omit<Deps, "sign">): Hono {
  const app = new Hono();
  app.get("/notices/:id", (c) => {
    const id = parseId(c.req.param("id"));
    const opened = id.ok ? openNotice(deps.notices, deps.actorOf(c.req.header("cookie") ?? ""), id.value) : null;
    return c.redirect(opened?.ok ? opened.value : "/notices", 303);
  });
  return app;
}
