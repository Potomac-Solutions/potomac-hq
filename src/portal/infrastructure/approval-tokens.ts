// Approving from email (quality of life, 2026-11-25): a link in the email
// that opens one deliverable for one client user, signed with HQ's notice
// secret and good for 14 days. It answers only for that deliverable and that
// person, and only while the deliverable waits on a decision.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ApprovalTokens } from "../application/client-side.ts";
import type { Id } from "../../shared/index.ts";

const DAYS = 14;

export function approvalTokens(secret: string, now: () => number = () => Date.now()): ApprovalTokens {
  const mac = (payload: string) => createHmac("sha256", `approve:${secret}`).update(payload).digest("base64url");
  return {
    make(deliverableId, clientUserId) {
      const payload = Buffer.from(JSON.stringify({ d: deliverableId, u: clientUserId, e: Math.floor(now() / 1000) + DAYS * 86_400 })).toString("base64url");
      return `${payload}.${mac(payload)}`;
    },
    read(token) {
      const [payload = "", signature = ""] = token.split(".");
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
      const expected = Buffer.from(mac(payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { d?: unknown; u?: unknown; e?: unknown };
        if (typeof body.d !== "string" || typeof body.u !== "string" || typeof body.e !== "number" || body.e * 1000 < now()) return null;
        return { deliverableId: body.d as Id, clientUserId: body.u as Id };
      } catch {
        return null;
      }
    },
  };
}
