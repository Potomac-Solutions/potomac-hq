// Where a lead came from (decision 0010, section 2). The website says where
// on it a person was when they wrote in, booked or signed up: `src` (a river
// stop, a Lab demo, a Work page, the planner, the blog or the newsletter),
// the page's path, and the usual campaign fields. HQ keeps the first it sees
// for each opportunity, and reads it as one line of the lead sources report.

export type LeadTouch = {
  readonly src: string;
  readonly path: string;
  readonly utmSource: string;
  readonly utmMedium: string;
  readonly utmCampaign: string;
};

const oneLine = (value: string | undefined, most: number): string => {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length <= most ? text : "";
};

/**
 * What the website sent, made safe to keep: anything odd is dropped, never
 * refused, so a bad field never loses a lead. Null when nothing is left.
 */
export function cleanTouch(raw: { readonly src?: string | undefined; readonly path?: string | undefined; readonly utmSource?: string | undefined; readonly utmMedium?: string | undefined; readonly utmCampaign?: string | undefined }): LeadTouch | null {
  const srcText = (raw.src ?? "").trim().toLowerCase();
  const src = /^[a-z0-9][a-z0-9:_\-./]{0,59}$/.test(srcText) ? srcText : "";
  const pathText = (raw.path ?? "").trim().split(/[?#]/)[0] ?? "";
  const path = /^\/(?!\/)[A-Za-z0-9\-._~/%]{0,199}$/.test(pathText) ? pathText : "";
  const touch = { src, path, utmSource: oneLine(raw.utmSource, 80), utmMedium: oneLine(raw.utmMedium, 80), utmCampaign: oneLine(raw.utmCampaign, 80) };
  return Object.values(touch).some((value) => value !== "") ? touch : null;
}

const STOP_LABELS: Readonly<Record<string, string>> = {
  mountains: "Mountains and farms",
  lakes: "Lakes and outdoors",
  roadside: "Roadside businesses",
  history: "History and the arts",
  enterprise: "Larger companies",
};

const LEAD_SOURCE_LABELS: Readonly<Record<string, string>> = {
  "word-of-mouth": "Word of mouth",
  phone: "Phone",
  email: "Email",
  website: "Website, page unknown",
  social: "Social media",
  referral: "Referred by someone",
  other: "Other",
};

/** "better-days-towing" as "Better Days Towing". */
const titled = (slug: string): string =>
  slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export type SourceLine = { readonly key: string; readonly label: string };

/** The line of the report a lead belongs to. */
export function sourceOf(lead: { readonly leadSource: string; readonly src: string; readonly utmSource: string; readonly referralCode: string | null }): SourceLine {
  const [kind = "", rest = ""] = lead.src.includes(":") ? [lead.src.slice(0, lead.src.indexOf(":")), lead.src.slice(lead.src.indexOf(":") + 1)] : [lead.src, ""];
  if (kind === "stop" && STOP_LABELS[rest]) return { key: lead.src, label: `River stop: ${STOP_LABELS[rest]}` };
  if (kind === "lab" && rest) return { key: lead.src, label: `Lab demo: ${titled(rest)}` };
  if (kind === "work" && rest) return { key: lead.src, label: `Work page: ${titled(rest)}` };
  if (kind === "planner") return { key: "planner", label: "The 60-second planner" };
  if (kind === "newsletter") return { key: "newsletter", label: "Notes from the river" };
  if (kind === "blog") return { key: "blog", label: "The blog" };
  if (lead.src) return { key: lead.src, label: `Website: ${lead.src}` };
  if (lead.referralCode) return { key: "referral-link", label: "Referral link (QR code)" };
  if (lead.utmSource) return { key: `utm:${lead.utmSource.toLowerCase()}`, label: `Campaign: ${lead.utmSource}` };
  return { key: `source:${lead.leadSource}`, label: LEAD_SOURCE_LABELS[lead.leadSource] ?? "Other" };
}

export type LeadRow = {
  readonly leadSource: string;
  readonly src: string;
  readonly utmSource: string;
  readonly referralCode: string | null;
  /** A booked call that has started, a call that reached them, a meeting, or a stage past it. */
  readonly hadCall: boolean;
  readonly proposalSent: boolean;
  readonly won: boolean;
  /** In cents, when won. */
  readonly wonMinor: number;
};

export type FunnelLine = SourceLine & { readonly leads: number; readonly calls: number; readonly proposals: number; readonly won: number; readonly wonMinor: number };

/** One line a source, most leads first, then the most won. */
export function funnel(rows: readonly LeadRow[]): FunnelLine[] {
  const lines = new Map<string, { key: string; label: string; leads: number; calls: number; proposals: number; won: number; wonMinor: number }>();
  for (const row of rows) {
    const source = sourceOf(row);
    const line = lines.get(source.key) ?? { ...source, leads: 0, calls: 0, proposals: 0, won: 0, wonMinor: 0 };
    line.leads += 1;
    if (row.hadCall) line.calls += 1;
    if (row.proposalSent) line.proposals += 1;
    if (row.won) {
      line.won += 1;
      line.wonMinor += row.wonMinor;
    }
    lines.set(source.key, line);
  }
  return [...lines.values()].sort((a, b) => b.leads - a.leads || b.won - a.won || a.label.localeCompare(b.label));
}

/** "3 of 8 (38%)". */
export function rate(part: number, whole: number): string {
  return whole === 0 ? "" : `${Math.round((part / whole) * 100)}%`;
}

export const PERIODS = [30, 90, 365] as const;
