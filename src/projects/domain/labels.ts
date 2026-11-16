// Words for people. Codes stay in storage; these are what screens show.
export const KIND_LABELS: Readonly<Record<string, string>> = { fixed: "One-time work", ongoing: "Ongoing plan" };
export const STATUS_LABELS: Readonly<Record<string, string>> = { active: "Active", completed: "Completed", cancelled: "Cancelled" };
export const HEALTH_LABELS: Readonly<Record<string, string>> = { "on-track": "On track", "at-risk": "At risk", "off-track": "Off track" };
export const TASK_STATUS_LABELS: Readonly<Record<string, string>> = { todo: "To do", doing: "Working on", blocked: "Blocked", done: "Done" };
export const PRIORITY_LABELS: Readonly<Record<string, string>> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
export const DELIVERABLE_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: "Draft, not shared",
  shared: "Shared, waiting for the client",
  approved: "Approved by the client",
  "changes-requested": "Changes requested",
};

/** [{ value, label }] for a select. */
export function options(labels: Readonly<Record<string, string>>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
