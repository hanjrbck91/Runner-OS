'use client';
import { useCallback, useState } from 'react';
import { api, type DailyView } from '../../../lib/api.js';
import { humanError } from '../../../lib/format.js';
import { useResource, useSave } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, Panel, SaveButton, Banner } from '../../../components/ui.js';

type Tab = 'weight' | 'run' | 'gym' | 'note';
const TABS: Tab[] = ['weight', 'run', 'gym', 'note'];

export default function LogPage() {
  const loader = useCallback(() => api.today(), []);
  const t = useResource(loader);
  const [tab, setTab] = useState<Tab>('weight');

  if (t.status === 'loading') return <Loading label="SYNCING" />;
  if (t.status === 'error') return <ErrorBanner error={t.error} onRetry={t.reload} />;
  const daily = t.data!.daily;
  const planRun = t.data!.plan?.runPlan ?? t.data!.plan?.longRunPlan ?? t.data!.plan?.qualityPlan ?? '—';
  const planGym = t.data!.plan?.gymPlan ?? '—';

  return (
    <div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x} className={x === tab ? 'sel' : ''} role="tab" aria-selected={x === tab} data-tab={x} onClick={() => setTab(x)}>
            {x.toUpperCase()}
          </button>
        ))}
      </div>
      {tab === 'weight' && <WeightForm daily={daily} onSaved={t.reload} />}
      {tab === 'run' && <RunForm daily={daily} plan={planRun} onSaved={t.reload} />}
      {tab === 'gym' && <GymForm daily={daily} plan={planGym} onSaved={t.reload} />}
      {tab === 'note' && <NoteForm daily={daily} onSaved={t.reload} />}
    </div>
  );
}

function States({ status, error }: { status: string; error: { code: string; message: string } | null }) {
  if (status === 'saved') return <Banner kind="ok">SAVED</Banner>;
  if (status === 'error') return <Banner kind="err">{humanError(error)}</Banner>;
  return null;
}
const numOrOmit = (v: string) => (v.trim() === '' ? undefined : Number(v));

function WeightForm({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const [weight, setWeight] = useState(daily?.weight != null ? String(daily.weight) : '');
  const [sleep, setSleep] = useState(daily?.sleepHours != null ? String(daily.sleepHours) : '');
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: { weight?: number; sleep?: number } = {};
    const w = numOrOmit(weight); if (w !== undefined) body.weight = w;
    const s = numOrOmit(sleep); if (s !== undefined) body.sleep = s;
    const r = await run(() => api.saveWeight(body));
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="WEIGHT">
        <label>WEIGHT (KG)</label>
        <input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-field="weight" />
        <label>SLEEP (H)</label>
        <input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} data-field="sleep" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} /></div>
      </Panel>
    </form>
  );
}

function RunForm({ daily, plan, onSaved }: { daily: DailyView | null; plan: string; onSaved: () => void }) {
  const [km, setKm] = useState(daily?.runActualKm != null ? String(daily.runActualKm) : '');
  const [rpe, setRpe] = useState(daily?.runRpe != null ? String(daily.runRpe) : '');
  const [pain, setPain] = useState<number | null>(daily?.painScore ?? null);
  const [note, setNote] = useState(daily?.noteText ?? '');
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: { km?: number; rpe?: number; pain?: number; note?: string } = {};
    const k = numOrOmit(km); if (k !== undefined) body.km = k;
    const r2 = numOrOmit(rpe); if (r2 !== undefined) body.rpe = r2;
    if (pain !== null) body.pain = pain;
    if (note.trim() !== '') body.note = note;
    const r = await run(() => api.saveRun(body));
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="RUN">
        <div className="muted">TODAY&apos;S PLAN</div>
        <div className="big">{plan}</div>
      </Panel>
      <Panel>
        <label>ACTUAL KM</label>
        <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} data-field="km" />
        <label>RPE (1-10)</label>
        <input inputMode="numeric" value={rpe} onChange={(e) => setRpe(e.target.value)} data-field="rpe" />
        <label>PAIN (0-3)</label>
        <div className="seg" data-field="pain">
          {[0, 1, 2, 3].map((p) => (
            <button type="button" key={p} className={pain === p ? 'sel' : ''} onClick={() => setPain(p)}>{p}</button>
          ))}
        </div>
        <label>NOTE</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} /></div>
      </Panel>
    </form>
  );
}

function GymForm({ daily, plan, onSaved }: { daily: DailyView | null; plan: string; onSaved: () => void }) {
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
        <div className="big">{plan}</div>
        <label>COMPLETED?</label>
        <div className="toggle" data-field="gym">
          <button type="button" className={done === true ? 'sel' : ''} onClick={() => setDone(true)}>YES</button>
          <button type="button" className={done === false ? 'sel' : ''} onClick={() => setDone(false)}>NO</button>
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} /></div>
      </Panel>
    </form>
  );
}

function NoteForm({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const [note, setNote] = useState(daily?.noteText ?? '');
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api.saveNote({ note })); // '' clears
    if (r?.ok) onSaved();
  }
  return (
    <form onSubmit={submit}>
      <Panel title="NOTE">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Quick reflection…" />
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled title="Coming soon">🎙 AUDIO (SOON)</button>
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} /></div>
      </Panel>
    </form>
  );
}
