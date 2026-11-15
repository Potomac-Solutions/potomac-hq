// A person at a client organization (docs/data-model.md).
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { optionalEmail, optionalPhone, optionalText, requiredText } from "./fields.ts";

export type Contact = {
  readonly id: Id;
  readonly organizationId: Id;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly isPrimary: boolean;
};

export type ContactInput = {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly title?: string | null;
  readonly isPrimary?: boolean;
};

export type ContactError = "name-missing" | "name-too-long" | "invalid-email" | "invalid-phone" | "email-or-phone-required" | "title-too-long";

export function newContact(id: Id, organizationId: Id, input: ContactInput): Result<Contact, ContactError> {
  const name = requiredText(input.name, 200);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const email = optionalEmail(input.email);
  if (!email.ok) return email;
  const phone = optionalPhone(input.phone);
  if (!phone.ok) return phone;
  if (email.value === null && phone.value === null) return err("email-or-phone-required");
  const title = optionalText(input.title, 100);
  if (!title.ok) return err("title-too-long");
  return ok({
    id,
    organizationId,
    name: name.value,
    email: email.value,
    phone: phone.value,
    title: title.value,
    isPrimary: input.isPrimary === true,
  });
}
