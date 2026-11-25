// AI's forms (decision 0012): Settings → AI, asking each feature for a draft,
// and using or discarding drafts. Asking waits for Claude's answer, then goes
// back to the page with the draft on it. Nothing here sends or changes
// anything without someone pressing the button that says so.
import { Hono } from "hono";
import { choosingModel, discardDraft, draftDone, saveAiSettings, type AiDeps } from "../application/ai.ts";
import {
  addRecapSteps,
  askHq,
  closeAsSpam,
  draftCallBrief,
  draftCallRecap,
  draftCaseStudy,
  draftCheckIn,
  draftProposal,
  draftSocialPosts,
  draftWeeklyUpdate,
  noteTriage,
  postWeeklyUpdate,
  readReceiptFile,
  sendDealEmail,
  triageDeal,
  useProposalDraft,
  useReceiptDraft,
  useScopeDraft,
  type AiMail,
  type FeaturesDeps,
} from "../application/features.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That doesn’t exist.",
  "already-decided": "That draft was already used or discarded.",
  "no-key": "AI needs HQ_ANTHROPIC_API_KEY set on the server.",
  "feature-off": "That AI feature is off. An admin can turn it on in Settings → AI.",
  "budget-reached": "This month’s budget, shared with the site builder, is spent. AI is paused until the first of the month, or until the owner raises the cap under Site builder → Model and cap.",
  "ai-unavailable": "Claude didn’t answer. Try again in a minute; nothing was changed.",
  "bad-answer": "Claude’s answer didn’t make sense, so it wasn’t kept. Try again.",
  "no-email": "Their contact has no email in HQ.",
  "email-off": "Email isn’t set up here, so HQ can’t send it. Copy it into your own email instead.",
  "email-failed": "The email didn’t go. Try again in a minute.",
  "subject-missing": "Give the email a subject, under 150 characters.",
  "body-missing": "Write the message.",
  "nothing-to-draft": "There are no notes from the call yet. Add some, or paste a transcript.",
  "question-missing": "Ask a question, under 500 characters.",
  "receipt-missing": "Choose a photo or PDF of the receipt.",
  "receipt-kind": "That isn’t a photo (JPEG, PNG, GIF or WebP) or a PDF.",
  "receipt-too-big": "Keep the receipt under 5 MB.",
  "model-invalid": "Choose a model, or type another model’s id: lower case letters, digits, dots and dashes.",
  "price-invalid": "Give the other model’s prices in dollars per million tokens, like 0.10.",
  "price-guide-too-long": "Keep the price guide under 4,000 characters.",
  "ceiling-invalid": "Choose the highest model anyone may pick from the list.",
  "opportunity-closed": "That deal is already won or lost.",
  "project-closed": "That project isn’t active.",
};
const messageFor = (code: string): string => MESSAGES[code] ?? "That didn’t work. Try again.";

/** Back to the page the form was on: a path in HQ, never another site. */
const backOr = (form: FormFields, fallback: string): string => {
  const back = form["back"] ?? "";
  return back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") && back.length < 300 ? back : fallback;
};

type Deps = {
  readonly ai: FeaturesDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
  /** The app's mail, where email is set up. */
  readonly mail: AiMail | null;
};

export function aiRoutes(deps: Deps): Hono {
  const app = new Hono();
  const posts = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor, home: "/drafts" });
  // HQ itself acts with no one signed in, for the jobs that run by themselves.
  // A form is always someone's: nobody signed in to HQ, a client included, is refused.
  const post: typeof posts = (path, run, places) =>
    posts(path, (actor, form, id, files) => (actor === null ? { ok: false as const, error: "forbidden" } : run(actor, form, id, files)), places);
  const ai = deps.ai;
  const aiDeps: AiDeps = ai;
  /** Asking for a draft: with the model picked on the form, up to the ceiling. */
  const asking = (f: FormFields): FeaturesDeps => choosingModel(ai, f["model"] ?? "");
  const features = (f: FormFields): string[] =>
    Object.keys(f)
      .filter((name) => name.startsWith("feature-") && f[name] === "on")
      .map((name) => name.slice("feature-".length));

  post(
    "/settings/ai",
    (actor, f) => saveAiSettings(aiDeps, actor, { model: f["model"] ?? "", otherModel: f["otherModel"] ?? "", otherInput: f["otherInput"] ?? "", otherOutput: f["otherOutput"] ?? "", features: features(f), priceGuide: f["priceGuide"] ?? "", ...(f["ceiling"] !== undefined ? { ceiling: f["ceiling"] } : {}) }),
    { done: () => "/settings/ai", back: () => "/settings/ai", message: "AI settings saved. They apply from the next call." },
  );

  // Using and discarding any draft.
  post("/ai/drafts/:id/discard", (actor, _f, id) => discardDraft(aiDeps, actor, id as Id), { done: (_v, _id, f) => backOr(f, "/drafts"), back: (_id, f) => backOr(f, "/drafts"), message: "Draft discarded." });
  post("/ai/drafts/:id/done", (actor, _f, id) => draftDone(aiDeps, actor, id as Id), { done: (_v, _id, f) => backOr(f, "/drafts"), back: (_id, f) => backOr(f, "/drafts"), message: "Marked done." });

  // Phase 1: calls.
  post("/phone/:id/recap/ai", (actor, f, id) => draftCallRecap(asking(f), actor, id as Id, f["transcript"] ?? ""), { done: (_v, id) => `/phone/${id ?? ""}/recap`, back: (id) => `/phone/${id ?? ""}/recap`, message: "Drafted. Read it through and change anything before it goes." });
  post("/ai/drafts/:id/steps", (actor, _f, id) => addRecapSteps(ai, actor, id as Id), { done: (_v, _id, f) => backOr(f, "/todos"), back: (_id, f) => backOr(f, "/todos"), message: (added) => (added === 1 ? "Added 1 to-do." : `Added ${added} to-dos.`) });
  post("/get-ready/:id/ai", (actor, f, id) => draftCallBrief(asking(f), actor, id as Id), { done: (_v, id) => `/get-ready/${id ?? ""}#brief`, back: (id) => `/get-ready/${id ?? ""}`, message: "Brief written." });

  // Phase 2: sales.
  const deal = (id: Id | null) => `/opportunities/${id ?? ""}#ai`;
  post("/opportunities/:id/ai/triage", (actor, f, id) => triageDeal(asking(f), actor, id as Id), { done: (_v, id) => deal(id), back: (id) => deal(id), message: "Triaged." });
  post("/opportunities/:id/ai/check-in", (actor, f, id) => draftCheckIn(asking(f), actor, id as Id), { done: (_v, id) => deal(id), back: (id) => deal(id), message: "Check-in drafted. Read it before it goes." });
  post("/opportunities/:id/ai/proposal", (actor, f, id) => draftProposal(asking(f), actor, id as Id), { done: (_v, id) => deal(id), back: (id) => deal(id), message: "Proposal drafted. Start it to edit before it’s sent." });
  post("/ai/drafts/:id/send", (actor, f, id) => sendDealEmail(ai, deps.mail, actor, id as Id, { subject: f["subject"] ?? "", body: f["body"] ?? "" }), { done: (_v, _id, f) => backOr(f, "/drafts"), back: (_id, f) => backOr(f, "/drafts"), message: "Sent, and logged on the deal." });
  post("/ai/drafts/:id/note", (actor, _f, id) => noteTriage(ai, actor, id as Id), { done: (_v, _id, f) => backOr(f, "/drafts"), back: (_id, f) => backOr(f, "/drafts"), message: "Kept as a note on the deal." });
  post("/ai/drafts/:id/spam", (actor, _f, id) => closeAsSpam(ai, actor, id as Id), { done: (_v, _id, f) => backOr(f, "/drafts"), back: (_id, f) => backOr(f, "/drafts"), message: "Closed as lost: spam." });
  post("/ai/drafts/:id/proposal", (actor, _f, id) => useProposalDraft(ai, actor, id as Id), { done: (proposalId) => `/proposals/${proposalId}`, back: (_id, f) => backOr(f, "/drafts"), message: "Proposal started from the draft. Change anything before you send it." });

  // Phase 3: delivery.
  const project = (id: Id | null) => `/projects/${id ?? ""}#ai`;
  post("/ai/drafts/:id/change", (actor, _f, id) => useScopeDraft(ai, actor, id as Id), { done: (draft) => `/projects/${draft.recordId}/money#changes`, back: (_id, f) => backOr(f, "/drafts"), message: "Change request drafted. Check it, then send it to the client." });
  post("/projects/:id/ai/update", (actor, f, id) => draftWeeklyUpdate(asking(f), actor, id as Id), { done: (_v, id) => project(id), back: (id) => project(id), message: "Update drafted. Read it before it’s posted." });
  post("/ai/drafts/:id/post", (actor, f, id) => postWeeklyUpdate(ai, actor, id as Id, f["body"] ?? ""), { done: (draft) => `/projects/${draft.recordId}#updates`, back: (_id, f) => backOr(f, "/drafts"), message: "Posted to the client’s portal." });
  post("/ask", (actor, f) => askHq(asking(f), actor, f["question"] ?? ""), { done: () => "/ask#answer", back: () => "/ask", message: "Answered." });

  // Phase 4: money and admin.
  post("/projects/:id/ai/receipt", (actor, f, id, files) => readReceiptFile(asking(f), actor, id as Id, files["receipt"] ?? null), { done: (_v, id) => `/projects/${id ?? ""}/money#ai`, back: (id) => `/projects/${id ?? ""}/money#ai`, message: "Receipt read. Check it, then add the expense." });
  post("/ai/drafts/:id/expense", (actor, f, id) => useReceiptDraft(ai, actor, id as Id, { category: f["category"] ?? "", amount: f["amount"] ?? "", on: f["on"] ?? "", note: f["note"] ?? "" }), { done: (draft) => `/projects/${draft.recordId}/money`, back: (_id, f) => backOr(f, "/drafts"), message: "Expense added, with the receipt." });

  // Phase 5: marketing.
  post("/projects/:id/ai/case-study", (actor, f, id) => draftCaseStudy(asking(f), actor, id as Id), { done: () => "/marketing", back: (id) => project(id), message: "Case study drafted." });
  post("/projects/:id/ai/posts", (actor, f, id) => draftSocialPosts(asking(f), actor, id as Id), { done: () => "/marketing", back: (id) => project(id), message: "Posts drafted." });
  return app;
}
