// What the dashboard's activity panel may show, and how it words an event.

/** Record types every signed-in role may see activity for. */
export const CLIENT_RECORD_TYPES = ["client-organization", "contact", "opportunity", "project"] as const;

export type FeedScope = "everything" | "client-records";

const WORDING: Readonly<Record<string, string>> = {
  "user.created": "was added as a user",
  "user.signed-in": "signed in",
  "user.signed-out": "signed out",
  "user.password-changed": "changed their password",
  "user.reset-link-issued": "A password reset link was issued",
  "user.reset-link-emailed": "A password reset link was emailed",
  "client.created": "added a client",
  "client.status-changed": "changed a client’s status",
  "contact.created": "added a contact",
  "opportunity.created": "opened an opportunity",
  "opportunity.stage-changed": "moved an opportunity to a new stage",
  "opportunity.value-set": "priced an opportunity",
  "opportunity.follow-up-set": "set a follow-up",
  "opportunity.converted": "turned an opportunity into a project",
  "project.created": "started a project",
  "backup.completed": "A backup was saved",
  "backup.failed": "A backup failed",
};

/**
 * A short sentence ending for an action: "signed in". An action with no
 * wording yet is shown by its key, so nothing is ever hidden.
 */
export function describeAction(action: string): string {
  return WORDING[action] ?? action;
}

/** "Mikey Nichols signed in", or the wording alone when HQ acted by itself. */
export function describeEvent(action: string, actorName: string | null): string {
  const wording = describeAction(action);
  return actorName === null ? capitalise(wording) : `${actorName} ${wording}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const FEED_LIMIT = 20;
