// Public entry for webhooks: HQ posting what happened to an address an admin chose (decision 0007, section 12).
export * from "./application/webhooks.ts";
export { HOOK_EVENTS, type HookEvent, type Webhook } from "./domain/webhook.ts";
