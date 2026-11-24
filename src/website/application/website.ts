// The website's settings: who may see and change them, and what the website
// itself is told. Permissions: `website.view` and `website.edit`, both for
// admins only, because this decides whether the company's front door is open.
import { changeSettings, publicSettings, SITE_MODES, SITE_MODE_LABELS, type PublicSettings, type SettingsError, type SettingsInput, type SiteSettings } from "../domain/settings.ts";
import { authorize, type IdentityUserStore } from "../../identity/index.ts";
import { err, ok, recordActivity, type ActivityDeps, type Id, type Result, type Transact } from "../../shared/index.ts";
import type { SiteSettingsStore, SiteTokens } from "./ports.ts";

export type WebsiteDeps = ActivityDeps & {
  readonly users: IdentityUserStore;
  readonly transact: Transact;
  readonly site: SiteSettingsStore;
  readonly tokens: SiteTokens;
  /** The public address, like https://potomac.solutions, for the preview link. */
  readonly siteUrl: string;
};

/** The website is one record; its activity events point at this fixed id. */
const WEBSITE_ID = "00000000-0000-4000-8000-000000000001" as Id;
const allowed = (deps: WebsiteDeps, actorId: Id | null, action: string): actorId is Id => actorId !== null && authorize(deps, actorId, action).ok;

export type WebsiteView = {
  readonly settings: SiteSettings;
  readonly modes: readonly { readonly value: string; readonly label: string }[];
  readonly previewLink: string;
  readonly connected: boolean;
  readonly canEdit: boolean;
};

/** The settings page. Permission: `website.view`. */
export function websiteView(deps: WebsiteDeps, actorId: Id | null): Result<WebsiteView, "forbidden"> {
  if (!allowed(deps, actorId, "website.view")) return err("forbidden");
  const settings = deps.site.get();
  return ok({
    settings,
    modes: SITE_MODES.map((value) => ({ value, label: SITE_MODE_LABELS[value] })),
    previewLink: settings.previewToken ? `${deps.siteUrl}/?preview=${settings.previewToken}` : "",
    connected: deps.site.tokenHash() !== null,
    canEdit: allowed(deps, actorId, "website.edit"),
  });
}

/** Opens or closes the website, and sets its message and banner. Permission: `website.edit`. */
export function saveSiteSettings(deps: WebsiteDeps, actorId: Id | null, input: SettingsInput): Result<SiteSettings, "forbidden" | SettingsError> {
  if (!allowed(deps, actorId, "website.edit")) return err("forbidden");
  return deps.transact(() => {
    const before = deps.site.get();
    const made = changeSettings(before, input);
    if (!made.ok) return made;
    deps.site.save(made.value, deps.clock());
    recordActivity(deps, { actorId, action: "website.settings-changed", recordType: "website", recordId: WEBSITE_ID, context: { from: before.mode, to: made.value.mode, banner: made.value.bannerText !== "" } });
    return ok(made.value);
  });
}

/** Makes a new private preview link; the old one stops working. Permission: `website.edit`. */
export function renewPreviewLink(deps: WebsiteDeps, actorId: Id | null): Result<SiteSettings, "forbidden"> {
  if (!allowed(deps, actorId, "website.edit")) return err("forbidden");
  return deps.transact(() => {
    const next = { ...deps.site.get(), previewToken: deps.tokens.newToken() };
    deps.site.save(next, deps.clock());
    recordActivity(deps, { actorId, action: "website.preview-link-renewed", recordType: "website", recordId: WEBSITE_ID, context: {} });
    return ok(next);
  });
}

/**
 * Makes the token the website uses to ask HQ for these settings. Run from the
 * server (`npm run site:token`), so the secret is never in a page or an address.
 * Only its hash is kept; making a new one cuts off the old.
 */
export function issueSiteToken(deps: WebsiteDeps): string {
  const token = deps.tokens.newToken();
  deps.transact(() => {
    deps.site.setTokenHash(deps.tokens.hash(token), deps.clock());
    recordActivity(deps, { actorId: null, action: "website.token-issued", recordType: "website", recordId: WEBSITE_ID, context: { by: "server-command" } });
  });
  return token;
}

/** What the website is sent, if it showed the right token; otherwise null. */
export function settingsForSite(deps: WebsiteDeps, token: string | null): PublicSettings | null {
  const hash = deps.site.tokenHash();
  if (!token || !hash || !deps.tokens.matches(token, hash)) return null;
  return publicSettings(deps.site.get());
}
