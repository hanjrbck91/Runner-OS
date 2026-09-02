'use client';
import { useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { useResource } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, KV, Panel } from '../../../components/ui.js';

export default function PlanPage() {
  const loader = useCallback(() => api.plan(), []); // today's authoritative plan (read-only)
  const p = useResource(loader, 'plan');
  if (p.status === 'loading') return <Loading label="RESOLVING" />;
  if (p.status === 'error') {
    if (p.error?.code === 'NOT_FOUND') {
      return <Panel title="PLAN"><div className="muted center">NO PLAN SCHEDULED FOR TODAY</div></Panel>;
    }
    return <ErrorBanner error={p.error} onRetry={p.reload} />;
  }
  const d = p.data!;
  return (
    <Panel title="CURRENT PLAN">
      <KV k="WEEK" v={d.weekNumber ?? '—'} />
      <KV k="PHASE" v={d.phase ?? '—'} />
      <KV k="VERSION" v={`v${d.version}`} />
      {d.runPlan && <KV k="RUN" v={d.runPlan} />}
      {d.longRunPlan && <KV k="LONG" v={d.longRunPlan} />}
      {d.qualityPlan && <KV k="QUALITY" v={d.qualityPlan} />}
      {d.gymPlan && <KV k="GYM" v={d.gymPlan} />}
      {d.recoveryPlan && <KV k="RECOVERY" v={d.recoveryPlan} />}
      {d.milestone && <KV k="MILESTONE" v={d.milestone} />}
    </Panel>
  );
}
