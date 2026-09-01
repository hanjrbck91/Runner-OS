'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSent(true); // optimistic: the request has been made; link delivery is async
    try {
      await signIn('nodemailer', { email, redirect: false, redirectTo: '/today' });
    } catch {
      /* delivery/config errors don't change the "check your email" guidance */
    }
    setBusy(false);
  }

  return (
    <div className="app">
      <div className="bar"><span className="brand">RUNNER·OS</span></div>
      <div className="screen">
        <div className="panel">
          <h1>SIGN IN</h1>
          {sent ? (
            <div className="msg ok">CHECK YOUR EMAIL for a one-time sign-in link.</div>
          ) : (
            <form onSubmit={submit}>
              <label>EMAIL</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-field="email" />
              <div style={{ marginTop: 12 }}>
                <button className="primary" type="submit" disabled={busy}>{busy ? 'SENDING…' : 'SEND MAGIC LINK'}</button>
              </div>
            </form>
          )}
        </div>
        <div className="muted center">Single-user access · allowlisted email only.</div>
      </div>
    </div>
  );
}
