// The knowledge base's forms: write an article, save an edit, archive it and
// bring it back.
import { Hono } from "hono";
import { createArticle, saveArticle, setArticleArchived, type KnowledgeDeps } from "../application/knowledge.ts";
import { formPosts, type FormFields, type Id } from "../../shared/index.ts";

export type KnowledgeRoutesDeps = {
  readonly knowledge: KnowledgeDeps;
  readonly actorOf: (cookieHeader: string) => Id | null;
  readonly sign: (location: string) => string;
};

const MESSAGES: Readonly<Record<string, string>> = {
  forbidden: "You don’t have permission to do that.",
  "not-found": "That article doesn’t exist.",
  "title-missing": "Give it a title.",
  "title-too-long": "That title is too long.",
  "category-missing": "Give it a category.",
  "category-too-long": "That category is too long.",
  "body-missing": "Write the article first.",
  "body-too-long": "That is too long for one article. Split it in two.",
  "too-many-tags": "Use 12 tags at most.",
  "invalid-kind": "Choose article or decision.",
  "invalid-day": "Enter the day it was decided, today or earlier.",
  unchanged: "Nothing was changed.",
  archived: "This article is archived. Bring it back to edit it.",
};

export function knowledgeRoutes(deps: KnowledgeRoutesDeps): Hono {
  const app = new Hono();
  const post = formPosts(app, { actorOf: deps.actorOf, sign: deps.sign, messageFor: (code) => MESSAGES[code] ?? "That didn’t work. Try again.", home: "/knowledge" });
  const input = (form: FormFields) => ({ title: form["title"] ?? "", category: form["category"] ?? "", tags: form["tags"] ?? "", body: form["body"] ?? "", kind: form["kind"] ?? "article", decidedOn: form["decidedOn"] ?? "" });
  // The address to go back to is the article's own, worked out from a slug that is checked to be one.
  const page = (form: FormFields) => (/^[a-z0-9-]{1,90}$/.test(form["slug"] ?? "") ? `/knowledge/${form["slug"]}` : "/knowledge");

  post("/knowledge", (actor, form) => createArticle(deps.knowledge, actor, input(form)), { done: (article) => `/knowledge/${article.slug}`, back: () => "/knowledge", message: "Saved." });
  post("/articles/:id", (actor, form, id) => saveArticle(deps.knowledge, actor, id as Id, input(form)), { done: (article) => `/knowledge/${article.slug}`, back: (_id, form) => page(form), message: "Saved as a new revision." });
  post("/articles/:id/archive", (actor, form, id) => setArticleArchived(deps.knowledge, actor, id as Id, form["archived"] === "1"), { done: (article) => `/knowledge/${article.slug}`, back: (_id, form) => page(form), message: "Saved." });
  return app;
}
