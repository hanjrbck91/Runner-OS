/**
 * Authorization policy — provider-agnostic. Both Google OAuth and the
 * magic-link provider pass their authenticated email through this single
 * allowlist check, so no authenticated identity (Google or email) is admitted
 * unless it matches AUTH_ALLOWED_EMAIL. Pure + testable; case-insensitive.
 */
export function isAllowedEmail(email: string | null | undefined, allowed: string | undefined): boolean {
  if (!email || !allowed) return false;
  return email.trim().toLowerCase() === allowed.trim().toLowerCase();
}
