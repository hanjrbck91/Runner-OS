'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ImportPreview, type ImportResult, type PlanOverview } from '../../../lib/api.js';
import { useResource } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, KV, Panel, Banner } from '../../../components/ui.js';

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

function Overview({ d }: { d: PlanOverview }) {
  if (!d.hasPlan) {
    return <Panel title="PLAN"><div className="muted center">NO PLAN IMPORTED YET</div></Panel>;
  }
  const cw = d.currentWeek ?? 0;
  const pct = d.totalWeeks > 0 ? Math.min(100, Math.round((d.completedWeeks / d.totalWeeks) * 100)) : 0;
  return (
    <div>
      <Panel title="PLAN PROGRESS">
        <div className="big">{d.currentWeek !== null ? `WEEK ${cw} / ${d.totalWeeks}` : `STARTS IN ${d.startsInDays ?? '—'}D`}</div>
        <div className="prog"><i style={{ width: `${pct}%` }} /></div>
        <KV k="PHASE" v={d.currentPhase ?? '—'} />
        <KV k="THIS WEEK KM" v={d.currentWeekPlannedKm !== null ? `${d.currentWeekPlannedKm} KM` : '—'} />
        <KV k="COMPLETED" v={`${d.completedWeeks} WK`} />
        <KV k="REMAINING" v={`${d.remainingWeeks} WK`} />
        {d.dateRange ? <KV k="RANGE" v={`${d.dateRange.start} → ${d.dateRange.end}`} /> : null}
      </Panel>
      <Panel title="UPCOMING">
        {d.upcoming.length === 0 ? <div className="muted">No upcoming sessions.</div> : d.upcoming.map((u) => (
          <div className="up" key={u.date}>
            <span className="d">{u.date}{u.weekNumber ? ` · W${u.weekNumber}` : ''}</span>
            <span className="s">{u.session}{u.plannedKm !== null ? ` (${u.plannedKm}km)` : ''}</span>
          </div>
        ))}
      </Panel>
    </div>
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

          <label style={{ marginTop: 10 }}>ROWS</label>
          <div className="tblwrap">
            <table className="itbl">
              <thead><tr><th>DATE</th><th>WK</th><th>PHASE</th><th>SESSION</th><th>KM</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td><td className="num">{r.weekNumber}</td><td>{r.phase}</td>
                    <td>{r.summary}</td><td className="num">{r.plannedKm ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
