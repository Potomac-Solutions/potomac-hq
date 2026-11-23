// Reading clients to import, pasted as CSV with a header row: the first
// line names the columns, in any order. Every row is checked before anything
// is saved, so a mistake on row 7 saves nothing and says so.
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { isPricing, isService, LEAD_SOURCES, type LeadSource, type Pricing, type Service } from "./opportunity.ts";

/** The columns, as a person writes them in the header. Only `client` is needed. */
export const IMPORT_COLUMNS = ["client", "contact", "title", "email", "phone", "website", "project", "service", "pricing", "price", "source", "repository", "live", "demo"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const MAX_IMPORT_ROWS = 200;

export type ImportRow = {
  /** Its line in what was pasted, counting the header as line 1. */
  readonly line: number;
  readonly client: string;
  readonly website: string | null;
  readonly demo: boolean;
  readonly contact: { readonly name: string; readonly title: string | null; readonly email: string | null; readonly phone: string | null } | null;
  readonly project: {
    readonly name: string;
    readonly service: Service;
    readonly pricing: Pricing;
    /** As typed: checked as money where it is used. "" for free. */
    readonly price: string;
    readonly source: LeadSource;
    readonly repository: string | null;
    readonly live: string | null;
  } | null;
};

/**
 * Why nothing can be imported: "empty", "too-many-rows", "no-client-column",
 * "unknown-column:<name>", "unclosed-quote:<line>", or "row:<line>:<what to change>".
 */
export type ImportError = string;

/** Splits CSV into rows of fields: commas, double quotes around a field, "" for a quote inside one, and line breaks inside quotes. */
export function readCsv(text: string): Result<{ readonly fields: string[]; readonly line: number }[], ImportError> {
  const rows: { fields: string[]; line: number }[] = [];
  let field = "";
  let fields: string[] = [];
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i] as string;
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else {
        if (char === "\n") line += 1;
        field += char;
      }
    } else if (char === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else if (char === "\n") {
      fields.push(field);
      if (fields.some((one) => one.trim() !== "")) rows.push({ fields, line: rowLine });
      fields = [];
      field = "";
      line += 1;
      rowLine = line;
    } else field += char;
  }
  if (quoted) return err(`unclosed-quote:${rowLine}`);
  fields.push(field);
  if (fields.some((one) => one.trim() !== "")) rows.push({ fields, line: rowLine });
  return ok(rows);
}

const columnOf = (header: string): ImportColumn | null => {
  const name = header.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Readonly<Record<string, ImportColumn>> = { business: "client", company: "client", name: "contact", repo: "repository", github: "repository", site: "live", livesite: "live", amount: "price" };
  const found = aliases[name] ?? name;
  return (IMPORT_COLUMNS as readonly string[]).includes(found) ? (found as ImportColumn) : null;
};
const yes = (text: string): boolean | null => (/^(yes|y|true|1|demo|x)$/i.test(text) ? true : /^(no|n|false|0|)$/i.test(text) ? false : null);
const LABEL_TO_SERVICE: Readonly<Record<string, string>> = { "landing page": "landing-page", "domain management": "domain-management", "social media": "social-media", app: "application" };
const LABEL_TO_SOURCE: Readonly<Record<string, string>> = { "word of mouth": "word-of-mouth", referral: "referral", website: "website" };

/** The rows to import, every one checked for what can be checked without the database. */
export function readImport(text: string): Result<readonly ImportRow[], ImportError> {
  const read = readCsv(text);
  if (!read.ok) return read;
  const [header, ...body] = read.value;
  if (!header || body.length === 0) return err("empty");
  if (body.length > MAX_IMPORT_ROWS) return err("too-many-rows");
  const columns: (ImportColumn | null)[] = [];
  for (const name of header.fields) {
    const column = columnOf(name);
    if (!column && name.trim() !== "") return err(`unknown-column:${name.trim().slice(0, 40)}`);
    columns.push(column);
  }
  if (!columns.includes("client")) return err("no-client-column");
  const rows: ImportRow[] = [];
  const names = new Map<string, number>();
  for (const { fields, line } of body) {
    const get = (column: ImportColumn): string => (fields[columns.indexOf(column)] ?? "").trim();
    const bad = (problem: string) => err(`row:${line}:${problem}`);
    if (fields.length > columns.length && fields.slice(columns.length).some((one) => one.trim() !== "")) return bad("it has more values than the header has columns. Put quotes around any value with a comma in it.");
    const client = get("client").replace(/\s+/g, " ");
    if (!client) return bad("it has no client name.");
    const seen = names.get(client.toLowerCase());
    if (seen !== undefined) return bad(`${client} is also on line ${seen}.`);
    names.set(client.toLowerCase(), line);
    const demo = yes(get("demo"));
    if (demo === null) return bad("demo is yes or no.");
    const contactName = get("contact");
    const email = get("email").toLowerCase() || null;
    const phone = get("phone") || null;
    if (!contactName && (email || phone || get("title"))) return bad("it has an email, phone or title but no contact name.");
    const projectName = get("project").replace(/\s+/g, " ");
    const projectOnly = (["service", "pricing", "price", "source", "repository", "live"] as const).find((column) => get(column) !== "");
    if (!projectName && projectOnly) return bad(`it has a ${projectOnly} but no project name.`);
    let project: ImportRow["project"] = null;
    if (projectName) {
      const serviceText = get("service").toLowerCase() || "website";
      const service = LABEL_TO_SERVICE[serviceText] ?? serviceText;
      if (!isService(service)) return bad(`“${get("service")}” isn’t a service. Use website, landing page, blog, application, automation, consulting, social media or domain management.`);
      const pricingText = get("pricing").toLowerCase();
      const price = get("price");
      const pricing = pricingText || (/^free$/i.test(price) ? "free" : "");
      if (!pricing) return bad("a project needs its pricing: free, fixed, hourly, monthly or yearly.");
      if (!isPricing(pricing)) return bad(`“${get("pricing")}” isn’t a pricing. Use free, fixed, hourly, monthly or yearly.`);
      if (pricing !== "free" && !price) return bad(`a ${pricing} project needs its price, like 1500.`);
      const sourceText = get("source").toLowerCase();
      const source = sourceText ? (LABEL_TO_SOURCE[sourceText] ?? sourceText) : "other";
      if (!(LEAD_SOURCES as readonly string[]).includes(source)) return bad(`“${get("source")}” isn’t a lead source. Use word of mouth, phone, email, website, social, referral or other.`);
      project = { name: projectName, service, pricing, price: pricing === "free" ? "" : price, source: source as LeadSource, repository: get("repository") || null, live: get("live") || null };
    }
    rows.push({ line, client, website: get("website") || null, demo, contact: contactName ? { name: contactName, title: get("title") || null, email, phone } : null, project });
  }
  return ok(rows);
}
