// The keys that tell whether two sign-ups are the same person. An email is
// matched without its case, without a "+tag" and, at Gmail, without dots, so
// dale+2@gmail.com and d.ale@gmail.com are both dale@gmail.com. A phone is
// matched on its last ten digits, so (304) 555-0134 and +1 304 555 0134 agree.

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/** The email's key, or null when it is not an email. */
export function emailKey(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  let local = value.slice(0, at).split("+")[0] ?? "";
  let domain = value.slice(at + 1);
  if (GMAIL.has(domain)) {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : null;
}

/** The phone's key: its last ten digits, or null with fewer than ten. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}
