// What Potomac's public website is told to do: be open, say "coming soon", or
// say "back shortly", and an optional announcement on top of every page.
import { err, ok, type Result } from "../../shared/domain/result.ts";

export const SITE_MODES = ["live", "coming-soon", "maintenance"] as const;
export type SiteMode = (typeof SITE_MODES)[number];
export const SITE_MODE_LABELS: Readonly<Record<SiteMode, string>> = { live: "Open to everyone", "coming-soon": "Coming soon", maintenance: "Down for maintenance" };

export type SiteSettings = {
  readonly mode: SiteMode;
  /** The heading on the closed page. Empty means the website's own wording. */
  readonly title: string;
  readonly message: string;
  /** "Back by 9 pm tonight". */
  readonly eta: string;
  readonly bannerText: string;
  readonly bannerLinkText: string;
  readonly bannerHref: string;
  /** The secret in the preview link that lets the owners see a closed site. */
  readonly previewToken: string;
};

/** A new install: the website stays open until someone says otherwise. */
export const OPEN_SETTINGS: SiteSettings = { mode: "live", title: "", message: "", eta: "", bannerText: "", bannerLinkText: "", bannerHref: "", previewToken: "" };

export type SettingsInput = { readonly mode: string; readonly title?: string; readonly message?: string; readonly eta?: string; readonly bannerText?: string; readonly bannerLinkText?: string; readonly bannerHref?: string };
export type SettingsError = "invalid-mode" | "title-too-long" | "message-too-long" | "eta-too-long" | "banner-too-long" | "link-text-too-long" | "link-text-missing" | "invalid-link";

const clean = (value: string | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

/** Checks a form against the current settings. The preview token is never changed here. */
export function changeSettings(current: SiteSettings, input: SettingsInput): Result<SiteSettings, SettingsError> {
  if (!(SITE_MODES as readonly string[]).includes(input.mode)) return err("invalid-mode");
  const title = clean(input.title);
  const message = clean(input.message);
  const eta = clean(input.eta);
  const bannerText = clean(input.bannerText);
  const bannerLinkText = clean(input.bannerLinkText);
  const bannerHref = clean(input.bannerHref);
  if (title.length > 80) return err("title-too-long");
  if (message.length > 400) return err("message-too-long");
  if (eta.length > 80) return err("eta-too-long");
  if (bannerText.length > 200) return err("banner-too-long");
  if (bannerLinkText.length > 40) return err("link-text-too-long");
  if (bannerHref && !/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/.test(bannerHref)) return err("invalid-link");
  if (bannerHref && !bannerLinkText) return err("link-text-missing");
  return ok({ ...current, mode: input.mode as SiteMode, title, message, eta, bannerText, bannerLinkText, bannerHref });
}

/** What the website is sent. */
export type PublicSettings = {
  readonly mode: SiteMode;
  readonly title: string;
  readonly message: string;
  readonly eta: string;
  readonly banner: { readonly text: string; readonly linkText: string; readonly href: string } | null;
  readonly previewToken: string;
};

export function publicSettings(settings: SiteSettings): PublicSettings {
  return {
    mode: settings.mode,
    title: settings.title,
    message: settings.message,
    eta: settings.eta,
    banner: settings.bannerText ? { text: settings.bannerText, linkText: settings.bannerLinkText, href: settings.bannerHref } : null,
    previewToken: settings.previewToken,
  };
}
