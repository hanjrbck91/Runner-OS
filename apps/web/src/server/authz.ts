/**
 * Authorization policy — provider-agnostic. Both Google OAuth and the
 * magic-link provider pass their authenticated email through this single
 * allowlist check, so no authenticated identity (Google or email) is admitted
 * unless it appears in AUTH_ALLOWED_EMAIL. Pure + testable; case-insensitive.
 *
 * AUTH_ALLOWED_EMAIL holds one or more emails, comma-separated
 * (e.g. "me@gmail.com,friend@gmail.com"). Each admitted email still gets its
 * own row in `users` (keyed by email) and every Daily/Plan record is scoped by
 * that user's id, so multiple allowed emails means multiple isolated
 * athletes — never shared data.
 */
export function isAllowedEmail(email: string | null | undefined, allowed: string | undefined): boolean {
  if (!email || !allowed) return false;
  const target = email.trim().toLowerCase();
  return allowed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
    .includes(target);
}
