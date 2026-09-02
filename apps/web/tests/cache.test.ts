import { describe, it, expect } from 'vitest';
import { resourceCache } from '../src/lib/api.js';

/** Stale-while-revalidate cache used to remove SYNCING flashes on navigation. */
describe('MC-023 — resource cache', () => {
  it('get/set/invalidate', () => {
    resourceCache.set('today', { date: '2026-08-31' });
    expect(resourceCache.get<{ date: string }>('today')).toEqual({ date: '2026-08-31' });
    resourceCache.invalidate('today');
    expect(resourceCache.get('today')).toBeUndefined();
  });

  it('a save invalidates today + weekly (freshness, no stale reads)', () => {
    resourceCache.set('today', { a: 1 });
    resourceCache.set('weekly', { b: 2 });
    resourceCache.set('plan', { c: 3 });
    resourceCache.invalidate('today', 'weekly');
    expect(resourceCache.get('today')).toBeUndefined();
    expect(resourceCache.get('weekly')).toBeUndefined();
    expect(resourceCache.get('plan')).toEqual({ c: 3 }); // plan untouched by a daily save
  });
});
