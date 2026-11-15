// A person who signs in to HQ (docs/data-model.md, "User").
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";

export type UserStatus = "active" | "disabled";

export type User = {
  readonly id: Id;
  /** The kit staff account this user signs in with. */
  readonly staffAccount: string;
  readonly name: string;
  /** Stored lower-case. */
  readonly email: string;
  readonly status: UserStatus;
};

export type UserError = "invalid-name" | "invalid-email" | "invalid-staff-account";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newUser(input: {
  readonly id: Id;
  readonly staffAccount: string;
  readonly name: string;
  readonly email: string;
}): Result<User, UserError> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const staffAccount = input.staffAccount.trim();
  if (name.length === 0 || name.length > 200) return err("invalid-name");
  if (email.length > 254 || !EMAIL.test(email)) return err("invalid-email");
  if (staffAccount.length === 0) return err("invalid-staff-account");
  return ok({ id: input.id, staffAccount, name, email, status: "active" });
}
