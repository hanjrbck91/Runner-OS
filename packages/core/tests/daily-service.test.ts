import { describe, it, expect, beforeEach } from 'vitest';
import { createServices, type RunnerServices, type UserContext } from '../src/index.js';
import { createInMemoryDependencies, type InMemoryHarness } from '../src/adapters/memory/index.js';

const ctx: UserContext = { userId: 'u1', actor: 'tester@runneros' };
const DATE = '2026-08-31';

let deps: InMemoryHarness;
let svc: RunnerServices;
beforeEach(() => { deps = createInMemoryDependencies(); svc = createServices(deps); });

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}

describe('DailyService', () => {
  it('create: stable id, immutable createdAt, server date', async () => {
    const r = await svc.daily.save(ctx, { date: DATE, fields: { weight: 76.2, sleepHours: 7 } });
    expect(r.ok).toBe(true);
    const d = r.ok ? r.data : null!;
    expect(typeof d.id).toBe('string');
    expect(d.id.length).toBeGreaterThan(0);
    expect(d.date).toBe(DATE);
    expect(d.createdAt).toBeTruthy();
    expect(d.updatedAt).toBe(d.createdAt);
    expect(d.deletedAt).toBeNull();
  });

  it('read by date', async () => {
    await svc.daily.save(ctx, { date: DATE, fields: { weight: 76.2 } });
    const d = await unwrap(svc.daily.getForDate(ctx, DATE));
    expect(d?.weight).toBe(76.2);
  });

  it('field-aware update preserves others; id/createdAt fixed; updatedAt bumps', async () => {
    const a = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76.2, sleepHours: 7 } }));
    deps.clock.advance(1000);
    const b = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76.0 } }));
    expect(b.weight).toBe(76.0);
    expect(b.sleepHours).toBe(7);        // preserved
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).not.toBe(a.createdAt);
  });

  it('clearing: empty string clears a field', async () => {
    await svc.daily.save(ctx, { date: DATE, fields: { noteText: 'hello' } });
    const cleared = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { noteText: '' } }));
    expect(cleared.noteText).toBeNull();
  });

  it('validation errors returned, not thrown', async () => {
    const r1 = await svc.daily.save(ctx, { date: DATE, fields: { weight: 'abc' } });
    const r2 = await svc.daily.save(ctx, { date: DATE, fields: { painScore: 9 } });
    expect(r1.ok).toBe(false); expect(r1.error?.code).toBe('VALIDATION');
    expect(r2.ok).toBe(false); expect(r2.error?.code).toBe('VALIDATION');
  });

  it('field-level audit: create then update two fields => 2 UPDATE entries', async () => {
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76.2, sleepHours: 7 } }));
    deps.clock.advance(1000);
    await svc.daily.save(ctx, { date: DATE, fields: { weight: 76.0, sleepHours: 6.5 } });
    const audits = await deps.audit.listByEntity('u1', 'Daily', d.id);
    const updates = audits.filter((a) => a.action === 'UPDATE').map((a) => a.fieldChanged).sort();
    expect(updates).toEqual(['sleepHours', 'weight']);
  });

  it('soft delete: row remains, deletedAt set, excluded from read; repeat is ALREADY_DELETED', async () => {
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    const del = await svc.daily.softDelete(ctx, d.id);
    expect(del.ok).toBe(true);
    expect(del.ok && del.data.deletedAt).toBeTruthy();
    expect(await unwrap(svc.daily.getForDate(ctx, DATE))).toBeNull();
    expect(deps.daily.records.find((r) => r.id === d.id)).toBeTruthy(); // still stored
    const again = await svc.daily.softDelete(ctx, d.id);
    expect(again.ok).toBe(false); expect(again.error?.code).toBe('ALREADY_DELETED');
  });

  it('auto plan snapshot on create; immutable across plan change + update', async () => {
    const v1 = await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, fields: { runPlan: '6 KM EASY' } }));
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    expect(d.planIdSnapshot).toBe(v1.id);
    expect(d.planVersionSnapshot).toBe(1);
    await svc.plans.createVersion(ctx, { planDate: DATE, effectiveFrom: '2026-09-01', fields: { runPlan: '7 KM EASY' } });
    deps.clock.advance(1000);
    const d2 = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 75.5 } }));
    expect(d2.planIdSnapshot).toBe(v1.id);        // unchanged
    expect(d2.planVersionSnapshot).toBe(1);
  });

  it('snapshot fields are immutable via update', async () => {
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    const r = await svc.daily.update(ctx, d.id, { planVersionSnapshot: 9 });
    expect(r.ok).toBe(false); expect(r.error?.code).toBe('VALIDATION');
  });

  it('IDs unique across records; timestamps monotonic', async () => {
    const ids = new Set<string>();
    for (const dt of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03']) {
      const d = await unwrap(svc.daily.save(ctx, { date: dt, fields: { weight: 70 } }));
      ids.add(d.id);
      expect(Date.parse(d.updatedAt)).toBeGreaterThanOrEqual(Date.parse(d.createdAt));
    }
    expect(ids.size).toBe(4);
  });

  it('server date used when none supplied (Asia/Kolkata today)', async () => {
    const d = await unwrap(svc.daily.save(ctx, { fields: { weight: 70 } }));
    expect(d.date).toBe('2026-08-31'); // FixedClock 06:00Z -> 11:30 IST
  });

  it('rejects blank create with NO_FIELDS (no empty active row)', async () => {
    const r = await svc.daily.save(ctx, { date: DATE, fields: {} });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NO_FIELDS');
    expect(deps.daily.records.length).toBe(0);
  });

  it('createActive race: two creates converge to one merged active row', async () => {
    const [a, b] = await Promise.all([
      svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }),
      svc.daily.save(ctx, { date: DATE, fields: { sleepHours: 7 } }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const active = deps.daily.records.filter((r) => r.date === DATE && r.deletedAt === null);
    expect(active.length).toBe(1);
    const d = await unwrap(svc.daily.getForDate(ctx, DATE));
    expect(d?.weight).toBe(76);
    expect(d?.sleepHours).toBe(7);
  });
});
