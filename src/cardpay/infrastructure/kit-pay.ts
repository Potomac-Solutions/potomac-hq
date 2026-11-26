// The kit's `pay` set up for HQ: which platform, from the environment, and
// the kit's documents in SQLite.
import { createPay, testProvider, type KitPay, type TestProvider } from "@potomac-solutions/kit/pay";
import { createProviders, fromEnv, PROVIDER_NAMES } from "@potomac-solutions/kit/pay/providers";
import type { KitStore } from "@potomac-solutions/kit/store";

export type CardPayConfig = { readonly platform: string; readonly settings: Record<string, Record<string, unknown>> };

/**
 * HQ_PAY_PROVIDER names the platform (stripe, square, paypal, helcim, or test)
 * and HQ_PAY_<PLATFORM>_* hold its keys, as the kit reads them without the HQ_.
 * Null when card payments are off; a string when the settings can't be used.
 */
export function cardPayConfigFrom(env: Record<string, string | undefined>, publicUrl: string): CardPayConfig | string | null {
  const own: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (name.startsWith("HQ_PAY_")) own[name.slice(3)] = value;
  const { use, settings } = fromEnv(own);
  if (!use) return null;
  if (use === "test") return { platform: "test", settings: {} };
  if (!PROVIDER_NAMES.includes(use)) return `HQ_PAY_PROVIDER is "${use}". It can be ${PROVIDER_NAMES.join(", ")} or test.`;
  if (!settings[use]) return `HQ_PAY_PROVIDER is ${use}, but its keys (HQ_PAY_${use.toUpperCase()}_*) are not all set.`;
  if (!/^https:\/\//.test(publicUrl)) return `Card payments need HQ_PUBLIC_URL to be HQ's https address: ${use} sends clients back to it.`;
  // Square signs the address it was given for the webhook.
  if (use === "square" && !settings["square"]?.["webhookUrl"]) settings["square"] = { ...settings["square"], webhookUrl: `${publicUrl}/pay/webhook/square` };
  return { platform: use, settings: { [use]: settings[use] as Record<string, unknown> } };
}

export type CardPayKit = { readonly pay: KitPay; readonly platform: string; readonly test: TestProvider | null };

export function createCardPayKit(store: KitStore, config: CardPayConfig, options: { readonly fetch?: typeof fetch; readonly wanted?: (payId: string) => boolean } = {}): CardPayKit | null {
  const test = config.platform === "test" ? testProvider({ page: "/pay/test" }) : null;
  const provider = test ?? createProviders(config.settings, options.fetch ? { fetch: options.fetch } : {}).get(config.platform);
  if (!provider) return null;
  return { pay: createPay({ provider, store, collection: "card-payments", ...(options.wanted ? { wanted: options.wanted } : {}) }), platform: config.platform, test };
}

/** Whether a kit payment has been put on its invoice: kept beside the kit's own documents. */
export function recordedFlags(store: KitStore) {
  return {
    recorded: (payId: string): boolean => store.get("card-payments-recorded", payId) !== null,
    markRecorded: (payId: string, how: "recorded" | "unmatched"): void => void store.write("card-payments-recorded", payId, { how }),
  };
}
