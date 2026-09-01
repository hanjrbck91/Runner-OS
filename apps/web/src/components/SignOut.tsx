'use client';
import { signOut } from 'next-auth/react';

export function SignOut() {
  return (
    <button style={{ width: 'auto', padding: '4px 10px', fontSize: 12 }} onClick={() => signOut({ redirectTo: '/signin' })}>
      SIGN OUT
    </button>
  );
}
