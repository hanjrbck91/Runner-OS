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

/** Dot-matrix numeric display value. */
export function Dm({ children, tone }: { children: ReactNode; tone?: 'amber' | 'green' }) {
  return <span className={`dm${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

/** Segmented LED progress bar (hardware LED feel). */
export function Leds({ filled, total, amber }: { filled: number; total: number; amber?: boolean }) {
  const n = Math.max(0, Math.min(total, Math.round(filled)));
  return (
    <div className="leds" role="img" aria-label={`${n} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < n ? `on${amber ? ' amber' : ''}` : ''} />
      ))}
    </div>
  );
}

/** Battery-style 1..max indicator with numeric readout (readiness/stress/…). */
export function Battery({ value, max = 10, amber = false }: { value: number | null; max?: number; amber?: boolean }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="batt" role="img" aria-label={`${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? `on${amber ? ' amber' : ''}` : ''} />
      ))}
      <span className="bval">{value}</span>
    </span>
  );
}

/** Save button reflecting saving/saved state; disabled while saving. */
export function SaveButton({ status, label = 'SAVE' }: { status: 'idle' | 'saving' | 'saved' | 'error'; label?: string }) {
  const text = status === 'saving' ? 'SAVING…' : status === 'saved' ? 'SAVED ✓' : label;
  return <button type="submit" className="primary" disabled={status === 'saving'} data-status={status}>{text}</button>;
}
