// Sign-in, sessions and one-time links come from the kit's staff module
// (decision 0001). HQ uses it for who someone is. What they may do is decided
// by HQ's own roles, never by the kit's.
import { createNotices } from "@potomac-solutions/kit/notice";
import { createStaff, type Staff } from "@potomac-solutions/kit/staff";
import { clientAddress, staffPages, type StaffPages } from "@potomac-solutions/kit/staff/pages";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountAdmin } from "../application/ports.ts";
import type { Database } from "../../shared/adapters.ts";
import type { KitStore } from "@potomac-solutions/kit/store";
import { sqliteKitStore } from "./kit-store.ts";

export type { Staff, StaffPages };

export function createHqStaff(db: Database, options: { secure: boolean; passwordCost?: { N: number; r: number; p: number } }): Staff {
  return createStaff({
    store: sqliteKitStore(db),
    // The kit needs an owner role. HQ's first admin is the kit's owner.
    roles: ["owner", "staff"],
    name: "hq",
    secure: options.secure,
    ...(options.passwordCost ? { cost: options.passwordCost } : {}),
  });
}

export function createHqStaffPages(options: {
  staff: Staff;
  secure: boolean;
  proxies: number;
  noticeSecret: string;
  render: (res: ServerResponse, title: string, body: string) => void;
}): {
  pages: StaffPages;
  clientOf: (req: IncomingMessage) => string;
  readNotice: (url: URL) => { problem: string; done: string; undo: string };
  notices: { sign(location: string): string };
} {
  // `undo` is the post that reverses the one just made (decision 0014), signed like the messages.
  const notices = createNotices({ secret: options.noticeSecret, keys: ["problem", "done", "undo"] });
  const pages = staffPages({
    staff: options.staff,
    home: "/",
    business: "Potomac HQ",
    render: options.render,
    secure: options.secure,
    notices,
    proxies: options.proxies,
  });
  return {
    pages,
    clientOf: (req) => clientAddress(req, { proxies: options.proxies }),
    readNotice: (url) => {
      const read = notices.read(url);
      return { problem: read.problem, done: read.done, undo: read["undo"] ?? "" };
    },
    notices,
  };
}

/**
 * The kit lets only an "owner" invite, reset and disable. HQ decides who may
 * do those with its own permissions, before calling here, so this acts as
 * any owner who can still sign in. An HQ admin is kept an owner in the kit,
 * so the kit's "the last owner stays" rule and HQ's "the last admin stays"
 * rule are the same rule.
 */
export function accountAdmin(staff: Staff, store: KitStore): AccountAdmin {
  const owner = () => staff.list().find((person) => person.roles.includes("owner") && !person.disabled) ?? null;
  return {
    async invite(email, name) {
      const by = owner();
      if (!by) return null;
      const made = await staff.invite({ account: by.account }, { email, name, roles: ["staff"] });
      return made.ok ? made.token : null;
    },
    async resetLink(staffAccount) {
      const by = owner();
      if (!by) return null;
      const made = await staff.resetLink({ account: by.account }, staffAccount);
      return made.ok ? made.token : null;
    },
    async setDisabled(staffAccount, disabled) {
      const by = owner();
      if (!by) return false;
      return Boolean((await staff.setDisabled({ account: by.account }, staffAccount, disabled)).ok);
    },
    async setAdmin(staffAccount, admin) {
      const by = owner();
      if (!by) return false;
      return Boolean((await staff.setRoles({ account: by.account }, staffAccount, admin ? ["owner", "staff"] : ["staff"])).ok);
    },
    // The kit has no way to delete an account (decision 0025), so this
    // retires it in its own store: off, its sessions ended, no password that
    // can ever match, and an email nobody has, so the real one is free.
    async retire(staffAccount, email) {
      // No account means nothing can sign in as them: already retired.
      if (!store.get("accounts", staffAccount)) return true;
      await store.write("accounts", staffAccount, { disabled: true, roles: ["staff"], email, hash: "", retiredAt: Date.now() });
      await staff.endSessions(staffAccount);
      return true;
    },
    // The kit has no way to take back a link, so this marks it used, as the
    // kit does when a link is accepted. The kit refuses a used link.
    spendInviteLinks(email) {
      const wanted = email.trim().toLowerCase();
      const open = store.under("staff-tokens").filter((one) => one["kind"] === "invite" && one["used"] === false && String(one["email"] ?? "").toLowerCase() === wanted);
      for (const one of open) void store.write("staff-tokens", String(one["key"]), { used: true, usedAt: Date.now(), withdrawn: true });
      return open.length;
    },
  };
}
