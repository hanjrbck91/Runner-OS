'use client';
import { useCallback, useState } from 'react';
import { api, type DailyView, type PlanView, type TodayView } from '../../../lib/api.js';
import { humanError, fmtDate } from '../../../lib/format.js';
import { useResource, useSave } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, Panel, SaveButton, Banner } from '../../../components/ui.js';

/**
 * Log = a single focused logging console with four modes: RUN / GYM / STATE /
 * NOTE. The mode tabs stay sticky while scrolling. Only the selected logger is
 * shown. Planned (coach) is read-only context — never copied into actual inputs.
 * Each logger saves only its own fields (isolation preserved). Backend fields
 * and behavior are unchanged.
 */
type Tab = 'run' | 'gym' | 'state' | 'note';

const RPE_LABELS: Record<number, string> = {
  1: 'Extremely easy', 2: 'Very easy', 3: 'Easy', 4: 'Comfortable', 5: 'Moderate',
  6: 'Somewhat hard', 7: 'Hard', 8: 'Very hard', 9: 'Extremely hard', 10: 'Maximum effort',
};
const PAIN_LABELS: Record<number, string> = { 0: 'No pain', 1: 'Noticeable', 2: 'Needs attention', 3: 'Stop / do not proceed' };
const PAIN_LOCATIONS = ['Calf', 'Achilles / tendon', 'Foot', 'Ankle', 'Shin', 'Knee', 'Quad', 'Hamstring', 'Hip', 'Glute', 'Other'];
const PAIN_TIMINGS = ['Before run', 'During run', 'After run', 'Next morning'];
const RUN_TYPES = ['Easy', 'Recovery', 'Long', 'Workout', 'Race', 'Walk/run', 'Other'];
const GYM_TYPES = ['Strength', 'Lower body', 'Upper body', 'Full body', 'Mobility', 'Rehab / prehab', 'Other'];

function loggedFlags(d: DailyView | null) {
  return {
    run: !!d && (d.runActualKm != null || d.runType != null || d.runRpe != null || d.painScore != null),
    gym: !!d && d.gymDone != null,
    state: !!d && (d.weight != null || d.sleepHours != null || d.readiness != null || d.stress != null || d.motivation != null || d.sleepQuality != null),
    note: !!d && !!d.noteText,
  };
}

export default function LogPage() {
  const loader = useCallback(() => api.today(), []);
  const t = useResource(loader, 'today');
  const [tab, setTab] = useState<Tab>('run');

  if (t.status === 'loading') return <Loading label="SYNCING" />;
  if (t.status === 'error') return <ErrorBanner error={t.error} onRetry={t.reload} />;
  const d = t.data!;
  const onSaved = () => { t.reload(); };
  const flags = loggedFlags(d.daily);
  const tabs: Array<[Tab, string]> = [['run', 'RUN'], ['gym', 'GYM'], ['state', 'STATE'], ['note', 'NOTE']];

  return (
    <div>
      <Panel title="LOG">
        <div className="big">{fmtDate(d.date)}</div>
        <div className="muted">
          {d.weekNumber != null ? `WEEK ${String(d.weekNumber).padStart(2, '0')}` : 'WEEK —'}
          {d.phase ? ` · ${d.phase}` : ''}
        </div>
      </Panel>

      <div className="logtabs" role="tablist" aria-label="log mode">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} data-tab={label}
            className={tab === id ? 'sel' : ''} onClick={() => setTab(id)}>
            {label}
            {flags[id] ? <span className="dot" aria-label="logged" /> : null}
          </button>
        ))}
      </div>

      {tab === 'run' && <RunLogger daily={d.daily} plan={d.plan} onSaved={onSaved} />}
      {tab === 'gym' && <GymLogger daily={d.daily} plan={d.plan} onSaved={onSaved} />}
      {tab === 'state' && <StateLogger daily={d.daily} onSaved={onSaved} />}
      {tab === 'note' && <NoteLogger daily={d.daily} onSaved={onSaved} />}
    </div>
  );
}

// ---------- shared ----------
function States({ status, error }: { status: string; error: { code: string; message: string } | null }) {
  if (status === 'saved') return <Banner kind="ok">SAVED · LOCKED</Banner>;
  if (status === 'error') return <Banner kind="err">{humanError(error)}</Banner>;
  return null;
}
const numOrOmit = (v: string) => (v.trim() === '' ? undefined : Number(v));

function PlanCtx({ label, planned }: { label: string; planned: string | null }) {
  return (
    <Panel title={`${label} · TODAY'S PLAN`}>
      <div className="tagrow"><span className="tag tag-planned">PLANNED</span><span className="muted">read-only</span></div>
      <div className="big">{planned ?? 'NO PLAN SCHEDULED'}</div>
    </Panel>
  );
}

function Chips({ value, options, onChange, field }: { value: string | null; options: readonly string[]; onChange: (v: string | null) => void; field: string }) {
  return (
    <div className="chips" data-field={field}>
      {options.map((o) => (
        <button type="button" key={o} className={value === o ? 'sel' : ''} onClick={() => onChange(value === o ? null : o)}>{o}</button>
      ))}
    </div>
  );
}

function RpeGrid({ value, onChange, field }: { value: number | null; onChange: (v: number) => void; field: string }) {
  return (
    <>
      <div className="rpe" data-field={field}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button type="button" key={n} className={value === n ? 'sel' : ''} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{value != null ? `${value} · ${RPE_LABELS[value]}` : 'Tap to rate effort'}</div>
    </>
  );
}

/** Tap-to-set segmented scale with dot-matrix readout (STATE tab). */
function TapScale({ label, value, onChange, max, amber, field }: { label: string; value: number | null; onChange: (v: number) => void; max: number; amber?: boolean; field: string }) {
  return (
    <>
      <label>{label}</label>
      <div className="tapscale" data-field={field}>
        <div className="cells">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button type="button" key={n} className={value != null && n <= value ? 'on' : ''} aria-label={String(n)} onClick={() => onChange(n)} />
          ))}
        </div>
        <span className={`num${amber && value != null && value > 7 ? ' amber' : ''}`}>{value ?? '—'}</span>
      </div>
    </>
  );
}

// ---------- RUN ----------
function RunLogger({ daily, plan, onSaved }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void }) {
  const planned = plan?.runPlan ?? plan?.longRunPlan ?? plan?.qualityPlan ?? null;
  const [runType, setRunType] = useState<string | null>(daily?.runType ?? null);
  const [km, setKm] = useState(daily?.runActualKm != null ? String(daily.runActualKm) : '');
  const [rpe, setRpe] = useState<number | null>(daily?.runRpe ?? null);
  const [pain, setPain] = useState<number | null>(daily?.painScore ?? null);
  const [painLoc, setPainLoc] = useState<string | null>(daily?.painLocation ?? null);
  const [painTiming, setPainTiming] = useState<string | null>(daily?.painTiming ?? null);
  const [note, setNote] = useState(daily?.runNote ?? '');
  const { status, error, run } = useSave();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (runType !== null) body.runType = runType;
    const k = numOrOmit(km); if (k !== undefined) body.km = k;
    if (rpe !== null) body.rpe = rpe;
    if (pain !== null) {
      body.pain = pain;
      body.painLocation = pain > 0 ? painLoc : null;
      body.painTiming = pain > 0 ? painTiming : null;
    }
    if (note.trim() !== '') body.note = note;
    const r = await run(() => api.saveRun(body));
    if (r?.ok) onSaved();
  }

  return (
    <form onSubmit={submit}>
      <PlanCtx label="RUN" planned={planned} />
      <Panel title="ACTUAL RUN">
        <label>RUN TYPE</label>
        <Chips value={runType} options={RUN_TYPES} onChange={setRunType} field="runType" />
        <label>DISTANCE (KM)</label>
        <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} data-field="km" placeholder="actual km" />

        <div className="tagrow" style={{ marginTop: 12 }}><span className="tag tag-response">RESPONSE</span></div>
        <label>RPE — EFFORT</label>
        <RpeGrid value={rpe} onChange={setRpe} field="rpe" />
        <label>PAIN</label>
        <div className="seg" data-field="pain">
          {[0, 1, 2, 3].map((p) => (
            <button type="button" key={p} className={pain === p ? 'sel' : ''} onClick={() => setPain(p)}>{p}</button>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>{pain != null ? `${pain} · ${PAIN_LABELS[pain]}` : 'No pain rating yet'}</div>
        {pain !== null && pain > 0 ? (
          <div className="attn-box" data-field="pain-detail">
            <div className="tagrow"><span className="tag tag-response">INJURY</span></div>
            <label>PAIN LOCATION</label>
            <Chips value={painLoc} options={PAIN_LOCATIONS} onChange={setPainLoc} field="painLocation" />
            <label>PAIN TIMING</label>
            <Chips value={painTiming} options={PAIN_TIMINGS} onChange={setPainTiming} field="painTiming" />
          </div>
        ) : null}
        <label>NOTE</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Anything about the run…" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE RUN" /></div>
      </Panel>
    </form>
  );
}

// ---------- GYM ----------
function GymLogger({ daily, plan, onSaved }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void }) {
  const planned = plan?.gymPlan ?? null;
  const [done, setDone] = useState<boolean | null>(daily?.gymDone ?? null);
  const [gymType, setGymType] = useState<string | null>(daily?.gymType ?? null);
  const [duration, setDuration] = useState(daily?.gymDurationMin != null ? String(daily.gymDurationMin) : '');
  const [rpe, setRpe] = useState<number | null>(daily?.gymRpe ?? null);
  const [note, setNote] = useState(daily?.gymNote ?? '');
  const { status, error, run } = useSave();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (done === null) return;
    const body: Record<string, unknown> = { completed: done };
    if (done) {
      if (gymType !== null) body.gymType = gymType;
      const dur = numOrOmit(duration); if (dur !== undefined) body.duration = dur;
      if (rpe !== null) body.rpe = rpe;
      if (note.trim() !== '') body.note = note;
    }
    const r = await run(() => api.saveGym(body));
    if (r?.ok) onSaved();
  }

  return (
    <form onSubmit={submit}>
      <PlanCtx label="GYM" planned={planned} />
      <Panel title="ACTUAL GYM">
        <label>GYM SESSION</label>
        <div className="toggle" data-field="gym">
          <button type="button" className={done === true ? 'sel' : ''} onClick={() => setDone(true)}>YES</button>
          <button type="button" className={done === false ? 'sel' : ''} onClick={() => setDone(false)}>NO</button>
        </div>
        {done ? (
          <>
            <label>SESSION TYPE</label>
            <Chips value={gymType} options={GYM_TYPES} onChange={setGymType} field="gymType" />
            <label>DURATION (MIN)</label>
            <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} data-field="duration" placeholder="minutes" />
            <label>RPE — EFFORT</label>
            <RpeGrid value={rpe} onChange={setRpe} field="gymRpe" />
            <label>NOTE</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="gymNote" placeholder="Anything about the session…" />
          </>
        ) : null}
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE GYM" /></div>
      </Panel>
    </form>
  );
}

// ---------- DAILY STATE ----------
function StateLogger({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const [weight, setWeight] = useState(daily?.weight != null ? String(daily.weight) : '');
  const [sleep, setSleep] = useState(daily?.sleepHours != null ? String(daily.sleepHours) : '');
  const [sleepQ, setSleepQ] = useState<number | null>(daily?.sleepQuality ?? null);
  const [readiness, setReadiness] = useState<number | null>(daily?.readiness ?? null);
  const [stress, setStress] = useState<number | null>(daily?.stress ?? null);
  const [motivation, setMotivation] = useState<number | null>(daily?.motivation ?? null);
  const { status, error, run } = useSave();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    const w = numOrOmit(weight); if (w !== undefined) body.weight = w;
    const s = numOrOmit(sleep); if (s !== undefined) body.sleep = s;
    if (sleepQ !== null) body.sleepQuality = sleepQ;
    if (readiness !== null) body.readiness = readiness;
    if (stress !== null) body.stress = stress;
    if (motivation !== null) body.motivation = motivation;
    const r = await run(() => api.saveWeight(body));
    if (r?.ok) onSaved();
  }

  return (
    <form onSubmit={submit}>
      <Panel title="DAILY STATE">
        <div className="muted" style={{ marginBottom: 8 }}>Morning check-in — about a minute.</div>
        <div className="row">
          <div><label>WEIGHT (KG)</label><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-field="weight" /></div>
          <div><label>SLEEP (H)</label><input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} data-field="sleep" /></div>
        </div>
        <TapScale label="SLEEP QUALITY 1–5" value={sleepQ} onChange={setSleepQ} max={5} field="sleepQuality" />
        <TapScale label="READINESS 1–10" value={readiness} onChange={setReadiness} max={10} field="readiness" />
        <TapScale label="STRESS 1–10" value={stress} onChange={setStress} max={10} amber field="stress" />
        <TapScale label="MOTIVATION 1–10" value={motivation} onChange={setMotivation} max={10} field="motivation" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE STATE" /></div>
      </Panel>
    </form>
  );
}

// ---------- NOTE ----------
function NoteLogger({ daily, onSaved }: { daily: DailyView | null; onSaved: () => void }) {
  const saved = daily?.noteText ?? '';
  const [note, setNote] = useState(saved);
  const [editing, setEditing] = useState(saved.trim() === '');
  const { status, error, run } = useSave();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api.saveNote({ note })); // '' clears
    if (r?.ok) { setEditing(false); onSaved(); }
  }

  if (!editing) {
    return (
      <Panel title="NOTE">
        {note.trim() === '' ? (
          <div className="muted">No note yet.</div>
        ) : (
          <>
            <div className="locked" data-field="note-locked">{note}</div>
            <div className="saved-tag">SAVED · LOCKED</div>
          </>
        )}
        <div style={{ marginTop: 12 }}>
          <button type="button" data-action="edit-note" onClick={() => setEditing(true)}>EDIT NOTE</button>
        </div>
      </Panel>
    );
  }

  return (
    <form onSubmit={submit}>
      <Panel title="NOTE">
        <div className="muted" style={{ marginBottom: 8 }}>Write what happened, in your own words.</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Woke up with heavy calves. Easy 4 km felt fine…" style={{ minHeight: 150 }} />
        {/* Reserved: future TEXT + PHOTO + AUDIO attach here without redesign. */}
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled title="Not available yet">+ PHOTO</button>
          <button type="button" disabled title="Not available yet">+ AUDIO</button>
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE NOTE" /></div>
      </Panel>
    </form>
  );
}
