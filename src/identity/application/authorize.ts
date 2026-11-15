// The permission check every application service runs first.
//
// It reads the user and their roles from storage each time. It never trusts
// roles a session claims (docs/authorization-matrix.md, rule 5).
import { can, type Access } from "../domain/access.ts";
import { err, ok, type Id, type Result } from "../../shared/index.ts";
import type { UserStore } from "./ports.ts";

export type Forbidden = "forbidden";

export function authorize(
  deps: { readonly users: UserStore },
  actorId: Id | null,
  action: string,
  record?: unknown,
): Result<Access, Forbidden> {
  const access = actorId === null ? null : deps.users.accessFor(actorId);
  if (access === null || !can(access, action, record)) return err("forbidden");
  return ok(access);
}
