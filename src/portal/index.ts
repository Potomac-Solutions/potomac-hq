// Public entry for the client portal: client users tied to one organization,
// and what they may see and do there. Every client-side service is scoped by
// the session's organization.
export { sessionFor, type CallRequest, type ClientSession, type ClientUser, type ProjectUpdate } from "./domain/client-user.ts";
export type { CallStore, ClientUserStore, PortalAuth, UpdateStore } from "./application/ports.ts";
export * from "./application/staff-side.ts";
export * from "./application/client-side.ts";
