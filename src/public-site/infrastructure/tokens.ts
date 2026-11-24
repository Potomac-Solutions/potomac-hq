import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SiteTokens } from "../application/ports.ts";

/** 32 random bytes; only a hash of the website's token is stored. */
export const siteTokens: SiteTokens = {
  newToken: () => randomBytes(32).toString("base64url"),
  hash: (token) => createHash("sha256").update(token).digest("hex"),
  matches(token, hash) {
    const given = Buffer.from(createHash("sha256").update(token).digest("hex"));
    const stored = Buffer.from(hash);
    return given.length === stored.length && timingSafeEqual(given, stored);
  },
};
