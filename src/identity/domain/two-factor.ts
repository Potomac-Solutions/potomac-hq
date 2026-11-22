// Two-factor sign-in: the rules that need no cryptography. The arithmetic
// of the codes is in infrastructure/totp.ts.

/** "123 456", "123-456", " 123456 " → "123456". Null when it is not six digits. */
export function cleanCode(typed: string): string | null {
  const digits = typed.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** "abcd-efgh-jk" in any case, with or without the dashes and spaces → "ABCDEFGHJK". Null when it cannot be one. */
export function cleanRecoveryCode(typed: string): string | null {
  const plain = typed.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z2-9]{10}$/.test(plain) ? plain : null;
}

/** "ABCDEFGHJK" → "ABCDE-FGHJK", for showing. */
export function showRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** "JBSWY3DPEHPK3PXP..." → "JBSW Y3DP EHPK 3PXP ...", easier to type into an app by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * The address an authenticator app reads: otpauth://totp/Potomac%20HQ%3Amikey%40example.com?...
 * SHA-1, six digits and 30 seconds are every app's defaults, so they are left
 * out: a shorter link makes a smaller QR code that is easier to scan.
 */
export function appLink(secret: string, email: string): string {
  const label = encodeURIComponent(`Potomac HQ:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Potomac HQ")}`;
}

export const RECOVERY_CODE_COUNT = 10;
