// Infrastructure door for the CRM module. See src/shared/adapters.ts.
export { sqliteClientStore, sqliteContactStore, sqliteOpportunityStore } from "./infrastructure/stores.ts";
export { sqliteTouchStore } from "./infrastructure/touch-store.ts";
export { sqliteCallScreenStore } from "./infrastructure/call-store.ts";
export { sqliteCallGuideStore } from "./infrastructure/call-guide-store.ts";
export { sqliteClientFacts } from "./infrastructure/client-facts.ts";
