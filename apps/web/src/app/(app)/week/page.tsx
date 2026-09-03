'use client';
import { useCallback, useState } from 'react';
import { api } from '../../../lib/api.js';
import { show, nutritionLabel } from '../../../lib/format.js';
import { useResource } from '../../../lib/useApi.js';
import { fmtRange } from '../../../lib/format.js';
import { Loading, ErrorBanner, KV, Panel, Banner, Dm, Leds, Readout } from '../../../components/ui.js';

export default function WeekPage() {
  const loader = useCallback(() => api.weekly(), []);
  const w = useResource(loader, 'weekly');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true); setExportErr(null);
    try {
      const res = await fetch('/api/export', { cache: 'no-store' });
      if (!res.ok) { setExportErr('Export failed.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'runner-os_week.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setExportErr('Export failed.'); }
    finally { setExporting(false); }
  }

  if (w.status === 'loading') return <Loading label="CALC" />;
  if (w.status === 'error') return <ErrorBanner error={w.error} onRetry={w.reload} />;
  const d = w.data!;
  return (
    <div>
      <Panel title="WEEK">
        <div className="muted" style={{ marginBottom: 10, fontSize: 12, letterSpacing: '0.06em' }}>{fmtRange(d.weekStart, d.weekEnd)}</div>

        {/* Planned vs actual mileage — the core coaching question. */}
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="submodule" style={{ margin: 0 }}>
            <div className="sublabel" style={{ color: 'var(--tan)' }}>PLANNED KM</div>
            <Readout value={d.totalPlannedKm ?? '—'} />
          </div>
          <div className="submodule" style={{ margin: 0 }}>
            <div className="sublabel" style={{ color: 'var(--teal-hi)' }}>ACTUAL KM</div>
            <Readout value={d.totalRunningKm} tone="green" />
          </div>
        </div>
        {d.totalPlannedKm && d.totalPlannedKm > 0 ? (
          <div className="wkbar"><span className="lab">KM {Math.round((d.totalRunningKm / d.totalPlannedKm) * 100)}%</span><span className="track"><i style={{ width: `${Math.min(100, Math.round((d.totalRunningKm / d.totalPlannedKm) * 100))}%` }} /></span><span className="val">{d.totalRunningKm}</span></div>
        ) : null}

        {d.completionPercentage !== null ? (
          <>
            <label>SESSION COMPLETION</label>
            <Leds filled={Math.round((d.completionPercentage / 100) * 7)} total={7} />
            <div className="muted" style={{ fontSize: 12 }}>{d.completionPercentage}% · {d.missedSessions} missed</div>
          </>
        ) : null}

        <div style={{ marginTop: 10 }}>
          <KV k="LONGEST RUN" v={<><Dm>{d.longestRun ?? '—'}</Dm> <span className="dim">KM</span></>} />
          <KV k="RUNS" v={<Dm>{d.numberOfRuns}</Dm>} />
          <KV k="GYM" v={<Dm>{d.numberOfGymSessions}</Dm>} />
          <KV k="AVG WEIGHT" v={<><Dm>{show(d.averageWeight)}</Dm> <span className="dim">KG</span></>} />
          <KV k="WEIGHT TREND" v={<span className={d.weightTrend != null && Math.abs(d.weightTrend) > 1 ? 'amber' : ''}>{show(d.weightTrend, 'KG')}</span>} />
          <KV k="AVG SLEEP" v={<><Dm>{show(d.averageSleep)}</Dm> <span className="dim">H</span></>} />
          <KV k="AVG RPE" v={<Dm>{show(d.averageRpe)}</Dm>} />
          <KV k="PAIN FLAGS" v={d.painFlagCount > 0 ? <span className="amber">● <Dm tone="amber">{d.painFlagCount}</Dm></span> : <Dm>0</Dm>} />
          <KV k="NUTRITION" v={nutritionLabel(d.nutritionAdherence)} />
        </div>
      </Panel>
      {d.reflectionText ? <Panel title="REFLECTION"><div className="lcd">{d.reflectionText}</div></Panel> : null}
      <Panel title="COACH EXPORT">
        <div className="muted" style={{ marginBottom: 8 }}>Structured plan + actual + context for this week.</div>
        {exportErr ? <Banner kind="err">{exportErr}</Banner> : null}
        <button className="primary" data-action="export-csv" disabled={exporting} onClick={exportCsv}>
          {exporting ? 'EXPORTING…' : 'EXPORT CSV'}
        </button>
      </Panel>
    </div>
  );
}
