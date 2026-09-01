'use client';
import type { ReactNode } from 'react';
import { humanError } from '../lib/format.js';
import type { AppError } from '../lib/api.js';

export function Loading({ label = 'LOADING' }: { label?: string }) {
  return <div className="loading">{label}…</div>;
}

export function Banner({ kind, children }: { kind: 'ok' | 'err'; children: ReactNode }) {
  return <div className={`msg ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>;
}

export function ErrorBanner({ error, onRetry }: { error?: AppError | null; onRetry?: () => void }) {
  return (
    <div>
      <Banner kind="err">{humanError(error ?? null)}</Banner>
      {onRetry ? <button className="primary" onClick={onRetry}>RETRY</button> : null}
    </div>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="kv"><span className="k">{k}</span><span className="v">{v}</span></div>;
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return <div className="panel">{title ? <h1>{title}</h1> : null}{children}</div>;
}

/** Save button reflecting saving/saved state; disabled while saving. */
export function SaveButton({ status, label = 'SAVE' }: { status: 'idle' | 'saving' | 'saved' | 'error'; label?: string }) {
  const text = status === 'saving' ? 'SAVING…' : status === 'saved' ? 'SAVED ✓' : label;
  return <button type="submit" className="primary" disabled={status === 'saving'} data-status={status}>{text}</button>;
}
