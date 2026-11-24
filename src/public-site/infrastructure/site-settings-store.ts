import type { SiteSettingsStore } from "../application/ports.ts";
import type { SiteMode, SiteSettings } from "../domain/settings.ts";
import type { Database } from "../../shared/adapters.ts";

const COLUMNS = "mode, title, message, eta, banner_text, banner_link_text, banner_href, preview_token";

export function sqliteSiteSettings(db: Database): SiteSettingsStore {
  const read = db.prepare(`select ${COLUMNS} from public_site_settings where id = 1`);
  const write = db.prepare("update public_site_settings set mode = ?, title = ?, message = ?, eta = ?, banner_text = ?, banner_link_text = ?, banner_href = ?, preview_token = ?, updated_at = ? where id = 1");
  const hash = db.prepare("select token_hash from public_site_settings where id = 1");
  const setHash = db.prepare("update public_site_settings set token_hash = ?, updated_at = ? where id = 1");
  return {
    get(): SiteSettings {
      const row = read.get() ?? {};
      return {
        mode: (row["mode"] as SiteMode | undefined) ?? "live",
        title: String(row["title"] ?? ""),
        message: String(row["message"] ?? ""),
        eta: String(row["eta"] ?? ""),
        bannerText: String(row["banner_text"] ?? ""),
        bannerLinkText: String(row["banner_link_text"] ?? ""),
        bannerHref: String(row["banner_href"] ?? ""),
        previewToken: String(row["preview_token"] ?? ""),
      };
    },
    save(s, at) {
      write.run(s.mode, s.title, s.message, s.eta, s.bannerText, s.bannerLinkText, s.bannerHref, s.previewToken, at);
    },
    tokenHash() {
      const value = hash.get()?.["token_hash"];
      return typeof value === "string" && value !== "" ? value : null;
    },
    setTokenHash(value, at) {
      setHash.run(value, at);
    },
  };
}
