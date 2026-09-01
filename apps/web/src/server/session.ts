/**
 * Authentication/authorization resolution. Framework-free: takes a plain
 * session shape (email) resolved upstream by Auth.js and returns an
 * authoritative UserContext or an HTTP error.
 *
 * The userId is ALWAYS resolved server-side from the authenticated email via a
 * user directory — never accepted from the client.
 */
import type { UserContext } from '@runner-os/core';
import { unauthenticated, forbidden, type ApiResult } from './http.js';

export interface SessionInfo {
  readonly email: string;
}

export interface AuthEnv {
  /** The single V1 allowed email (from env, never hardcoded). */
  readonly allowedEmail: string;
  /** Resolve an authenticated email to its stable userId (creates on first use). */
  readonly getUserId: (email: string) => Promise<string>;
}

export type AuthOutcome =
  | { readonly ok: true; readonly ctx: UserContext }
  | { readonly ok: false; readonly response: ApiResult };

export async function authenticate(env: AuthEnv, session: SessionInfo | null): Promise<AuthOutcome> {
  if (!session || !session.email) return { ok: false, response: unauthenticated() };
  if (session.email !== env.allowedEmail) return { ok: false, response: forbidden() };
  const userId = await env.getUserId(session.email);
  return { ok: true, ctx: { userId, actor: session.email } };
}
