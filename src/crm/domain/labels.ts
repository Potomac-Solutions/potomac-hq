// Words for people. Codes stay in storage; these are what screens show.
import { formatMoney, type Money } from "../../shared/domain/money.ts";

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  new: "New",
  "consult-booked": "Consult booked",
  consulted: "Consulted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const SERVICE_LABELS: Readonly<Record<string, string>> = {
  consulting: "Consulting",
  "landing-page": "Free landing page",
  "domain-management": "Domain management",
  website: "Multi-page website",
  blog: "Blog platform",
  "social-media": "Social media marketing",
  application: "Application development",
  automation: "Automations",
};

export const PRICING_LABELS: Readonly<Record<string, string>> = {
  free: "Free",
  hourly: "Hourly",
  fixed: "Fixed price",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const LEAD_SOURCE_LABELS: Readonly<Record<string, string>> = {
  "word-of-mouth": "Word of mouth",
  phone: "Phone",
  email: "Email",
  website: "Website",
  social: "Social media",
  referral: "Referral",
  other: "Other",
};

export const CLIENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  prospective: "Prospective",
  active: "Active",
  inactive: "Inactive",
  former: "Former",
};

export const SIZE_TIER_LABELS: Readonly<Record<string, string>> = {
  small: "Mom-and-pop",
  established: "Established small business",
  large: "Larger company",
};

/** "$50.00 a month", "Free", "$1,500.00 fixed price". */
export function priceLabel(pricing: string | null, value: Money | null): string | null {
  if (pricing === null || value === null) return null;
  const amount = formatMoney(value);
  switch (pricing) {
    case "free":
      return "Free";
    case "hourly":
      return `${amount} an hour`;
    case "monthly":
      return `${amount} a month`;
    case "yearly":
      return `${amount} a year`;
    default:
      return `${amount} fixed price`;
  }
}

/** [{ value, label }] for a select. */
export function options(labels: Readonly<Record<string, string>>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
