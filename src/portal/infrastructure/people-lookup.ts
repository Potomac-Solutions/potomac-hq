// Finds a sign-up's match among portal users, CRM contacts and client phone
// numbers. The keys are worked out here rather than in SQL, since Gmail's
// dots and "+tags" don't fit a plain index; a small business's list is short.
import type { KnownPerson, PeopleLookup } from "../application/ports.ts";
import { emailKey, phoneKey } from "../domain/identity-keys.ts";
import type { Database } from "../../shared/adapters.ts";

type Row = { kind: string; organization_id: string; name: string; email: string | null; phone: string | null; status: string | null };

export function sqlitePeopleLookup(db: Database): PeopleLookup {
  const everyone = db.prepare(`
    select 'user' as kind, u.organization_id, u.name, u.email, null as phone, u.status
      from client_user u join client_organization o on o.id = u.organization_id where o.demo = 0
    union all
    select 'contact', c.organization_id, c.name, c.email, c.phone, null
      from contact c join client_organization o on o.id = c.organization_id where o.demo = 0
    union all
    select 'client', o.id, o.name, null, o.phone, null
      from client_organization o where o.demo = 0 and o.phone is not null`);
  return {
    match(keys) {
      if (!keys.email && !keys.phone) return null;
      const rows = everyone.all() as unknown as Row[];
      const matches = (row: Row) => (keys.email !== null && emailKey(row.email) === keys.email) || (keys.phone !== null && phoneKey(row.phone) === keys.phone);
      // One person may have access at more than one client (decision 0022): one turned off doesn't hide the others.
      const hit = rows.find((row) => matches(row) && row.status !== "disabled") ?? rows.find(matches);
      if (!hit) return null;
      // The link goes to the person who matched if they have an account; else to anyone at that client who does; else to the matched email.
      const users = rows.filter((row) => row.kind === "user" && row.organization_id === hit.organization_id);
      const user = (hit.kind === "user" ? hit : null) ?? users.find((row) => row.status !== "disabled") ?? users[0] ?? null;
      const person: KnownPerson = user
        ? { email: user.email, name: user.name, organizationId: user.organization_id, disabled: user.status === "disabled" }
        : { email: hit.email, name: hit.name, organizationId: hit.organization_id, disabled: false };
      return person;
    },
  };
}
