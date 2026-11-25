// Public entry for the dashboard module.
export { recentActivity, type ActivityFeedView, type ActivityItemView, type RecentActivityDeps } from "./application/recent-activity.ts";
export type { ActivityReader, ActivityRow } from "./application/ports.ts";
export { auditHistory, auditTable, type AuditDeps, type AuditTable, type AuditView } from "./application/audit-history.ts";
export type { AuditFilter, AuditReader, AuditRow } from "./application/ports.ts";
export { search, type SearchDeps, type SearchView } from "./application/search.ts";
export type { SearchHit, SearchKind, SearchReader } from "./application/ports.ts";
export { HUBS, matchPlaces, navHubs, placeAt, PLACES, type HubKey, type NavHub, type NavLink, type Place } from "./domain/places.ts";
export { setupChecklist, type Setup, type SetupFacts, type SetupItem } from "./domain/setup.ts";
export { pinsFor, togglePin, type PinsDeps, type PinStore } from "./application/pins.ts";
export { cleanHref, MAX_PINS, type Pin } from "./domain/pins.ts";
export { sizeText, statusChecks, type StatusCheck, type StatusFacts } from "./domain/status.ts";
