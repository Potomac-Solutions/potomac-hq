// What Claude is told and how its answer is read (decision 0010, section 2).
// The rules on quality are fixed here, in code, not typed by whoever asks.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { MAX_FILES, type FileChange, type SiteFiles } from "./files.ts";

export const SAVE_TOOL = "save_site";

export const SYSTEM_PROMPT = `You build small business websites for Potomac Solutions, a two-person web studio in Gormania, West Virginia. Each request comes from someone at Potomac about one client's site. You answer only by calling the ${SAVE_TOOL} tool once.

The site is plain static files: HTML, CSS and JavaScript, with no build step, no framework and no package. Every file is served as it is written.

Rules for every site:
- index.html is the home page. Link pages and files with relative paths (about.html, styles/site.css), never a leading slash.
- Build for a phone first, then widen. It must work on a 320px screen.
- Accessible: real headings in order, landmarks, labels on every form field, alt text on every image, visible focus, colour contrast of at least 4.5:1 for text, and nothing that only works with a mouse.
- Fast and private: no outside scripts, fonts, trackers, embeds or CDNs. Use system font stacks. Any icon is inline SVG.
- Keep JavaScript small and optional: every page must read and work with scripts off.
- Real text, never pictures of text.
- Never invent facts about the business: no made-up reviews, prices, awards, years in business, staff names, certifications or addresses. Use only the facts given. Where a fact is needed and missing, write a clearly marked placeholder like [Hours: ask the owner] so a person fills it in.
- The client's gallery, notice and reviews live in content/site.json, shaped {"notice": "", "gallery": [{"src": "", "alt": "", "title": "", "caption": ""}], "testimonials": [{"quote": "", "by": ""}]}. Pages read it with fetch and show it, and show nothing for an empty list. Keep that shape whenever you change it; the client edits it later. Leave gallery and testimonials empty unless you are given real ones.
- Images: use only the image paths you are given. When there are none, design without photos (colour, type, shapes, inline SVG) rather than pointing at files that don't exist.
- Forms can't send anywhere yet: a contact form uses a mailto: link or tel: link instead, from the facts given.

When asked for a change, change only what is asked and keep everything else as it was. Write each changed file whole. Remove a file only when it should no longer exist. In summary, say in one or two plain sentences what you did and anything a person should check or fill in.`;

/** The one tool Claude answers with. Forced, so every answer has this shape. */
export const SAVE_TOOL_SCHEMA = {
  name: SAVE_TOOL,
  description: "Save the site: files to write whole (new or changed) and files to remove, with a short summary of what changed.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two plain sentences: what changed, and anything a person should check or fill in." },
      write: {
        type: "array",
        description: "Files to create or replace, each written in full.",
        items: {
          type: "object",
          properties: { path: { type: "string", description: "Relative path, like index.html or styles/site.css" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      remove: { type: "array", description: "Paths of files to delete.", items: { type: "string" } },
    },
    required: ["summary", "write", "remove"],
  },
} as const;

/** The client's facts as HQ has them. Only what a public website would show (decision 0010, Consequences). */
export type ClientFacts = {
  readonly name: string;
  readonly phone: string | null;
  readonly address: string | null;
  readonly website: string | null;
  readonly contact: { readonly name: string; readonly email: string | null; readonly phone: string | null; readonly title: string | null } | null;
};

export type PastTurn = { readonly ask: string; readonly summary: string };

export type PromptInput = {
  readonly facts: ClientFacts;
  readonly brief: string;
  readonly files: SiteFiles;
  /** Earlier requests on this build and what Claude said it did, oldest first. */
  readonly history: readonly PastTurn[];
  readonly ask: string;
};

/** How many earlier turns go with a request: enough to follow a thread, few enough to stay cheap. */
export const HISTORY_TURNS = 6;

const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : `${label}: (not known)`);

/** The user message: the facts, the brief, the conversation so far, every current file, and the request. */
export function userMessage(input: PromptInput): string {
  const { facts } = input;
  const contact = facts.contact;
  const parts = [
    "<client_facts>",
    line("Business name", facts.name),
    line("Business phone", facts.phone),
    line("Address", facts.address),
    line("Current website", facts.website),
    contact ? `Main contact: ${contact.name}${contact.title ? `, ${contact.title}` : ""}${contact.email ? `, ${contact.email}` : ""}${contact.phone ? `, ${contact.phone}` : ""}` : "Main contact: (not known)",
    "</client_facts>",
    "",
    "<brief>",
    input.brief.trim() || "(No brief was written.)",
    "</brief>",
    "",
  ];
  if (input.history.length > 0) {
    parts.push("<earlier_requests>");
    for (const turn of input.history.slice(-HISTORY_TURNS)) parts.push(`Asked: ${turn.ask}`, `You did: ${turn.summary}`, "");
    parts.push("</earlier_requests>", "");
  }
  const paths = Object.keys(input.files);
  if (paths.length === 0) {
    parts.push("<current_site>", "(There are no files yet. This is the first version.)", "</current_site>");
  } else {
    parts.push("<current_site>");
    for (const path of paths) parts.push(`<file path="${path}">`, input.files[path] ?? "", "</file>");
    parts.push("</current_site>");
  }
  parts.push("", "<request>", input.ask.trim(), "</request>");
  return parts.join("\n");
}

export type AnswerError = "answer-unreadable";

/** Reads the tool's input as Claude sent it. Anything off its shape is refused. */
export function readAnswer(input: unknown): Result<FileChange & { readonly summary: string }, AnswerError> {
  if (typeof input !== "object" || input === null) return err("answer-unreadable");
  const record = input as Record<string, unknown>;
  const summary = typeof record["summary"] === "string" ? record["summary"].trim().slice(0, 1_000) : "";
  const writeIn = record["write"];
  const removeIn = record["remove"] ?? [];
  if (!Array.isArray(writeIn) || !Array.isArray(removeIn) || writeIn.length > MAX_FILES * 2 || removeIn.length > MAX_FILES * 2) return err("answer-unreadable");
  const write: { path: string; content: string }[] = [];
  for (const one of writeIn) {
    if (typeof one !== "object" || one === null) return err("answer-unreadable");
    const { path, content } = one as Record<string, unknown>;
    if (typeof path !== "string" || typeof content !== "string") return err("answer-unreadable");
    write.push({ path: path.replace(/^\.\//, ""), content });
  }
  const remove: string[] = [];
  for (const path of removeIn) {
    if (typeof path !== "string") return err("answer-unreadable");
    remove.push(path.replace(/^\.\//, ""));
  }
  return ok({ summary: summary || "Updated the site.", write, remove });
}
