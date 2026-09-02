'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resourceCache, type ApiEnvelope, type AppError } from './api.js';

type State<T> = { status: 'loading' | 'ready' | 'error'; data?: T; error?: AppError };

/**
 * Load a resource; expose reload. When `cacheKey` is given, seeds from the
 * session cache so navigation renders instantly and revalidates silently in the
 * background (no SYNCING flash on repeat visits). First load / no-cache still
 * shows a genuine loading state, and loading always terminates.
 */
export function useResource<T>(loader: () => Promise<ApiEnvelope<T>>, cacheKey?: string) {
  const seed = cacheKey ? resourceCache.get<T>(cacheKey) : undefined;
  const [state, setState] = useState<State<T>>(seed !== undefined ? { status: 'ready', data: seed } : { status: 'loading' });
  const load = useCallback(async () => {
    const had = cacheKey ? resourceCache.get<T>(cacheKey) !== undefined : false;
    if (!had) setState({ status: 'loading' });   // only block UI when nothing to show
    const r = await loader();
    if (r.ok) setState({ status: 'ready', data: r.data });
    else if (!had) setState({ status: 'error', error: r.error }); // keep cached data on revalidate error
  }, [loader, cacheKey]);
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
