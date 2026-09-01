'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, AppError } from './api.js';

type State<T> = { status: 'loading' | 'ready' | 'error'; data?: T; error?: AppError };

/** Load a resource once; expose reload. IDLE/LOADING/READY/ERROR states. */
export function useResource<T>(loader: () => Promise<ApiEnvelope<T>>) {
  const [state, setState] = useState<State<T>>({ status: 'loading' });
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const r = await loader();
    if (r.ok) setState({ status: 'ready', data: r.data });
    else setState({ status: 'error', error: r.error });
  }, [loader]);
  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

/** Save flow with double-submit guard + IDLE/SAVING/SAVED/ERROR. */
export function useSave() {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<AppError | null>(null);
  const busy = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<ApiEnvelope<T>>): Promise<ApiEnvelope<T> | null> => {
    if (busy.current) return null;
    busy.current = true; setStatus('saving'); setError(null);
    const r = await fn();
    busy.current = false;
    if (r.ok) { setStatus('saved'); setTimeout(() => setStatus('idle'), 1200); }
    else { setStatus('error'); setError(r.error); }
    return r;
  }, []);
  return { status, error, run, saving: status === 'saving' };
}
