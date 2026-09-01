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

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: DrizzleAdapter(getAuthDb(), authSchema),
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET,
  pages: { signIn: '/signin' },
  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],
  callbacks: {
    signIn({ user }) {
      return !!user?.email && user.email === process.env.AUTH_ALLOWED_EMAIL;
    },
  },
});
