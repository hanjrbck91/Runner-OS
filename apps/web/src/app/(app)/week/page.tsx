'use client';
import { useCallback, useState } from 'react';
import { api } from '../../../lib/api.js';
import { show, nutritionLabel } from '../../../lib/format.js';
import { useResource } from '../../../lib/useApi.js';
import { fmtRange } from '../../../lib/format.js';
import { Loading, ErrorBanner, KV, Panel, Banner, Dm, Leds } from '../../../components/ui.js';

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
        <div className="muted" style={{ marginBottom: 8 }}>{fmtRange(d.weekStart, d.weekEnd)}</div>

        {/* Planned vs actual KM — the core coaching question. */}
        <div className="tagrow"><span className="tag tag-planned">PLANNED</span><Dm>{d.totalPlannedKm ?? '—'}</Dm><span className="muted">km</span>
          <span className="tag tag-actual" style={{ marginLeft: 8 }}>ACTUAL</span><Dm tone="green">{d.totalRunningKm}</Dm><span className="muted">km</span></div>
        {d.totalPlannedKm && d.totalPlannedKm > 0 ? (
          <div className="wkbar"><span className="lab">KM</span><span className="track"><i style={{ width: `${Math.min(100, Math.round((d.totalRunningKm / d.totalPlannedKm) * 100))}%` }} /></span><span className="val">{Math.round((d.totalRunningKm / d.totalPlannedKm) * 100)}%</span></div>
        ) : null}

        {d.completionPercentage !== null ? (
          <>
            <label>COMPLETION</label>
            <Leds filled={Math.round((d.completionPercentage / 100) * 7)} total={7} />
            <div className="muted">{d.completionPercentage}% · {d.missedSessions} missed</div>
          </>
        ) : null}

        <div style={{ marginTop: 8 }}>
          <KV k="LONGEST" v={<Dm>{d.longestRun ?? '—'}</Dm>} />
          <KV k="RUNS" v={<Dm>{d.numberOfRuns}</Dm>} />
          <KV k="GYM" v={<Dm>{d.numberOfGymSessions}</Dm>} />
          <KV k="AVG WEIGHT" v={<Dm>{show(d.averageWeight)}</Dm>} />
          <KV k="WEIGHT TREND" v={show(d.weightTrend, 'KG')} />
          <KV k="AVG SLEEP" v={<Dm>{show(d.averageSleep)}</Dm>} />
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
