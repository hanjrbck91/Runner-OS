'use client';
import { useCallback } from 'react';
import Link from 'next/link';
import { api, type PlanView, type DailyView } from '../../../lib/api.js';
import { show } from '../../../lib/format.js';
import { useResource } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, KV, Panel } from '../../../components/ui.js';

function PlanLine({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return <KV k={k} v={v} />;
}

function Logged({ daily }: { daily: DailyView | null }) {
  if (!daily) return <div className="muted">Nothing logged yet.</div>;
  return (
    <>
      {daily.weight != null && <KV k="WEIGHT" v={show(daily.weight, 'KG')} />}
      {daily.sleepHours != null && <KV k="SLEEP" v={show(daily.sleepHours, 'H')} />}
      {daily.runActualKm != null && <KV k="RUN" v={`${daily.runActualKm} KM${daily.runRpe != null ? ` · RPE ${daily.runRpe}` : ''}`} />}
      {daily.painScore != null && <KV k="PAIN" v={String(daily.painScore)} />}
      {daily.gymDone != null && <KV k="GYM" v={daily.gymDone ? '✓' : '—'} />}
      {daily.noteText ? <KV k="NOTE" v={daily.noteText} /> : null}
      {daily.weight == null && daily.runActualKm == null && daily.gymDone == null && !daily.noteText ? (
        <div className="muted">Nothing logged yet.</div>
      ) : null}
    </>
  );
}

export default function TodayPage() {
  const loader = useCallback(() => api.today(), []);
  const t = useResource(loader, 'today');

  if (t.status === 'loading') return <Loading label="SYNCING" />;
  if (t.status === 'error') return <ErrorBanner error={t.error} onRetry={t.reload} />;
  const d = t.data!;

  return (
    <div>
      <Panel title="TODAY">
        <div className="big">{d.dateLabel}</div>
        <div className="muted">
          {d.weekNumber != null ? `WEEK ${String(d.weekNumber).padStart(2, '0')}` : 'WEEK —'}
          {d.phase ? ` · ${d.phase}` : ''}
        </div>
      </Panel>

      <Panel title="TODAY'S PLAN">
        {d.planStatus === 'FOUND' && d.plan ? (
          <>
            <PlanLine k="RUN" v={d.plan.runPlan} />
            <PlanLine k="LONG" v={d.plan.longRunPlan} />
            <PlanLine k="QUALITY" v={d.plan.qualityPlan} />
            <PlanLine k="GYM" v={d.plan.gymPlan} />
            <PlanLine k="RECOVERY" v={d.plan.recoveryPlan} />
            <PlanLine k="MILESTONE" v={d.plan.milestone} />
          </>
        ) : d.planStatus === 'NONE' ? (
          <div className="muted center">NO PLAN SCHEDULED</div>
        ) : (
          <div className="msg err">PLAN CONFLICT — multiple active plans for today.</div>
        )}
      </Panel>

      <Panel title="LOGGED"><Logged daily={d.daily} /></Panel>

      <Link href="/log"><button className="primary">LOG TODAY →</button></Link>
    </div>
  );
}

export type { PlanView };
