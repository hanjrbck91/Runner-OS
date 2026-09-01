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
 *
 * SMTP transport: nodemailer is CJS with no __esModule/default, so @auth/core's
 * internal `import { createTransport } from "nodemailer"` resolves to undefined
 * when bundled ("createTransport is not a function"). We therefore DEFAULT-import
 * nodemailer (which yields the CJS exports object) and supply our own
 * sendVerificationRequest, bypassing @auth/core's broken named import.
 */
import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import nodemailerLib from 'nodemailer';
import { getAuthDb } from './runtime.js';
import { authSchema } from './auth-schema.js';
import { isAllowedEmail } from './server/authz.js';

/**
 * Parse EMAIL_SERVER into a transport config, deriving `secure` from the port
 * (465 = implicit TLS) so both 465 and 587 work regardless of URL scheme.
 * Falls back to the raw string. No secret values are logged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emailTransport(): any {
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

const emailProvider = Nodemailer({
  server: emailTransport(),
  from: process.env.EMAIL_FROM,
  // Own sendVerificationRequest → uses the default-imported nodemailer, so
  // createTransport is always the real CJS function.
  async sendVerificationRequest({ identifier, url, provider }) {
    const transport = nodemailerLib.createTransport(provider.server);
    const { host } = new URL(url);
    await transport.sendMail({
      to: identifier,
      from: provider.from,
      subject: `Sign in to Runner OS`,
      text: `Sign in to Runner OS (${host})\n\n${url}\n\nIf you did not request this, ignore this email.\n`,
      html:
        `<body style="font-family:'Courier New',monospace;background:#0f120d;color:#dfeccb;padding:24px">` +
        `<h2 style="color:#a7c06a;letter-spacing:3px">RUNNER·OS</h2>` +
        `<p>Tap to sign in:</p>` +
        `<p><a href="${url}" style="color:#a7c06a">${url}</a></p>` +
        `<p style="color:#7f8f6b">If you did not request this, ignore this email.</p></body>`,
    });
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(getAuthDb(), authSchema),
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  pages: { signIn: '/signin' },
  // Two ways in, one identity model: Google OAuth and the magic-link email.
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    emailProvider,
  ],
  callbacks: {
    // Single allowlist for BOTH providers — a successful Google login is still
    // rejected unless the email matches AUTH_ALLOWED_EMAIL.
    signIn({ user }) {
      return isAllowedEmail(user?.email, process.env.AUTH_ALLOWED_EMAIL);
    },
  },
});
