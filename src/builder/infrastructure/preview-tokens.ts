// The preview frame's addresses (decision 0010, section 3). The frame is
// sandboxed into an origin of its own, so the browser sends it no cookies.
// Its address carries the right to see one version instead: the build, the
// version and an expiry, signed with HQ's secret. Only a page that checked
// `site.build` makes one, and it stops working after an hour.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PreviewTokens } from "../application/ports.ts";
import { parseId } from "../../shared/index.ts";

const LIFETIME_MS = 60 * 60_000;

export function previewTokens(secret: string, clock: () => number = Date.now): PreviewTokens {
  const key = createHmac("sha256", secret).update("potomac-hq builder preview").digest();
  const sign = (body: string) => createHmac("sha256", key).update(body).digest("base64url");
  return {
    make(buildId, version) {
      const body = `${buildId}.${version}.${Math.floor((clock() + LIFETIME_MS) / 1000)}`;
      return `${body}.${sign(body)}`;
    },
    read(token) {
      const match = /^([0-9a-f-]{36})\.(\d{1,6})\.(\d{10,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
      if (!match) return null;
      const [, id = "", version = "", until = "", given = ""] = match;
      const expected = Buffer.from(sign(`${id}.${version}.${until}`));
      const sent = Buffer.from(given);
      if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) return null;
      if (Number(until) * 1000 < clock()) return null;
      const parsed = parseId(id);
      return parsed.ok ? { buildId: parsed.value, version: Number(version) } : null;
    },
  };
}
