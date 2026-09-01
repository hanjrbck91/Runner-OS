/**
 * Auth.js (NextAuth v5) — minimal single-user V1, email magic-link.
 * Allowlist enforced by the signIn callback against AUTH_ALLOWED_EMAIL (env,
 * never hardcoded). JWT session (session reads need no DB, so route gating is
 * fast). The authoritative userId is resolved server-side from the email by the
 * API layer (getOrCreateUserByEmail) — never trusted from the client.
 *
 * Persistence: the Nodemailer magic-link flow stores verification tokens and
 * users via the Drizzle adapter over the Auth.js tables (migrations/
 * 0002_auth.sql). Session strategy stays JWT so route gating needs no DB read.
 * SMTP delivery still requires EMAIL_SERVER / EMAIL_FROM at deploy time.
 */
import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getAuthDb } from './runtime.js';
import { authSchema } from './auth-schema.js';

/**
 * Build the Nodemailer transport from EMAIL_SERVER. We parse the URL and derive
 * `secure` from the port (465 = implicit TLS) instead of the URL scheme, because
 * a plain `smtp://host:465` string parses to secure:false and then fails against
 * a TLS-only port (silent "no email sent"). This makes both 465 (implicit TLS)
 * and 587 (STARTTLS) work regardless of scheme. Falls back to the raw string.
 * No secret values are logged; they are read from env at runtime only.
 */
function emailTransport(): unknown {
  const raw = process.env.EMAIL_SERVER;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const port = Number(u.port) || 587;
    return {
      host: u.hostname,
      port,
      secure: port === 465,
      auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) },
    };
  } catch {
    return raw;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(getAuthDb(), authSchema),
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  pages: { signIn: '/signin' },
  providers: [
    Nodemailer({
      server: emailTransport(),
      from: process.env.EMAIL_FROM,
    }),
  ],
  callbacks: {
    signIn({ user }) {
      return !!user?.email && user.email === process.env.AUTH_ALLOWED_EMAIL;
    },
  },
});
