'use client';
import { useCallback, useState } from 'react';
import { api, type DailyView, type PlanView } from '../../../lib/api.js';
import { humanError, fmtDate } from '../../../lib/format.js';
import { useResource, useSave } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, Panel, SaveButton, Banner } from '../../../components/ui.js';

/**
 * Low-friction daily log: one scannable screen, four sections. Each section
 * saves independently (small, atomic writes). Planned (coach) is always shown
 * separately from Actual/Response; planned values are NEVER copied into inputs.
 */
export default function LogPage() {
  const loader = useCallback(() => api.today(), []);
  const t = useResource(loader, 'today');

  if (t.status === 'loading') return <Loading label="SYNCING" />;
  if (t.status === 'error') return <ErrorBanner error={t.error} onRetry={t.reload} />;
  const d = t.data!;
  const daily = d.daily;
  const plan = d.plan;

  return (
    <div>
      <Panel title="LOG TODAY">
        <div className="big">{fmtDate(d.date)}</div>
        <div className="muted">
          {d.weekNumber != null ? `WEEK ${String(d.weekNumber).padStart(2, '0')}` : 'WEEK —'}
          {d.phase ? ` · ${d.phase}` : ''}
        </div>
      </Panel>

      <BodyForm daily={daily} onSaved={t.reload} />
      <RunForm daily={daily} plan={plan} onSaved={t.reload} />
      <GymForm daily={daily} plan={plan} onSaved={t.reload} />
      <NoteForm daily={daily} onSaved={t.reload} />
    </div>
  );
}

function Tag({ kind }: { kind: 'PLANNED' | 'ACTUAL' | 'RESPONSE' }) {
  return <span className={`tag tag-${kind.toLowerCase()}`}>{kind}</span>;
}
function States({ status, error }: { status: string; error: { code: string; message: string } | null }) {
  if (status === 'saved') return <Banner kind="ok">SAVED</Banner>;
  if (status === 'error') return <Banner kind="err">{humanError(error)}</Banner>;
  return null;
}
const numOrOmit = (v: string) => (v.trim() === '' ? undefined : Number(v));

// ---- BODY / RECOVERY: weight, sleep, nutrition ----
function BodyForm({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const [weight, setWeight] = useState(daily?.weight != null ? String(daily.weight) : '');
  const [sleep, setSleep] = useState(daily?.sleepHours != null ? String(daily.sleepHours) : '');
  const [nutrition, setNutrition] = useState<'ON' | 'MOST' | 'OFF' | null>((daily?.nutritionAdherence as 'ON' | 'MOST' | 'OFF' | null) ?? null);
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: { weight?: number; sleep?: number; nutrition?: 'ON' | 'MOST' | 'OFF' } = {};
    const w = numOrOmit(weight); if (w !== undefined) body.weight = w;
    const s = numOrOmit(sleep); if (s !== undefined) body.sleep = s;
    if (nutrition !== null) body.nutrition = nutrition;
    const r = await run(() => api.saveWeight(body));
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="BODY / RECOVERY">
        <div className="row">
          <div>
            <label>WEIGHT (KG)</label>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-field="weight" />
          </div>
          <div>
            <label>SLEEP (H)</label>
            <input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} data-field="sleep" />
          </div>
        </div>
        <label>NUTRITION</label>
        <div className="seg" data-field="nutrition">
          {(['ON', 'MOST', 'OFF'] as const).map((n) => (
            <button type="button" key={n} className={nutrition === n ? 'sel' : ''} onClick={() => setNutrition(n)}>{n}</button>
          ))}
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE BODY" /></div>
      </Panel>
    </form>
  );
}

// ---- RUN: planned (coach) vs actual distance vs response (rpe/pain/location) ----
function RunForm({ daily, plan, onSaved }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void }) {
  const planned = plan?.runPlan ?? plan?.longRunPlan ?? plan?.qualityPlan ?? null;
  const [km, setKm] = useState(daily?.runActualKm != null ? String(daily.runActualKm) : '');
  const [rpe, setRpe] = useState(daily?.runRpe != null ? String(daily.runRpe) : '');
  const [pain, setPain] = useState<number | null>(daily?.painScore ?? null);
  const [painLoc, setPainLoc] = useState(daily?.painLocation ?? '');
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: { km?: number; rpe?: number; pain?: number; painLocation?: string | null } = {};
    const k = numOrOmit(km); if (k !== undefined) body.km = k;
    const r2 = numOrOmit(rpe); if (r2 !== undefined) body.rpe = r2;
    if (pain !== null) {
      body.pain = pain;
      // Pain location only matters when there is pain; clear it otherwise.
      body.painLocation = pain > 0 ? (painLoc.trim() === '' ? null : painLoc) : null;
    }
    const r = await run(() => api.saveRun(body));
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="RUN">
        <div className="tagrow"><Tag kind="PLANNED" /><span className="muted">coach</span></div>
        <div className="big">{planned ?? 'No run planned'}</div>

        <div className="tagrow" style={{ marginTop: 10 }}><Tag kind="ACTUAL" /></div>
        <label>ACTUAL KM</label>
        <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} data-field="km" />

        <div className="tagrow" style={{ marginTop: 10 }}><Tag kind="RESPONSE" /></div>
        <label>RPE (1-10)</label>
        <input inputMode="numeric" value={rpe} onChange={(e) => setRpe(e.target.value)} data-field="rpe" />
        <label>PAIN (0-3)</label>
        <div className="seg" data-field="pain">
          {[0, 1, 2, 3].map((p) => (
            <button type="button" key={p} className={pain === p ? 'sel' : ''} onClick={() => setPain(p)}>{p}</button>
          ))}
        </div>
        {pain !== null && pain > 0 ? (
          <>
            <label>PAIN LOCATION</label>
            <input value={painLoc} onChange={(e) => setPainLoc(e.target.value)} data-field="painLocation" placeholder="e.g. left knee" />
          </>
        ) : null}
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE RUN" /></div>
      </Panel>
    </form>
  );
}

// ---- GYM: planned (coach) vs completed YES/NO ----
function GymForm({ daily, plan, onSaved }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void }) {
  const planned = plan?.gymPlan ?? null;
  const [done, setDone] = useState<boolean | null>(daily?.gymDone ?? null);
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (done === null) return;
    const r = await run(() => api.saveGym({ completed: done }));
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="GYM">
        <div className="tagrow"><Tag kind="PLANNED" /><span className="muted">coach</span></div>
        <div className="big">{planned ?? 'No gym planned'}</div>
        <div className="tagrow" style={{ marginTop: 10 }}><Tag kind="ACTUAL" /></div>
        <label>COMPLETED?</label>
        <div className="toggle" data-field="gym">
          <button type="button" className={done === true ? 'sel' : ''} onClick={() => setDone(true)}>YES</button>
          <button type="button" className={done === false ? 'sel' : ''} onClick={() => setDone(false)}>NO</button>
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE GYM" /></div>
      </Panel>
    </form>
  );
}

// ---- NOTE / CONTEXT: single free-text; locked read-only after save, editable on demand ----
function NoteForm({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const saved = daily?.noteText ?? '';
  const [note, setNote] = useState(saved);
  const [editing, setEditing] = useState(saved.trim() === ''); // locked when a note already exists
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api.saveNote({ note })); // '' clears
    if (r?.ok) { setEditing(false); onSaved(); }
  }

  if (!editing) {
    return (
      <Panel title="NOTE / CONTEXT">
        {note.trim() === '' ? (
          <div className="muted">No note yet.</div>
        ) : (
          <div className="lcd locked" data-field="note-locked">{note}</div>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" data-action="edit-note" onClick={() => setEditing(true)}>EDIT NOTE</button>
        </div>
      </Panel>
    );
  }

  return (
    <form onSubmit={submit}>
      <Panel title="NOTE / CONTEXT">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Quick reflection…" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE NOTE" /></div>
      </Panel>
    </form>
  );
}
