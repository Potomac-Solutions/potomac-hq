// Public entry for the newsletter, "Notes from the river" (decision 0010,
// section 1): who is on the list, issues, and sending them.
export * from "./application/newsletter.ts";
export type { IssueStore, LinkTokens, NewsletterMail, SendStore, SubscriberStore } from "./application/ports.ts";
export { STOP_LABELS, stopFrom, type Stop } from "./domain/newsletter.ts";
