'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImportPreview, type ImportResult, type PlanOverview, type PlanWeek } from '../../../lib/api.js';
import { useResource } from '../../../lib/useApi.js';
import { fmtDate, fmtRange } from '../../../lib/format.js';
import { Loading, ErrorBanner, KV, Panel, Banner, Leds, Dm, Readout } from '../../../components/ui.js';

export default function PlanPage() {
  const loader = useCallback(() => api.planOverview(), []);
  const ov = useResource<PlanOverview>(loader, 'planOverview');
  const [importing, setImporting] = useState(false);

  return (
    <div>
      {ov.status === 'loading' ? <Loading label="RESOLVING" /> : null}
      {ov.status === 'error' ? <ErrorBanner error={ov.error} onRetry={ov.reload} /> : null}
      {ov.status === 'ready' ? <Overview d={ov.data!} /> : null}

      <Panel title="COACH PLAN IMPORT">
        <div className="muted" style={{ marginBottom: 8 }}>
          Upload a coach CSV to add a new future plan version. Existing plans and logged
          training are never changed.
        </div>
        {!importing ? (
          <button className="primary" data-action="import-plan" onClick={() => setImporting(true)}>IMPORT PLAN</button>
        ) : (
          <ImportFlow onDone={() => { setImporting(false); ov.reload(); }} onCancel={() => setImporting(false)} />
        )}
      </Panel>
    </div>
  );
}

function phaseTimeline(weeks: PlanWeek[], currentWeek: number | null): { phase: string; cur: boolean; done: boolean }[] {
  const seq: { phase: string; from: number }[] = [];
  for (const w of weeks) {
    const p = w.phase ?? '—';
    if (seq.length === 0 || seq[seq.length - 1]!.phase !== p) seq.push({ phase: p, from: w.weekNumber });
  }
  const cw = currentWeek ?? 0;
  return seq.map((s, i) => {
    const next = seq[i + 1]?.from ?? Infinity;
    return { phase: s.phase, cur: cw >= s.from && cw < next, done: cw >= next };
  });
}

function Overview({ d }: { d: PlanOverview }) {
  if (!d.hasPlan) {
    return <Panel title="PLAN"><div className="muted center">NO PLAN IMPORTED YET</div><div className="muted center" style={{ marginTop: 6, fontSize: 12 }}>Import a coach CSV below.</div></Panel>;
  }
  const phases = phaseTimeline(d.weeks, d.currentWeek);
  const started = d.currentWeek !== null;
  return (
    <div>
      <Panel title="PLAN PROGRESS">
        <div className="row" style={{ alignItems: 'stretch', marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="dim" style={{ fontSize: 10, letterSpacing: '0.16em' }}>{started ? 'CURRENT WEEK' : 'STARTS IN'}</span>
            <Readout hero value={started ? `${d.currentWeek}` : `${d.startsInDays ?? '—'}`} unit={started ? `/ ${d.totalWeeks}` : 'DAYS'} />
          </div>
          {d.daysToRace !== null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="dim" style={{ fontSize: 10, letterSpacing: '0.16em' }}>RACE IN</span>
              <Readout hero value={`${d.daysToRace}`} unit="DAYS" tone="amber" />
            </div>
          ) : null}
        </div>

        {/* 20-segment LED journey — one segment per week. */}
        <Leds filled={d.completedWeeks} total={d.totalWeeks} />
        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>{d.completedWeeks} of {d.totalWeeks} weeks done · {d.remainingWeeks} remaining</div>

        <div className="phasebar">
          {phases.map((p) => (
            <div key={p.phase} className={p.cur ? 'cur' : p.done ? 'done' : ''} title={p.phase}>{p.phase.split(/[\s/]/)[0]}</div>
          ))}
        </div>

        <KV k="PHASE" v={(d.currentPhase ?? '—').toUpperCase()} />
        <KV k="THIS WEEK KM" v={<><Dm tone="green">{d.currentWeekPlannedKm ?? '—'}</Dm> <span className="dim">KM</span></>} />
        <KV k="PLANNED KM" v={<><Dm>{d.plannedTotalKm}</Dm> <span className="dim">KM</span></>} />
        {d.completionPercentage !== null ? (
          <>
            <KV k="COMPLETED KM" v={<><Dm tone="green">{d.completedKm}</Dm> <span className="dim">KM</span></>} />
            <KV k="COMPLETION" v={<Dm>{d.completionPercentage}%</Dm>} />
          </>
        ) : null}
        {d.dateRange ? <KV k="RANGE" v={fmtRange(d.dateRange.start, d.dateRange.end)} /> : null}
      </Panel>

      <Panel title="UPCOMING">
        {d.upcoming.length === 0 ? <div className="muted">RECOVERY MODE · no upcoming sessions.</div> : d.upcoming.map((u) => (
          <div className="up" key={u.date}>
            <span className="d">{fmtDate(u.date)}{u.weekNumber ? ` · W${u.weekNumber}` : ''}</span>
            <span className="s">{u.session}{u.plannedKm !== null ? <> · <Dm tone="green">{u.plannedKm}</Dm>km</> : null}</span>
          </div>
        ))}
      </Panel>

      <Panel title="20-WEEK PLAN">
        <div className="muted" style={{ marginBottom: 8 }}>Tap a week to see its sessions.</div>
        {d.weeks.map((w) => <WeekRow key={w.weekNumber} w={w} />)}
      </Panel>
    </div>
  );
}

function WeekRow({ w }: { w: PlanWeek }) {
  const tag = w.status === 'CURRENT' ? 'NOW' : w.status === 'DONE' ? '✓' : '';
  const showActual = w.status !== 'UPCOMING' && (w.actualKm > 0 || w.completedSessions > 0);
  return (
    <details className={`wk wk-${w.status.toLowerCase()}`} open={w.status === 'CURRENT'}>
      <summary>
        <span className="wk-h">W{w.weekNumber}{tag ? ` ${tag}` : ''}</span>
        <span className="wk-ph">{w.phase ?? '—'}</span>
        <span className="wk-km">{w.plannedKm}</span>
      </summary>
      <div className="muted" style={{ margin: '4px 0 6px' }}>
        {fmtRange(w.start, w.end)} · {w.sessions} sessions
        {showActual ? <> · actual <span className="dm green" style={{ fontSize: '1em' }}>{w.actualKm}</span>km · {w.completedSessions}/{w.sessions} done</> : null}
      </div>
      {w.days.map((day) => (
        <div className="up" key={day.date}>
          <span className="d">{fmtDate(day.date)}</span>
          <span className="s">{day.session}{day.plannedKm !== null ? <> · <Dm tone="green">{day.plannedKm}</Dm>km</> : null}</span>
        </div>
      ))}
    </details>
  );
}

function ImportFlow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // Live elapsed counter while committing, so the import never looks frozen.
  useEffect(() => {
    if (!committing) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [committing]);

  // While a commit is in flight, warn before the tab is closed/refreshed. The
  // write is atomic server-side, so a refusal just means "wait"; a refresh will
  // NOT half-apply the plan — but we still discourage interrupting.
  useEffect(() => {
    if (!committing) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [committing]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setPreview(null); setResult(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const text = await f.text();
    setCsv(text);
    setBusy(true);
    const r = await api.importPreview(text);
    setBusy(false);
    if (r.ok) setPreview(r.data);
    else setErr(r.error.message);
  }

  async function confirm(mode: 'create' | 'replace') {
    if (!csv || busy) return;
    setBusy(true); setCommitting(true); setErr(null);
    const r = await api.importCommit(csv, mode);
    setBusy(false); setCommitting(false);
    if (r.ok) setResult(r.data);
    else setErr(r.error.message);
  }

  if (result) {
    return (
      <div>
        <Banner kind="ok">PLAN IMPORTED</Banner>
        {result.planLabel ? <KV k="PLAN" v={result.planLabel} /> : null}
        <KV k="VERSIONS" v={result.versionsCreated} />
        <KV k="RANGE" v={`${result.dateRange.start} → ${result.dateRange.end}`} />
        <KV k="WEEKS" v={result.weekCount} />
        <KV k="SESSIONS" v={result.sessionCount} />
        <KV k="PLANNED KM" v={`${result.totalPlannedKm} KM`} />
        <KV k="EFFECTIVE" v={result.effectiveFrom} />
        <button className="primary" style={{ marginTop: 10 }} onClick={onDone}>DONE</button>
      </div>
    );
  }

  return (
    <div>
      <label>CSV FILE</label>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />
      {fileName ? <div className="muted" style={{ marginTop: 6 }}>{fileName}</div> : null}
      {busy && !preview ? <Loading label="VALIDATING" /> : null}
      {err ? <Banner kind="err">{err}</Banner> : null}

      {preview ? (
        <div style={{ marginTop: 10 }}>
          <KV k="STATUS" v={preview.valid ? 'VALID ✓' : 'INVALID ✗'} />
          <KV k="ROWS" v={preview.rowCount} />
          <KV k="WEEKS" v={preview.weekCount} />
          {preview.dateRange ? <KV k="RANGE" v={`${preview.dateRange.start} → ${preview.dateRange.end}`} /> : null}
          <KV k="PLANNED KM" v={`${preview.totalPlannedKm} KM`} />
          {preview.planLabel ? <KV k="PLAN" v={preview.planLabel} /> : null}

          {preview.errors.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <label>ERRORS ({preview.errors.length})</label>
              <div className="errlist">
                {preview.errors.slice(0, 60).map((e, i) => (
                  <div key={i}>{e.line ? `L${e.line} ` : ''}{e.field}: {e.message}</div>
                ))}
              </div>
            </div>
          ) : null}

          <label style={{ marginTop: 10 }}>MILEAGE BY WEEK</label>
          <WeekBars weeks={preview.plannedKmByWeek} />

          <label style={{ marginTop: 10 }}>PHASES</label>
          {preview.phaseDistribution.map((p) => <KV key={p.phase} k={p.phase} v={`${p.count} d`} />)}

          <label style={{ marginTop: 10 }}>ROWS ({preview.rows.length})</label>
          <div className="scrolllist">
            {preview.rows.map((r) => (
              <div className="rowcard" key={r.date}>
                <span className="rc-d">{fmtDate(r.date)} · W{r.weekNumber}</span>
                <span className="rc-s">{r.summary}</span>
                <span className="rc-km">{r.plannedKm ?? ''}</span>
              </div>
            ))}
          </div>

          {preview.conflicts.length > 0 ? (
            <Banner kind="err">
              {preview.conflicts.length} date(s) already have a plan (e.g. {preview.conflicts.slice(0, 3).join(', ')}).
              This can happen if a previous import was interrupted. Use REPLACE to overwrite them.
            </Banner>
          ) : null}

          {committing ? (
            <div style={{ marginTop: 10 }}>
              <div className="prog"><i className="indet" /></div>
              <Banner kind="ok">IMPORTING {preview.rowCount} days… {elapsed}s — do not close or refresh this tab.</Banner>
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={onCancel} disabled={busy}>CANCEL</button>
            {preview.conflicts.length > 0 ? (
              <button className="primary" data-action="replace-import" onClick={() => confirm('replace')} disabled={busy || !preview.valid}>
                {busy ? 'IMPORTING…' : 'REPLACE & IMPORT'}
              </button>
            ) : (
              <button className="primary" data-action="confirm-import" onClick={() => confirm('create')} disabled={busy || !preview.valid}>
                {busy ? 'IMPORTING…' : 'CONFIRM IMPORT'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <button style={{ marginTop: 10 }} onClick={onCancel} disabled={busy}>CANCEL</button>
      )}
    </div>
  );
}

function WeekBars({ weeks }: { weeks: ImportPreview['plannedKmByWeek'] }) {
  const max = weeks.reduce((a, w) => Math.max(a, w.plannedKm), 0) || 1;
  return (
    <div>
      {weeks.map((w) => (
        <div className="wkbar" key={w.weekNumber}>
          <span className="lab">W{w.weekNumber} {w.phase.slice(0, 4)}</span>
          <span className="track"><i style={{ width: `${Math.round((w.plannedKm / max) * 100)}%` }} /></span>
          <span className="val">{w.plannedKm}km</span>
        </div>
      ))}
    </div>
  );
}
