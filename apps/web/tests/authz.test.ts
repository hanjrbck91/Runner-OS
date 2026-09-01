import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAllowedEmail } from '../src/server/authz.js';

const authSrc = readFileSync(fileURLToPath(new URL('../src/auth.ts', import.meta.url)), 'utf8');
const signinSrc = readFileSync(fileURLToPath(new URL('../src/app/signin/page.tsx', import.meta.url)), 'utf8');

describe('MC-020 — Google OAuth + allowlist', () => {
  it('T1 Google provider configured alongside magic-link', () => {
    expect(/from ['"]next-auth\/providers\/google['"]/.test(authSrc)).toBe(true);
    expect(/Google\(\s*\{/.test(authSrc)).toBe(true);
    // magic-link (Nodemailer) provider preserved
    expect(/from ['"]next-auth\/providers\/nodemailer['"]/.test(authSrc)).toBe(true);
    expect(/emailProvider/.test(authSrc)).toBe(true);
  });

  it('T2 authorized Google identity passes the allowlist', () => {
    expect(isAllowedEmail('runner@os.local', 'runner@os.local')).toBe(true);
    expect(isAllowedEmail('Runner@OS.local', 'runner@os.local')).toBe(true); // case-insensitive
  });

  it('T3 unauthorized Google identity is rejected', () => {
    expect(isAllowedEmail('intruder@example.com', 'runner@os.local')).toBe(false);
    expect(isAllowedEmail(null, 'runner@os.local')).toBe(false);
    expect(isAllowedEmail('runner@os.local', undefined)).toBe(false);
    expect(isAllowedEmail('', '')).toBe(false);
  });

  it('T4 allowlist gates BOTH providers via the signIn callback', () => {
    expect(/signIn\(\{\s*user\s*\}\)\s*\{[\s\S]*isAllowedEmail\(user\?\.email,\s*process\.env\.AUTH_ALLOWED_EMAIL\)/.test(authSrc)).toBe(true);
  });

  it('T5 secrets stay server-side (no client id/secret in the signin client bundle source)', () => {
    expect(/GOOGLE_CLIENT_SECRET/.test(signinSrc)).toBe(false);
    expect(/GOOGLE_CLIENT_ID/.test(signinSrc)).toBe(false);
    // signin only triggers the provider by name
    expect(/signIn\(['"]google['"]/.test(signinSrc)).toBe(true);
  });

  it('T6 client secret only read from env on the server', () => {
    expect(/process\.env\.GOOGLE_CLIENT_SECRET/.test(authSrc)).toBe(true);
  });
});
