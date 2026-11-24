import type { SiteSettings } from "../domain/settings.ts";

export type SiteSettingsStore = {
  get(): SiteSettings;
  save(settings: SiteSettings, at: string): void;
  /** The hash of the token the website sends HQ, or null before one is made. */
  tokenHash(): string | null;
  setTokenHash(hash: string, at: string): void;
};

export type SiteTokens = {
  newToken(): string;
  hash(token: string): string;
  /** Compares in constant time. */
  matches(token: string, hash: string): boolean;
};
