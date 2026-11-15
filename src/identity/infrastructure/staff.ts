// Sign-in, sessions and one-time links come from the kit's staff module
// (decision 0001). HQ uses it for who someone is. What they may do is decided
// by HQ's own roles, never by the kit's.
import { createNotices } from "@potomac-solutions/kit/notice";
import { createStaff, type Staff } from "@potomac-solutions/kit/staff";
import { clientAddress, staffPages, type StaffPages } from "@potomac-solutions/kit/staff/pages";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Database } from "../../shared/adapters.ts";
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
}): { pages: StaffPages; clientOf: (req: IncomingMessage) => string; readNotice: (url: URL) => { problem: string; done: string } } {
  const notices = createNotices({ secret: options.noticeSecret });
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
    readNotice: (url) => notices.read(url),
  };
}
