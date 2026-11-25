// The assistant on Home (decision 0015, section 4): what it may do, how what
// the model asks for is read, how much of the conversation is sent, and how
// its answers are shown. It never acts here: the application runs each tool
// through the module that owns it, and a change waits for the person's tap
// unless it is small and they've said small changes may go through.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type Block =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly type: "tool_result"; readonly tool_use_id: string; readonly content: string; readonly is_error?: boolean };

export type Message = { readonly role: "user" | "assistant"; readonly content: readonly Block[] };

/** Look: runs straight away and changes nothing. Small: a change with an exact undo. Change: always asks. */
export type ToolKind = "look" | "small" | "change";

export type Tool = {
  readonly name: ToolName;
  readonly kind: ToolKind;
  readonly description: string;
  readonly input_schema: Readonly<Record<string, unknown>>;
};

export const TOOL_NAMES = ["find", "whats_due", "knowledge", "quick_add", "move_task", "tick_off", "reopen", "add_note", "log_contact", "add_client", "open_deal"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TASK_MOVES = ["todo", "doing", "blocked", "done"] as const;
export const MOVE_LABELS: Readonly<Record<(typeof TASK_MOVES)[number], string>> = { todo: "To do", doing: "Working on", blocked: "Blocked", done: "Done" };
export const NOTE_ON = ["client", "opportunity", "project"] as const;
export const CONTACT_KINDS = ["call", "email", "text", "meeting"] as const;
export const CONTACT_OUTCOMES = ["reached", "voicemail", "no-answer"] as const;
export const LEAD_SOURCES = ["word-of-mouth", "phone", "email", "website", "social", "referral", "other"] as const;
export const SERVICES = ["consulting", "landing-page", "domain-management", "website", "blog", "social-media", "application", "automation"] as const;

const object = (properties: Record<string, unknown>, required: readonly string[]) => ({ type: "object", properties, required, additionalProperties: false });
const text = (description: string) => ({ type: "string", description });
const choice = (values: readonly string[], description: string) => ({ type: "string", enum: values, description });

export const TOOLS: readonly Tool[] = [
  {
    name: "find",
    kind: "look",
    description: "Find HQ's pages and records (clients, contacts, deals, projects, tasks and to-dos, proposals, invoices, articles) by a few words. Returns each record's id and address. Use it before acting on a record, and to find the page that does something.",
    input_schema: object({ query: text("A few words: a name, a title, an invoice number like INV-0003, or what a page does.") }, ["query"]),
  },
  {
    name: "whats_due",
    kind: "look",
    description: "What's waiting for the person today: clients waiting on them, follow-ups due, and their to-dos due or overdue.",
    input_schema: object({}, []),
  },
  {
    name: "knowledge",
    kind: "look",
    description: "Search the knowledge base and decision log for how Potomac works and what was decided.",
    input_schema: object({ query: text("What to look for.") }, ["query"]),
  },
  {
    name: "quick_add",
    kind: "change",
    description:
      "Add a task or to-do from one line in quick add's words: a due date (today, tomorrow, fri, next week, dec 5, in 3 days), *label, @person, !high or !urgent, +project-or-client handle, and a repeat (every week, monthly). With no +project it is a to-do. Example: \"Call Stacy about the map fri +better-days !high\".",
    input_schema: object({ line: text("The line, under 300 characters.") }, ["line"]),
  },
  {
    name: "move_task",
    kind: "small",
    description: "Move a project task to another status. Get its id with find.",
    input_schema: object({ task_id: text("The task's id."), to: choice(TASK_MOVES, "Where it goes.") }, ["task_id", "to"]),
  },
  {
    name: "tick_off",
    kind: "small",
    description: "Tick off a to-do or task as done. Get its id with find or whats_due.",
    input_schema: object({ todo_id: text("The to-do's or task's id.") }, ["todo_id"]),
  },
  {
    name: "reopen",
    kind: "small",
    description: "Reopen a to-do or task that was ticked off.",
    input_schema: object({ todo_id: text("The to-do's or task's id.") }, ["todo_id"]),
  },
  {
    name: "add_note",
    kind: "change",
    description: "Add a note to a client, deal (opportunity) or project.",
    input_schema: object({ on: choice(NOTE_ON, "What it's on."), id: text("Its id, from find."), note: text("The note, under 4,000 characters.") }, ["on", "id", "note"]),
  },
  {
    name: "log_contact",
    kind: "change",
    description: "Log a call, email, text or meeting with a client, or on one of its deals, with a note; optionally set the deal's follow-up day.",
    input_schema: object(
      {
        client_id: text("The client's id, when it isn't about one deal."),
        opportunity_id: text("The deal's id, when it is."),
        kind: choice(CONTACT_KINDS, "How you were in touch."),
        outcome: choice(CONTACT_OUTCOMES, "For a call: talked (reached), left a voicemail, or no answer."),
        note: text("What was said, under 2,000 characters. Needed unless a call went to voicemail or wasn't answered."),
        follow_up_on: text("On a deal: the day to follow up, YYYY-MM-DD."),
      },
      ["kind"],
    ),
  },
  {
    name: "add_client",
    kind: "change",
    description: "Add a new client (a business). Check with find first that it isn't already there.",
    input_schema: object({ name: text("The business's name."), website: text("Its website, if known."), phone: text("Its phone, if known."), address: text("Its address, if known.") }, ["name"]),
  },
  {
    name: "open_deal",
    kind: "change",
    description: "Open a new deal (opportunity) at a client.",
    input_schema: object(
      {
        client_id: text("The client's id, from find."),
        title: text("What the deal is, like \"Bakery website\"."),
        lead_source: choice(LEAD_SOURCES, "How they found Potomac."),
        service: choice(SERVICES, "The service, if known."),
        summary: text("A line or two about it."),
      },
      ["client_id", "title", "lead_source"],
    ),
  },
];

export const toolNamed = (name: string): Tool | null => TOOLS.find((tool) => tool.name === name) ?? null;

/** What a tool asks for, read and checked. */
export type Ask =
  | { readonly tool: "find"; readonly query: string }
  | { readonly tool: "whats_due" }
  | { readonly tool: "knowledge"; readonly query: string }
  | { readonly tool: "quick_add"; readonly line: string }
  | { readonly tool: "move_task"; readonly taskId: string; readonly to: (typeof TASK_MOVES)[number] }
  | { readonly tool: "tick_off"; readonly todoId: string }
  | { readonly tool: "reopen"; readonly todoId: string }
  | { readonly tool: "add_note"; readonly on: (typeof NOTE_ON)[number]; readonly id: string; readonly note: string }
  | { readonly tool: "log_contact"; readonly clientId: string; readonly opportunityId: string; readonly kind: string; readonly outcome: string; readonly note: string; readonly followUpOn: string }
  | { readonly tool: "add_client"; readonly name: string; readonly website: string; readonly phone: string; readonly address: string }
  | { readonly tool: "open_deal"; readonly clientId: string; readonly title: string; readonly leadSource: string; readonly service: string; readonly summary: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Reads what the model sent for a tool. The reason it can't be used goes back to the model, so it can try again. */
export function readAsk(name: string, input: Readonly<Record<string, unknown>>): Result<Ask, string> {
  const str = (key: string, most: number): string => {
    const value = input[key];
    return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, most) : "";
  };
  const id = (key: string): string => {
    const value = str(key, 60).toLowerCase();
    return ID.test(value) ? value : "";
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]): T | null => {
    const value = str(key, 40) as T;
    return values.includes(value) ? value : null;
  };
  switch (name) {
    case "find":
    case "knowledge": {
      const query = str("query", 100);
      return query ? ok({ tool: name, query }) : err("Give a few words to look for.");
    }
    case "whats_due":
      return ok({ tool: "whats_due" });
    case "quick_add": {
      const line = str("line", 300);
      return line ? ok({ tool: "quick_add", line }) : err("Give the line to add.");
    }
    case "move_task": {
      const taskId = id("task_id");
      const to = oneOf("to", TASK_MOVES);
      if (!taskId) return err("task_id must be a task's id from find.");
      return to ? ok({ tool: "move_task", taskId, to }) : err(`to must be one of ${TASK_MOVES.join(", ")}.`);
    }
    case "tick_off":
    case "reopen": {
      const todoId = id("todo_id");
      return todoId ? ok({ tool: name, todoId }) : err("todo_id must be an id from find or whats_due.");
    }
    case "add_note": {
      const on = oneOf("on", NOTE_ON);
      const recordId = id("id");
      const note = str("note", 4000);
      if (!on) return err(`on must be one of ${NOTE_ON.join(", ")}.`);
      if (!recordId) return err("id must be an id from find.");
      return note ? ok({ tool: "add_note", on, id: recordId, note }) : err("Write the note.");
    }
    case "log_contact": {
      const clientId = id("client_id");
      const opportunityId = id("opportunity_id");
      const kind = oneOf("kind", CONTACT_KINDS);
      if (!clientId && !opportunityId) return err("Give a client_id or an opportunity_id from find.");
      if (!kind) return err(`kind must be one of ${CONTACT_KINDS.join(", ")}.`);
      const outcome = kind === "call" ? (oneOf("outcome", CONTACT_OUTCOMES) ?? "reached") : "";
      const followUpOn = str("follow_up_on", 10);
      if (followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) return err("follow_up_on must be YYYY-MM-DD.");
      return ok({ tool: "log_contact", clientId: opportunityId ? "" : clientId, opportunityId, kind, outcome, note: str("note", 2000), followUpOn });
    }
    case "add_client": {
      const clientName = str("name", 200);
      return clientName ? ok({ tool: "add_client", name: clientName, website: str("website", 300), phone: str("phone", 40), address: str("address", 300) }) : err("Give the business's name.");
    }
    case "open_deal": {
      const clientId = id("client_id");
      const title = str("title", 200);
      const leadSource = oneOf("lead_source", LEAD_SOURCES);
      if (!clientId) return err("client_id must be a client's id from find.");
      if (!title) return err("Give the deal a title.");
      if (!leadSource) return err(`lead_source must be one of ${LEAD_SOURCES.join(", ")}.`);
      return ok({ tool: "open_deal", clientId, title, leadSource, service: oneOf("service", SERVICES) ?? "", summary: str("summary", 2000) });
    }
    default:
      return err(`There is no tool called ${name}.`);
  }
}

/** The most messages sent each time (decision 0015, Default). */
export const HISTORY_LIMIT = 20;
/** The most rounds of looking up for one message before it must answer. */
export const MAX_ROUNDS = 4;
export const MAX_MESSAGE = 1000;
/** The longest a lookup's result is when sent back. */
export const MAX_RESULT = 6000;

/**
 * The conversation as it is sent: the newest messages, starting at something
 * the person typed (never at a lone tool result), with neighbouring messages
 * from the same side joined, and no tool use left without its result.
 */
export function historyFor(messages: readonly Message[], limit = HISTORY_LIMIT): Message[] {
  let start = Math.max(0, messages.length - limit);
  while (start < messages.length) {
    const first = messages[start] as Message;
    if (first.role === "user" && first.content.some((block) => block.type === "text")) break;
    start += 1;
  }
  const joined: { role: Message["role"]; content: Block[] }[] = [];
  for (const message of messages.slice(start)) {
    const last = joined.at(-1);
    if (last && last.role === message.role) last.content.push(...message.content);
    else joined.push({ role: message.role, content: [...message.content] });
  }
  // Every tool use needs a result in the next message; one without (a
  // conversation cut short) is answered as not done, so the model can move on.
  for (let index = 0; index < joined.length; index += 1) {
    const message = joined[index] as { role: Message["role"]; content: Block[] };
    if (message.role !== "assistant") continue;
    const uses = message.content.filter((block): block is Extract<Block, { type: "tool_use" }> => block.type === "tool_use");
    if (uses.length === 0) continue;
    let next = joined[index + 1];
    if (!next || next.role !== "user") {
      next = { role: "user", content: [] };
      joined.splice(index + 1, 0, next);
    }
    const answered = new Set(next.content.flatMap((block) => (block.type === "tool_result" ? [block.tool_use_id] : [])));
    const missing = uses.filter((use) => !answered.has(use.id)).map((use): Block => ({ type: "tool_result", tool_use_id: use.id, content: "Not done.", is_error: true }));
    // Tool results come first in a user message.
    next.content = [...next.content.filter((block) => block.type === "tool_result"), ...missing, ...next.content.filter((block) => block.type !== "tool_result")];
  }
  return joined;
}

/** What the model is told about itself and the person. */
export function systemPrompt(who: { readonly name: string; readonly today: string; readonly autoSmall: boolean }): string {
  return [
    "You are the assistant inside Potomac HQ, the internal app Potomac Solutions (a small web and app development company in Gormania, West Virginia, run by Mikey and Jayanti) uses to run its business.",
    `You're talking with ${who.name}. Today is ${who.today}.`,
    "Help them get things done in HQ in as few steps as you can. Look things up with your tools rather than guessing, and act through your tools.",
    "Every change you propose is shown to them as a card with a Do it button" + (who.autoSmall ? ", except small ones (moving a task, ticking off or reopening a to-do), which go straight through with an Undo." : ".") + " Don't ask them to confirm in words; propose the change and say in one short line what the card will do.",
    "You can't send emails, post anything, take payments or delete anything. For anything your tools can't do, find the page that does it and link it as [Page name](/address).",
    "Use the ids that find returns; never make one up. If several records match, ask which one.",
    "Answer in a sentence or two, plainly, with no headings. Link records and pages as [Name](/address).",
  ].join("\n");
}

/** A piece of an answer: plain text, or a link to a page in HQ. */
export type Segment = { readonly text: string; readonly href: string };

/** An HQ address: starts with one slash, no scheme, no backslash. */
const HQ_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/?#=&%+:@]*$/;

/**
 * The model's answer as text and links. Only [name](/address) links to
 * pages in HQ become links; anything else stays as written.
 */
export function segmentsOf(answer: string): readonly Segment[] {
  const out: Segment[] = [];
  const pattern = /\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)/g;
  let last = 0;
  for (const match of answer.matchAll(pattern)) {
    const [whole, label, href] = match as unknown as [string, string, string];
    const at = match.index ?? 0;
    if (!HQ_PATH.test(href)) continue;
    if (at > last) out.push({ text: answer.slice(last, at), href: "" });
    out.push({ text: label, href });
    last = at + whole.length;
  }
  if (last < answer.length) out.push({ text: answer.slice(last), href: "" });
  return out;
}

/** A lookup's result, as JSON, cut to size. */
export function resultText(value: unknown): string {
  const json = JSON.stringify(value);
  return json.length <= MAX_RESULT ? json : json.slice(0, MAX_RESULT - 30) + "…(cut short; narrow it down)";
}

/** What a lookup was, in a few words, for the conversation as shown. */
export function lookedUp(name: string, input: Readonly<Record<string, unknown>>): string {
  const query = typeof input["query"] === "string" ? `“${(input["query"] as string).slice(0, 60)}”` : "";
  if (name === "find") return `Looked for ${query}`;
  if (name === "knowledge") return `Read the knowledge base for ${query}`;
  if (name === "whats_due") return "Checked what's due";
  return "Looked something up";
}
