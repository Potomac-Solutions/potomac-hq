// A business Potomac works with or hopes to (docs/data-model.md).
import type { Id } from "../../shared/domain/id.ts";
import { err, ok, type Result } from "../../shared/domain/result.ts";
import { optionalPhone, optionalText, optionalWebsite, requiredText } from "./fields.ts";

export const CLIENT_STATUSES = ["prospective", "active", "inactive", "former"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const SIZE_TIERS = ["small", "established", "large"] as const;
export type SizeTier = (typeof SIZE_TIERS)[number];

export type Client = {
  readonly id: Id;
  readonly name: string;
  readonly status: ClientStatus;
  readonly sizeTier: SizeTier | null;
  readonly website: string | null;
  readonly phone: string | null;
  readonly address: string | null;
};

export type ClientInput = {
  readonly name: string;
  readonly sizeTier?: string | null;
  readonly website?: string | null;
  readonly phone?: string | null;
  readonly address?: string | null;
};

export type ClientError =
  | "name-missing"
  | "name-too-long"
  | "invalid-size-tier"
  | "invalid-website"
  | "invalid-phone"
  | "address-too-long";

export function isSizeTier(value: string): value is SizeTier {
  return (SIZE_TIERS as readonly string[]).includes(value);
}

export function isClientStatus(value: string): value is ClientStatus {
  return (CLIENT_STATUSES as readonly string[]).includes(value);
}

/** A new client starts as a prospect. */
export function newClient(id: Id, input: ClientInput): Result<Client, ClientError> {
  const name = requiredText(input.name, 200);
  if (!name.ok) return err(name.error === "missing" ? "name-missing" : "name-too-long");
  const tier = (input.sizeTier ?? "").trim();
  if (tier !== "" && !isSizeTier(tier)) return err("invalid-size-tier");
  const website = optionalWebsite(input.website);
  if (!website.ok) return website;
  const phone = optionalPhone(input.phone);
  if (!phone.ok) return phone;
  const address = optionalText(input.address, 500);
  if (!address.ok) return err("address-too-long");
  return ok({
    id,
    name: name.value,
    status: "prospective",
    sizeTier: tier === "" ? null : (tier as SizeTier),
    website: website.value,
    phone: phone.value,
    address: address.value,
  });
}

/** Set by hand: any status but the one it has. */
export function changeClientStatus(client: Client, to: string): Result<Client, "invalid-status" | "unchanged"> {
  if (!isClientStatus(to)) return err("invalid-status");
  if (to === client.status) return err("unchanged");
  return ok({ ...client, status: to });
}

/** A client becomes active when one of its opportunities is won. Null when it already is. */
export function activateOnWin(client: Client): Client | null {
  return client.status === "active" ? null : { ...client, status: "active" };
}
