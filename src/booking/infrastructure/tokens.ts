import { createHash, randomBytes } from "node:crypto";
import type { BusyCalendar, ManageTokens } from "../application/ports.ts";

/** 32 random bytes; only a hash is stored. */
export const manageTokens: ManageTokens = {
  newToken: () => randomBytes(32).toString("base64url"),
  hash: (token) => createHash("sha256").update(token).digest("hex"),
};

/** No other calendar: only HQ's own calls are busy. */
export const noBusyCalendar: BusyCalendar = { name: "none", busy: async () => [] };
