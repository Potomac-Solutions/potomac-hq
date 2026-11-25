// The projects module's form posts. Each one calls an application service,
// then sends the browser back to a page with a one-line message.
import { Hono } from "hono";
import * as projects from "../application/commands.ts";
import * as work from "../application/work.ts";
import * as quick from "../application/quick-add.ts";
import * as links from "../application/dependencies.ts";
import * as talk from "../application/comments.ts";
import * as repeating from "../application/repeating.ts";
import * as calendar from "../application/calendar.ts";
import * as sharing from "../application/share.ts";
import * as importing from "../application/task-import.ts";
import { formatHours, formPosts, parseId, readForm, withMessage, type FormFields, type Id } from "../../shared/index.ts";
import { messageFor } from "./messages.ts";

export type ProjectRoutesDeps = {
  readonly projects: projects.ProjectsDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  /** The page that shows a new calendar address, once. */
  readonly feedPage?: (view: { readonly address: string; readonly replaced: boolean }) => string;
  /** The page that shows a new share link, once. */
  readonly sharePage?: (view: { readonly address: string; readonly label: string; readonly rights: string; readonly projectId: string }) => string;
  /** HQ's own address, for calendar addresses; the request's when unset. */
  readonly publicUrl?: string;
};

/** An optional id from a form field. Anything that is not an id is "none". */
const optionalId = (value: string | undefined): Id | null => {
  const parsed = value ? parseId(value) : null;
  return parsed && parsed.ok ? parsed.value : null;
};

// A task can be moved from four places. Only these are accepted, so a form
// cannot send the browser anywhere else.
const RETURN = /^\/(board|projects\/[0-9a-f-]{36}\/(board|tasks)|tasks\/[0-9a-f-]{36})(\?mine=1)?$/;

export function projectRoutes(deps: ProjectRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/projects" });
  const project = (id: Id | null) => (id ? `/projects/${id}` : "/projects");
  const taskInput = (f: FormFields) => ({
    title: f["title"] ?? "",
    description: f["description"] ?? null,
    assigneeId: optionalId(f["assigneeId"]),
    phaseId: optionalId(f["phaseId"]),
    priority: f["priority"] ?? null,
    dueOn: f["dueOn"] ?? null,
    // Only forms with a start field change it; others keep what the task had.
    ...(f["startOn"] !== undefined ? { startOn: f["startOn"] } : {}),
    estimate: f["estimate"] ?? null,
  });

  post("/projects/:id/links", (actor, f, id) => projects.addProjectLink(deps.projects, actor, id as Id, { kind: f["kind"] ?? "", label: f["label"] ?? null, url: f["url"] ?? "", shared: f["shared"] === "1" }), {
    done: (_, id) => `${project(id)}#links`,
    back: (id) => `${project(id)}#links`,
    message: "Link added.",
  });
  post("/project-links/:id/remove", (actor, _f, id) => projects.removeProjectLink(deps.projects, actor, id as Id), { done: (link) => `${project(link.projectId)}#links`, back: () => "/projects", message: "Link removed." });
  post(
    "/projects/:id",
    (actor, f, id) => projects.editProjectDetails(deps.projects, actor, id as Id, { name: f["name"] ?? "", description: f["description"] ?? null, health: f["health"] ?? "", startOn: f["startOn"] ?? null, targetOn: f["targetOn"] ?? null }),
    {
      done: (_, id) => project(id),
      back: (id) => project(id),
      message: "Project saved.",
      undo: ({ previous: p }, id) => ({ action: `/projects/${id}`, fields: { name: p.name, description: p.description, health: p.health, startOn: p.startOn ?? "", targetOn: p.targetOn ?? "" } }),
    },
  );
  post("/projects/:id/status", (actor, f, id) => projects.setProjectStatus(deps.projects, actor, id as Id, f["status"] ?? ""), {
    done: (_, id) => project(id),
    back: (id) => project(id),
    message: "Status changed.",
    undo: (changed, id) => (changed.undoable ? { action: `/projects/${id}/status`, fields: { status: changed.from } } : null),
  });
  post(
    "/projects/:id/owner",
    (actor, f, id) => {
      const owner = optionalId(f["ownerId"]);
      return owner ? projects.setProjectOwner(deps.projects, actor, id as Id, owner) : { ok: false as const, error: "person-not-found" };
    },
    { done: (_, id) => project(id), back: (id) => project(id), message: "Owner changed." },
  );
  post("/projects/:id/phases", (actor, f, id) => projects.addPhase(deps.projects, actor, id as Id, { name: f["name"] ?? "" }), {
    done: (_, id) => `${project(id)}#plan`,
    back: (id) => `${project(id)}#plan`,
    message: "Phase added.",
  });
  post(
    "/projects/:id/milestones",
    (actor, f, id) => projects.addMilestone(deps.projects, actor, id as Id, { name: f["name"] ?? "", dueOn: f["dueOn"] ?? null, phaseId: optionalId(f["phaseId"]), forClient: f["forClient"] === "1" }),
    { done: (_, id) => `${project(id)}#plan`, back: (id) => `${project(id)}#plan`, message: "Milestone added." },
  );
  post("/milestones/:id/for-client", (actor, f, id) => projects.setMilestoneForClient(deps.projects, actor, id as Id, f["forClient"] === "1"), {
    done: (milestone) => `${project(milestone.projectId)}#plan`,
    back: (_, f) => `${project(optionalId(f["projectId"]))}#plan`,
    message: "Saved. The client’s portal shows whose it is to do.",
  });
  post("/milestones/:id/done", (actor, f, id) => projects.setMilestoneDone(deps.projects, actor, id as Id, f["done"] !== "0"), {
    done: (milestone) => `${project(milestone.projectId)}#plan`,
    back: (_, f) => `${project(optionalId(f["projectId"]))}#plan`,
    message: "Milestone saved.",
  });
  post("/projects/:id/tasks", (actor, f, id) => projects.addTask(deps.projects, actor, id as Id, taskInput(f)), {
    done: (_, id) => `${project(id)}/tasks`,
    back: (id) => `${project(id)}/tasks`,
    message: "Task added.",
  });
  post("/tasks/:id", (actor, f, id) => projects.updateTask(deps.projects, actor, id as Id, taskInput(f)), {
    done: (_, id) => `/tasks/${id}`,
    back: (id) => `/tasks/${id}`,
    message: "Task saved.",
    undo: ({ previous: t }, id) => ({
      action: `/tasks/${id}`,
      fields: {
        title: t.title,
        description: t.description,
        assigneeId: t.assigneeId ?? "",
        phaseId: t.phaseId ?? "",
        priority: t.priority,
        dueOn: t.dueOn ?? "",
        startOn: t.startOn ?? "",
        estimate: t.estimateMinutes === null ? "" : formatHours(t.estimateMinutes),
      },
    }),
  });
  const back = (id: Id | null, f: FormFields) => (RETURN.test(f["returnTo"] ?? "") ? (f["returnTo"] as string) : `/tasks/${id}`);
  post("/tasks/:id/status", (actor, f, id) => projects.moveTaskStatus(deps.projects, actor, id as Id, f["to"] ?? ""), {
    done: (_, id, f) => back(id, f),
    back,
    // Blocked tasks may be worked on; this says what they are still waiting on.
    message: (task) =>
      task.status === "doing" && task.waitingOn.length > 0
        ? `Task moved. It is still waiting on ${task.waitingOn.map((title) => `“${title}”`).join(", ")}.`
        : task.next
          ? `Task moved. It repeats, so the next one is due ${task.nextDue}.`
          : "Task moved.",
    // Not after a repeating task made its next one: undoing would leave that one behind.
    undo: (task, id, f) => (task.next ? null : { action: `/tasks/${id}/status`, fields: { to: task.from, ...(RETURN.test(f["returnTo"] ?? "") ? { returnTo: f["returnTo"] as string } : {}) } }),
  });
  // Comments and files on a task. Editing and deleting a comment go back to the task the comment is on.
  post("/tasks/:id/comments", (actor, f, id) => talk.addTaskComment(deps.projects, actor, id as Id, f["body"] ?? ""), {
    done: (comment, id) => `/tasks/${id}#comment-${comment.id}`,
    back: (id) => `/tasks/${id}#comments`,
    message: "Comment added.",
  });
  const onTask = (f: FormFields) => `/tasks/${optionalId(f["taskId"]) ?? ""}#comments`;
  post("/comments/:id", (actor, f, id) => talk.editTaskComment(deps.projects, actor, id as Id, f["body"] ?? ""), {
    done: (comment) => `/tasks/${comment.taskId}#comment-${comment.id}`,
    back: (_id, f) => onTask(f),
    message: "Comment saved.",
  });
  post("/comments/:id/remove", (actor, _f, id) => talk.removeTaskComment(deps.projects, actor, id as Id), {
    done: (comment) => `/tasks/${comment.taskId}#comments`,
    back: (_id, f) => onTask(f),
    message: "Comment deleted.",
  });
  post("/tasks/:id/files", (actor, _f, id, files) => talk.attachToTask(deps.projects, actor, id as Id, files["file"] ?? null), {
    done: (_, id) => `/tasks/${id}#files`,
    back: (id) => `/tasks/${id}#files`,
    message: "File attached.",
  });
  post("/tasks/:id/files/remove", (actor, f, id) => talk.removeTaskFile(deps.projects, actor, id as Id, optionalId(f["fileId"]) ?? ("" as Id)), {
    done: (_, id) => `/tasks/${id}#files`,
    back: (id) => `/tasks/${id}#files`,
    message: (removed) => `Removed “${removed.name}”.`,
  });
  // The calendar address. Making one answers with it, once: never a redirect that would put it in an address bar.
  app.post("/calendar-feed", async (c) => {
    const { fields } = await readForm(c);
    const made = calendar.makeCalendarFeed(deps.projects, deps.actorOf(c.req.header("cookie") ?? ""), optionalId(fields["filterId"]));
    if (!made.ok) return c.redirect(deps.sign(withMessage("/calendar-feed", "problem", messageFor(made.error))), 303);
    const base = (deps.publicUrl || new URL(c.req.url).origin).replace(/\/$/, "");
    const page = deps.feedPage?.({ address: `${base}/calendar/${made.value.token}.ics`, replaced: made.value.replaced }) ?? "";
    return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });
  // Share links. Making one answers with it, once, like the calendar address.
  app.post("/projects/:id/shares", async (c) => {
    const { fields } = await readForm(c);
    const projectId = parseId(c.req.param("id"));
    if (!projectId.ok) return c.redirect(deps.sign(withMessage("/projects", "problem", messageFor("not-found"))), 303);
    const made = sharing.makeShareLink(deps.projects, deps.actorOf(c.req.header("cookie") ?? ""), projectId.value, { label: fields["label"] ?? "", rights: fields["rights"] ?? "", expiresOn: fields["expiresOn"] ?? null });
    if (!made.ok) return c.redirect(deps.sign(withMessage(`/projects/${projectId.value}#share`, "problem", messageFor(made.error))), 303);
    const base = (deps.publicUrl || new URL(c.req.url).origin).replace(/\/$/, "");
    const page = deps.sharePage?.({ address: `${base}/s/${made.value.token}`, label: made.value.link.label, rights: made.value.link.rights, projectId: projectId.value }) ?? "";
    return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  });
  post("/shares/:id/stop", (actor, _f, id) => sharing.stopShareLink(deps.projects, actor, id as Id), {
    done: (link) => `/projects/${link.projectId}#share`,
    back: (_id, f) => `/projects/${optionalId(f["projectId"]) ?? ""}#share`,
    message: (link) => `The link “${link.label}” has stopped working.`,
  });
  // Importing tasks: the export is read and shown first; yes makes it all at once.
  post("/projects/:id/import", (actor, f, id, files) => importing.planTaskImport(deps.projects, actor, id as Id, { source: f["source"] ?? "", file: files["file"] ?? null }), {
    done: (planned) => `/imports/${planned.importId}`,
    back: (id) => `/projects/${id ?? ""}/import`,
    message: "Here's what it would make. Nothing is added until you say so.",
  });
  post("/imports/:id", (actor, _f, id) => importing.applyTaskImport(deps.projects, actor, id as Id), {
    done: (made) => `/projects/${made.projectId}/tasks`,
    back: (id) => `/imports/${id ?? ""}`,
    message: (made) => `Imported ${made.tasks} ${made.tasks === 1 ? "task" : "tasks"}${made.subtasks > 0 ? ` and ${made.subtasks} ${made.subtasks === 1 ? "subtask" : "subtasks"}` : ""}${made.labels > 0 ? `, with ${made.labels} new ${made.labels === 1 ? "label" : "labels"}` : ""}.`,
  });
  post("/imports/:id/cancel", (actor, _f, id) => importing.cancelTaskImport(deps.projects, actor, id as Id), {
    done: (cancelled) => `/projects/${cancelled.projectId}/import`,
    back: (id) => `/imports/${id ?? ""}`,
    message: "Import cancelled. Nothing was added.",
  });
  post("/calendar-feed/stop", (actor) => calendar.stopCalendarFeed(deps.projects, actor), { done: () => "/calendar-feed", back: () => "/calendar-feed", message: "Your calendar address has stopped working." });
  // Repeating, from the task page.
  post("/tasks/:id/repeat", (actor, f, id) => repeating.setTaskRepeat(deps.projects, actor, id as Id, { every: f["every"] ?? null, unit: f["unit"] ?? null, from: f["from"] ?? null }), {
    done: (_, id) => `/tasks/${id}#repeat`,
    back: (id) => `/tasks/${id}#repeat`,
    message: "It repeats now.",
  });
  post("/tasks/:id/repeat/stop", (actor, _f, id) => repeating.setTaskRepeat(deps.projects, actor, id as Id, null), {
    done: (_, id) => `/tasks/${id}#repeat`,
    back: (id) => `/tasks/${id}#repeat`,
    message: "It no longer repeats.",
  });
  // Subtasks and blocking, from the task page.
  post("/tasks/:id/subtasks", (actor, f, id) => links.addSubtask(deps.projects, actor, id as Id, { title: f["title"] ?? "", assigneeId: optionalId(f["assigneeId"]), dueOn: f["dueOn"] ?? null }), {
    done: (_, id) => `/tasks/${id}#subtasks`,
    back: (id) => `/tasks/${id}#subtasks`,
    message: "Subtask added.",
  });
  post("/tasks/:id/blockers", (actor, f, id) => links.blockTask(deps.projects, actor, id as Id, optionalId(f["blockerId"]) ?? ("" as Id)), {
    done: (_, id) => `/tasks/${id}#waiting`,
    back: (id) => `/tasks/${id}#waiting`,
    message: "It now waits on that task.",
  });
  post("/tasks/:id/blockers/remove", (actor, f, id) => links.unblockTask(deps.projects, actor, id as Id, optionalId(f["blockerId"]) ?? ("" as Id)), {
    done: (_, id) => `/tasks/${id}#waiting`,
    back: (id) => `/tasks/${id}#waiting`,
    message: "It no longer waits on that task.",
  });
  // Each label on the task page is a checkbox named label-<id>, so the ticked ones arrive as separate fields.
  const ticked = (f: FormFields): Id[] =>
    Object.keys(f)
      .filter((name) => name.startsWith("label-") && f[name] === "1")
      .map((name) => optionalId(name.slice("label-".length)))
      .filter((id): id is Id => id !== null);
  post("/tasks/:id/labels", (actor, f, id) => projects.setTaskLabels(deps.projects, actor, id as Id, { labelIds: ticked(f), newName: f["newLabel"] ?? null, newColour: f["newColour"] ?? null }), {
    done: (_, id) => `/tasks/${id}#labels`,
    back: (id) => `/tasks/${id}#labels`,
    message: "Labels saved.",
  });
  // The work table's forms. Each sends the browser back to the filter it was on, read and written again so only filter fields go back.
  const toWork = (f: FormFields) => work.workAddress(f["query"] ?? "");
  post("/work/filters", (actor, f) => work.saveFilter(deps.projects, actor, { name: f["name"] ?? "", query: f["query"] ?? "", shared: f["shared"] === "1", pinned: f["pinned"] === "1" }), {
    done: (_, _id, f) => toWork(f),
    back: (_id, f) => toWork(f),
    message: "Filter saved.",
  });
  post("/work/filters/:id", (actor, f, id) => work.changeSavedFilter(deps.projects, actor, id as Id, { ...(f["pinned"] ? { pinned: f["pinned"] === "1" } : {}), ...(f["shared"] ? { shared: f["shared"] === "1" } : {}) }), {
    done: (_, _id, f) => toWork(f),
    back: (_id, f) => toWork(f),
    message: "Filter saved.",
  });
  post("/work/filters/:id/remove", (actor, _f, id) => work.removeSavedFilter(deps.projects, actor, id as Id), { done: (_, _id, f) => toWork(f), back: (_id, f) => toWork(f), message: "Filter deleted." });
  post(
    "/work/columns",
    (actor, f) =>
      work.chooseWorkColumns(
        deps.projects,
        actor,
        Object.keys(f)
          .filter((name) => name.startsWith("column-") && f[name] === "1")
          .map((name) => name.slice("column-".length)),
      ),
    { done: (_, _id, f) => toWork(f), back: (_id, f) => toWork(f), message: "Columns saved." },
  );
  // Quick add. On success the box is ready for the next one, with a link to what was added; on a problem, the same line comes back.
  const quickInput = (f: FormFields) => ({ text: f["text"] ?? "", skip: quick.readSkip([f["skip"] ?? ""]) });
  post("/add", (actor, f) => quick.quickAdd(deps.projects, actor, quickInput(f)), {
    done: (added) => `/add?added=${added.id}`,
    back: (_id, f) => {
      const { text, skip } = quickInput(f);
      const params = new URLSearchParams({ text });
      for (const index of skip) params.append("skip", String(index));
      return `/add?${params}`;
    },
    message: "Added.",
  });
  post("/labels", (actor, f) => projects.addLabel(deps.projects, actor, { name: f["name"] ?? "", colour: f["colour"] ?? null }), { done: () => "/labels", back: () => "/labels", message: "Label made." });
  post("/labels/:id", (actor, f, id) => projects.editLabelDetails(deps.projects, actor, id as Id, { name: f["name"] ?? "", colour: f["colour"] ?? null }), {
    done: () => "/labels",
    back: () => "/labels",
    message: "Label saved.",
  });
  post("/labels/:id/remove", (actor, _f, id) => projects.removeLabel(deps.projects, actor, id as Id), { done: () => "/labels", back: () => "/labels", message: "Label deleted, and taken off its tasks." });
  post(
    "/projects/:id/deliverables",
    (actor, f, id, files) => projects.addDeliverable(deps.projects, actor, id as Id, { title: f["title"] ?? "", description: f["description"] ?? null, file: files["file"] ?? null }),
    { done: (_, id) => `${project(id)}#deliverables`, back: (id) => `${project(id)}#deliverables`, message: "Deliverable added." },
  );
  post("/deliverables/:id/share", (actor, f, id) => projects.setDeliverableShared(deps.projects, actor, id as Id, f["shared"] !== "0"), {
    done: (deliverable) => `${project(deliverable.projectId)}#deliverables`,
    back: (_, f) => `${project(optionalId(f["projectId"]))}#deliverables`,
    message: "Deliverable saved.",
  });
  return app;
}

/** The work table as a CSV file, for the same filter and sort as the page. */
/**
 * A share link's own forms and files: reached by its secret alone, with no
 * one signed in. A comment goes back to its task on the shared page.
 */
export function shareRoutes(deps: Pick<ProjectRoutesDeps, "projects" | "sign"> & { readonly allowComment: (key: string) => boolean }): Hono {
  const app = new Hono();
  app.post("/s/:token/tasks/:taskId/comments", async (c) => {
    const token = c.req.param("token");
    const taskId = parseId(c.req.param("taskId"));
    const { fields } = await readForm(c);
    const back = (anchor: string, kind: "done" | "problem", message: string) => c.redirect(deps.sign(withMessage(`/s/${token}`, kind, message)) + anchor, 303);
    if (!taskId.ok) return c.text("Not found", 404);
    if (!deps.allowComment(`share ${token}`)) return back(`#task-${taskId.value}`, "problem", "That's a lot of comments at once. Wait a few minutes, then try again.");
    const said = sharing.commentThroughLink(deps.projects, token, taskId.value, { name: fields["name"] ?? "", body: fields["body"] ?? "" });
    if (!said.ok && said.error === "not-found") return c.text("Not found", 404);
    return said.ok ? back(`#task-${taskId.value}`, "done", "Comment added. The team will see it.") : back(`#task-${taskId.value}`, "problem", messageFor(said.error));
  });
  return app;
}

/** A shared deliverable's file, through a working share link. */
export function shareFiles(deps: Pick<ProjectRoutesDeps, "projects">): Hono {
  const app = new Hono();
  app.get("/s/:token/files/:fileId", (c) => {
    const fileId = parseId(c.req.param("fileId"));
    const file = fileId.ok ? sharing.fileThroughLink(deps.projects, c.req.param("token"), fileId.value) : null;
    if (!file) return c.text("Not found", 404, { "cache-control": "no-store" });
    const fallback = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  });
  return app;
}

/** The calendar feed: reached by its secret address alone, with no one signed in. */
export function calendarFeeds(deps: Pick<ProjectRoutesDeps, "projects" | "publicUrl">): Hono {
  const app = new Hono();
  app.get("/calendar/:file", (c) => {
    const file = c.req.param("file");
    const token = /^([A-Za-z0-9_-]{43})\.ics$/.exec(file)?.[1];
    const body = token ? calendar.calendarFor(deps.projects, token, deps.publicUrl || new URL(c.req.url).origin) : null;
    if (body === null) return c.text("Not found", 404, { "cache-control": "no-store" });
    return new Response(body, { status: 200, headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
  });
  return app;
}

export function workDownloads(deps: Pick<ProjectRoutesDeps, "projects" | "actorOf">): Hono {
  const app = new Hono();
  app.get("/work.csv", (c) => {
    const params = new URL(c.req.url).searchParams;
    const made = work.workCsv(deps.projects, deps.actorOf(c.req.header("cookie") ?? ""), (name) => params.getAll(name));
    if (!made.ok) return c.text("Not found", 404);
    return new Response(made.value.csv, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${made.value.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  });
  return app;
}
