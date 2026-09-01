import { describe, it, expect, beforeEach } from 'vitest';
import { createServices, type RunnerServices, type UserContext, type PlanVersion } from '../src/index.js';
import { createInMemoryDependencies, type InMemoryHarness } from '../src/adapters/memory/index.js';

const ctx: UserContext = { userId: 'u1', actor: 'tester@runneros' };
let deps: InMemoryHarness;
let svc: RunnerServices;
beforeEach(() => { deps = createInMemoryDependencies(); svc = createServices(deps); });

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}

describe('PlanService', () => {
  it('create first version: v1, active, id, createdAt', async () => {
    const v = await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-15', fields: { runPlan: '8 KM TEMPO', weekNumber: 5, mileageTarget: 40 } }));
    expect(v.version).toBe(1);
    expect(v.isActive).toBe(true);
    expect(v.createdAt).toBeTruthy();
  });

  it('second version increments, preserves v1, becomes authoritative', async () => {
    const v1 = await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-01', fields: { runPlan: '8 KM TEMPO' } }));
    const v2 = await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-15', fields: { runPlan: '7 KM EASY' } }));
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    const versions = await unwrap(svc.plans.getVersionsForDate(ctx, '2026-09-15'));
    expect(versions.length).toBe(2);
    const stored1 = versions.find((x) => x.version === 1)!;
    expect(stored1.isActive).toBe(false);
    expect(stored1.effectiveTo).toBe('2026-09-14');
    const resolved = await unwrap(svc.plans.getForDate(ctx, '2026-09-15'));
    expect(resolved.id).toBe(v2.id);
    expect(resolved.runPlan).toBe('7 KM EASY');
  });

  it('overlap rejected: new effectiveFrom must be after current active', async () => {
    await svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-10', fields: { runPlan: 'A' } });
    const r = await svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-05', fields: { runPlan: 'B' } });
    expect(r.ok).toBe(false); expect(r.error?.code).toBe('PLAN_OVERLAP');
  });

  it('invalid effective period rejected', async () => {
    const r = await svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-20', effectiveTo: '2026-09-10', fields: {} });
    expect(r.ok).toBe(false); expect(r.error?.code).toBe('INVALID_EFFECTIVE_PERIOD');
  });

  it('missing plan -> NOT_FOUND; ambiguous -> PLAN_AMBIGUOUS', async () => {
    expect((await svc.plans.getForDate(ctx, '2026-12-25')).error?.code).toBe('NOT_FOUND');
    // inject a corrupt double-active state directly into the repo
    const base = (over: Partial<PlanVersion>): PlanVersion => ({
      id: 'x', userId: 'u1', planDate: '2026-09-15', version: 1, phase: null, runPlan: 'x', longRunPlan: null,
      qualityPlan: null, gymPlan: null, recoveryPlan: null, mileageTarget: null, bodyCompositionTarget: null,
      milestone: null, weekNumber: null, effectiveFrom: '2026-09-01', effectiveTo: null, isActive: true,
      createdAt: '2026-08-31T06:00:00Z', updatedAt: '2026-08-31T06:00:00Z', ...over,
    });
    deps.plans.records.push(base({ id: 'a', version: 1 }), base({ id: 'b', version: 2 }));
    expect((await svc.plans.getForDate(ctx, '2026-09-15')).error?.code).toBe('PLAN_AMBIGUOUS');
  });

  it('plan mutation audit: create + close entries', async () => {
    const v1 = await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-01', fields: { runPlan: 'A' } }));
    await svc.plans.createVersion(ctx, { planDate: '2026-09-15', effectiveFrom: '2026-09-15', fields: { runPlan: 'B' } });
    const closeAudits = deps.audit.records.filter((a) => a.action === 'CLOSE_PLAN_VERSION' && a.entityId === v1.id);
    const createAudits = deps.audit.records.filter((a) => a.action === 'CREATE_PLAN_VERSION');
    expect(closeAudits.length).toBeGreaterThanOrEqual(1);
    expect(createAudits.length).toBeGreaterThanOrEqual(2);
  });
});
