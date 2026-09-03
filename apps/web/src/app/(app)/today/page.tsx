'use client';
import { useCallback } from 'react';
import Link from 'next/link';
import { api, type PlanView, type DailyView } from '../../../lib/api.js';
import { show } from '../../../lib/format.js';
import { useResource } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, KV, Panel, Battery, Dm, Lamps } from '../../../components/ui.js';

function PlanLine({ k, v }: { k: string; v: string | null }) {
  if (!v) return null;
  return (
    <div className="up">
      <span className="d">{k}</span>
      <span className="s sess">{v}</span>
    </div>
  );
}

function Logged({ daily }: { daily: DailyView | null }) {
  const empty = !daily || (daily.weight == null && daily.sleepHours == null && daily.runActualKm == null
    && daily.gymDone == null && daily.painScore == null && !daily.noteText && !daily.nutritionAdherence
    && daily.readiness == null && daily.stress == null && daily.motivation == null && daily.sleepQuality == null);
  if (empty) return <div className="muted">Nothing logged yet.</div>;
  const d = daily!;
  const hasActual = d.runActualKm != null || d.gymDone != null;
  const hasResponse = d.runRpe != null || d.painScore != null || d.weight != null || d.sleepHours != null
    || d.sleepQuality != null || d.readiness != null || d.stress != null || d.motivation != null
    || !!d.nutritionAdherence || !!d.noteText;
  return (
    <>
      {hasActual ? (
        <>
          <div className="tagrow"><span className="tag tag-actual">ACTUAL</span></div>
          {d.runActualKm != null && <KV k="RUN" v={<>{d.runType ? `${d.runType} · ` : ''}<Dm>{d.runActualKm}</Dm> KM</>} />}
          {d.gymDone != null && <KV k="GYM" v={d.gymDone ? `DONE${d.gymType ? ` · ${d.gymType}` : ''}` : 'SKIPPED'} />}
        </>
      ) : null}
      {hasResponse ? (
        <>
          <div className="tagrow" style={{ marginTop: 8 }}><span className="tag tag-response">RESPONSE</span></div>
          {d.runRpe != null && <KV k="RPE" v={<Dm>{d.runRpe}</Dm>} />}
          {d.painScore != null && <KV k="PAIN" v={d.painScore > 0 ? <span className="amber">● <Dm tone="amber">{d.painScore}</Dm>{d.painLocation ? ` · ${d.painLocation}` : ''}{d.painTiming ? ` · ${d.painTiming}` : ''}</span> : <Dm>0</Dm>} />}
          {d.weight != null && <KV k="WEIGHT" v={<><Dm>{show(d.weight)}</Dm> <span className="dim">KG</span></>} />}
          {d.sleepHours != null && <KV k="SLEEP" v={<><Dm>{show(d.sleepHours)}</Dm> <span className="dim">H</span></>} />}
          {d.sleepQuality != null && <KV k="SLEEP Q" v={<Battery value={d.sleepQuality} max={5} />} />}
          {d.readiness != null && <KV k="READINESS" v={<Battery value={d.readiness} />} />}
          {d.stress != null && <KV k="STRESS" v={<Battery value={d.stress} amber={d.stress > 7} />} />}
          {d.motivation != null && <KV k="MOTIVATION" v={<Battery value={d.motivation} />} />}
          {d.nutritionAdherence ? <KV k="NUTRITION" v={d.nutritionAdherence} /> : null}
          {d.noteText ? <KV k="NOTE" v={<span className="lcd" style={{ textTransform: 'none' }}>{d.noteText}</span>} /> : null}
        </>
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
  const dl = d.daily;
  const painWarn = dl?.painScore != null && dl.painScore > 0;

  const lamps: Array<{ label: string; state: 'on' | 'off' | 'warn' }> = [
    { label: 'RUN', state: !dl ? 'off' : painWarn && (dl.runActualKm != null || dl.runType != null || dl.runRpe != null) ? 'warn' : (dl.runActualKm != null || dl.runType != null || dl.runRpe != null || dl.painScore != null) ? 'on' : 'off' },
    { label: 'GYM', state: dl?.gymDone != null ? 'on' : 'off' },
    { label: 'STATE', state: !dl ? 'off' : (dl.weight != null || dl.sleepHours != null || dl.readiness != null || dl.stress != null || dl.motivation != null || dl.sleepQuality != null) ? (dl.stress != null && dl.stress > 7 ? 'warn' : 'on') : 'off' },
    { label: 'NOTE', state: dl?.noteText ? 'on' : 'off' },
  ];

  return (
    <div>
      <Panel title="TODAY">
        <div className="big">{d.dateLabel}</div>
        <div className="muted" style={{ letterSpacing: '0.06em' }}>
          {d.weekNumber != null ? `WEEK ${String(d.weekNumber).padStart(2, '0')} / 20` : 'WEEK —'}
          {d.phase ? ` · ${d.phase.toUpperCase()}` : ''}
        </div>
        <Lamps items={lamps} />
      </Panel>

      <Panel title="TODAY'S PLAN">
        <div className="tagrow"><span className="tag tag-planned">PLANNED</span><span className="muted">coach · read-only</span></div>
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
          <div className="muted center" style={{ padding: '6px 0' }}>NO PLAN SCHEDULED · REST OR LOG UNPLANNED</div>
        ) : (
          <div className="msg err">PLAN CONFLICT — multiple active plans for today.</div>
        )}
      </Panel>

      <div className={`panel${painWarn ? ' attention' : ''}`}>
        <h1>LOGGED</h1>
        <Logged daily={dl} />
      </div>

      <Link href="/log"><button className="primary">LOG TODAY →</button></Link>
    </div>
  );
}

export type { PlanView };
