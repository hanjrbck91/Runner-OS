'use client';
import { useCallback, useState } from 'react';
import { api } from '../../../lib/api.js';
import { show, nutritionLabel } from '../../../lib/format.js';
import { useResource } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, KV, Panel, Banner } from '../../../components/ui.js';

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
        <div className="muted">{d.weekStart} → {d.weekEnd}</div>
        <KV k="AVG WEIGHT" v={show(d.averageWeight, 'KG')} />
        <KV k="WEIGHT TREND" v={show(d.weightTrend, 'KG')} />
        <KV k="TOTAL KM" v={show(d.totalRunningKm)} />
        <KV k="LONGEST" v={show(d.longestRun, 'KM')} />
        <KV k="RUNS" v={show(d.numberOfRuns)} />
        <KV k="GYM" v={show(d.numberOfGymSessions)} />
        <KV k="AVG SLEEP" v={show(d.averageSleep, 'H')} />
        <KV k="AVG RPE" v={show(d.averageRpe)} />
        <KV k="PAIN FLAGS" v={show(d.painFlagCount)} />
        <KV k="NUTRITION" v={nutritionLabel(d.nutritionAdherence)} />
        <KV k="COMPLETION" v={show(d.completionPercentage, '%')} />
        <KV k="MISSED" v={show(d.missedSessions)} />
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
