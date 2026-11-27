// Sign-in for client users. It is a second instance of the kit's staff
// module (decision 0001: identity uses kit/staff), kept in its own
// collections of the same store and under its own cookie, so a client's
// account can never be an HQ account and the other way round.
import { createStaff } from "@potomac-solutions/kit/staff";
import type { KitStore } from "@potomac-solutions/kit/store";
import { randomBytes } from "node:crypto";
import type { PortalAuth } from "../application/ports.ts";

/** The same store, with every collection renamed, so the two instances share nothing. */
function prefixed(store: KitStore, prefix: string): KitStore {
  return {
    get: (collection, key) => store.get(prefix + collection, key),
    under: (collection, start) => store.under(prefix + collection, start),
    write: (collection, key, fields) => store.write(prefix + collection, key, fields),
  };
}

// The kit lets only an "owner" invite people and issue reset links. The
// portal has no person in that role: HQ's own users do the inviting. So the
// portal gets one owner account that nobody can sign in to. Its password is
// random and thrown away, and it has no client user, so even a session for
// it would see nothing.
const SYSTEM_EMAIL = "portal-system@potomac-hq.invalid";

export function createPortalAuth(store: KitStore, options: { secure: boolean; passwordCost?: { N: number; r: number; p: number } }): PortalAuth {
  const staff = createStaff({ store: prefixed(store, "portal:"), roles: ["owner", "client"], name: "hq_portal", secure: options.secure, ...(options.passwordCost ? { cost: options.passwordCost } : {}) });

  async function system(): Promise<{ account: string }> {
    const existing = staff.list().find((one) => one.email === SYSTEM_EMAIL);
    if (existing) return { account: existing.account };
    const token = await staff.setup();
    if (!token) throw new Error("The portal has accounts but no system account.");
    const made = await staff.accept(token, { email: SYSTEM_EMAIL, name: "Potomac HQ", password: randomBytes(48).toString("base64url") });
    if (!made.ok) throw new Error(`Could not make the portal's system account: ${made.error}`);
    await staff.endSessions(made.account);
    return { account: made.account };
  }

  return {
    session(cookieHeader) {
      const who = staff.session(cookieHeader);
      return who && who.email !== SYSTEM_EMAIL ? { account: who.account } : null;
    },
    async signIn(email, password, client) {
      if (email.trim().toLowerCase() === SYSTEM_EMAIL) return { ok: false, error: "wrong" };
      const result = await staff.signIn(email, password, { client });
      return result.ok ? { ok: true, cookie: result.cookie } : { ok: false, error: result.error };
    },
    async signOut(cookieHeader) {
      return (await staff.signOut(cookieHeader)).cookie;
    },
    async invite(email, name) {
      const made = await staff.invite(await system(), { email, name, roles: ["client"] });
      return made.ok ? made.token : null;
    },
    accountFor(email) {
      const clean = email.trim().toLowerCase();
      return clean === SYSTEM_EMAIL ? null : (staff.list().find((one) => one.email === clean)?.account ?? null);
    },
    async resetLink(account) {
      const made = await staff.resetLink(await system(), account);
      return made.ok ? made.token : null;
    },
    peek(token) {
      const found = staff.peek(token);
      return found && !found.setup ? { kind: found.kind, email: found.email } : null;
    },
    async accept(token, form) {
      const found = staff.peek(token);
      if (!found || found.setup) return { ok: false, message: "That link has expired or been used. Ask Potomac Solutions for a new one." };
      const result = await staff.accept(token, { name: form.name, password: form.password });
      return result.ok ? { ok: true, account: result.account, cookie: result.cookie } : { ok: false, message: result.error };
    },
    async setDisabled(account, disabled) {
      await staff.setDisabled(await system(), account, disabled);
    },
  };
}
