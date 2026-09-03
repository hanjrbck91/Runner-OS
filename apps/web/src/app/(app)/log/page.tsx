'use client';
import { useCallback, useState } from 'react';
import { api, type DailyView, type PlanView, type TodayView } from '../../../lib/api.js';
import { humanError, fmtDate } from '../../../lib/format.js';
import { useResource, useSave } from '../../../lib/useApi.js';
import { Loading, ErrorBanner, Panel, SaveButton, Banner } from '../../../components/ui.js';

/**
 * Log = an ACTION CONSOLE, not one giant form. The landing view shows four
 * independent blocks (RUN / GYM / DAILY STATE / NOTE); each opens its own
 * focused logger. Planned (coach) is read-only context and is NEVER copied into
 * actual inputs. Each logger saves only its own fields (isolation preserved).
 */
type View = 'console' | 'run' | 'gym' | 'state' | 'note';

const RPE_LABELS: Record<number, string> = {
  1: 'Extremely easy', 2: 'Very easy', 3: 'Easy', 4: 'Comfortable', 5: 'Moderate',
  6: 'Somewhat hard', 7: 'Hard', 8: 'Very hard', 9: 'Extremely hard', 10: 'Maximum effort',
};
const PAIN_LABELS: Record<number, string> = { 0: 'No pain', 1: 'Noticeable', 2: 'Needs attention', 3: 'Stop / do not proceed' };
const PAIN_LOCATIONS = ['Calf', 'Achilles / tendon', 'Foot', 'Ankle', 'Shin', 'Knee', 'Quad', 'Hamstring', 'Hip', 'Glute', 'Other'];
const PAIN_TIMINGS = ['Before run', 'During run', 'After run', 'Next morning'];
const RUN_TYPES = ['Easy', 'Long', 'Quality', 'Tempo', 'Threshold', 'Intervals', 'Marathon pace', 'Recovery', 'Race', 'Other'];
const GYM_TYPES = ['Strength', 'Lower body', 'Upper body', 'Full body', 'Mobility', 'Rehab / prehab', 'Other'];

export default function LogPage() {
  const loader = useCallback(() => api.today(), []);
  const t = useResource(loader, 'today');
  const [view, setView] = useState<View>('console');

  if (t.status === 'loading') return <Loading label="SYNCING" />;
  if (t.status === 'error') return <ErrorBanner error={t.error} onRetry={t.reload} />;
  const d = t.data!;
  const back = () => setView('console');
  const onSaved = () => { t.reload(); };

  return (
    <div>
      <Header d={d} view={view} onBack={back} />
      {view === 'console' && <Console d={d} open={setView} />}
      {view === 'run' && <RunLogger daily={d.daily} plan={d.plan} onSaved={onSaved} onDone={back} />}
      {view === 'gym' && <GymLogger daily={d.daily} plan={d.plan} onSaved={onSaved} onDone={back} />}
      {view === 'state' && <StateLogger daily={d.daily} onSaved={onSaved} onDone={back} />}
      {view === 'note' && <NoteLogger daily={d.daily} onSaved={onSaved} onDone={back} />}
    </div>
  );
}

function Header({ d, view, onBack }: { d: TodayView; view: View; onBack: () => void }) {
  return (
    <Panel title={view === 'console' ? 'LOG' : `LOG · ${view.toUpperCase()}`}>
      <div className="big">{fmtDate(d.date)}</div>
      <div className="muted">
        {d.weekNumber != null ? `WEEK ${String(d.weekNumber).padStart(2, '0')}` : 'WEEK —'}
        {d.phase ? ` · ${d.phase}` : ''}
      </div>
      {view !== 'console' ? (
        <div style={{ marginTop: 10 }}><button data-action="back" onClick={onBack}>← BACK TO LOG</button></div>
      ) : null}
    </Panel>
  );
}

// ---------- CONSOLE (four blocks) ----------
function Console({ d, open }: { d: TodayView; open: (v: View) => void }) {
  const daily = d.daily;
  const plannedRun = d.plan?.runPlan ?? d.plan?.longRunPlan ?? d.plan?.qualityPlan ?? null;
  const plannedGym = d.plan?.gymPlan ?? null;

  const runLogged = daily && (daily.runActualKm != null || daily.runType != null || daily.runRpe != null || daily.painScore != null);
  const gymLogged = daily && daily.gymDone != null;
  const stateLogged = daily && (daily.weight != null || daily.sleepHours != null || daily.readiness != null || daily.stress != null || daily.motivation != null || daily.sleepQuality != null || !!daily.nutritionAdherence);
  const noteText = daily?.noteText ?? '';

  return (
    <div>
      <Block title="RUN" planned={plannedRun} plannedEmpty="No run planned"
        summary={runLogged ? runSummary(daily!) : null}
        action={runLogged ? 'EDIT RUN' : 'LOG RUN →'} onOpen={() => open('run')} />

      <Block title="GYM" planned={plannedGym} plannedEmpty="No gym planned"
        summary={gymLogged ? (daily!.gymDone ? `Done${daily!.gymType ? ` · ${daily!.gymType}` : ''}${daily!.gymDurationMin != null ? ` · ${daily!.gymDurationMin} min` : ''}` : 'Skipped') : null}
        action={gymLogged ? 'EDIT GYM' : 'LOG GYM →'} onOpen={() => open('gym')} />

      <Block title="DAILY STATE" hint="Weight · Sleep · Readiness · Stress · Motivation"
        summary={stateLogged ? stateSummary(daily!) : null}
        action={stateLogged ? 'EDIT STATE' : 'LOG STATE →'} onOpen={() => open('state')} />

      <Panel title="NOTE">
        {noteText.trim() !== '' ? (
          <>
            <div className="lcd locked" data-field="note-locked">{noteText}</div>
            <div className="saved-tag">SAVED · LOCKED</div>
            <div style={{ marginTop: 10 }}><button data-action="edit-note" onClick={() => open('note')}>EDIT NOTE</button></div>
          </>
        ) : (
          <>
            <div className="muted" style={{ marginBottom: 10 }}>Anything important today.</div>
            <button className="primary" data-action="add-note" onClick={() => open('note')}>ADD NOTE →</button>
          </>
        )}
      </Panel>
    </div>
  );
}

function Block({ title, planned, plannedEmpty, hint, summary, action, onOpen }:
  { title: string; planned?: string | null; plannedEmpty?: string; hint?: string; summary: string | null; action: string; onOpen: () => void }) {
  return (
    <Panel title={title}>
      {planned !== undefined ? (
        <>
          <div className="tagrow"><span className="tag tag-planned">TODAY&apos;S PLAN</span></div>
          <div className="big">{planned ?? plannedEmpty}</div>
        </>
      ) : null}
      {hint ? <div className="muted" style={{ marginBottom: summary ? 6 : 10 }}>{hint}</div> : null}
      {summary ? (
        <div className="logged"><span className="tag tag-actual">LOGGED</span> <span>{summary}</span></div>
      ) : null}
      <button className={summary ? '' : 'primary'} data-action={`open-${title.toLowerCase().replace(/\s+/g, '-')}`} style={{ marginTop: 10 }} onClick={onOpen}>{action}</button>
    </Panel>
  );
}

function runSummary(d: DailyView): string {
  const parts: string[] = [];
  if (d.runType) parts.push(d.runType);
  if (d.runActualKm != null) parts.push(`${d.runActualKm} km`);
  if (d.runRpe != null) parts.push(`RPE ${d.runRpe}`);
  if (d.painScore != null) parts.push(`pain ${d.painScore}${d.painScore > 0 && d.painLocation ? ` (${d.painLocation})` : ''}`);
  return parts.join(' · ') || 'Logged';
}
function stateSummary(d: DailyView): string {
  const parts: string[] = [];
  if (d.weight != null) parts.push(`${d.weight} kg`);
  if (d.sleepHours != null) parts.push(`${d.sleepHours} h`);
  if (d.sleepQuality != null) parts.push(`sleep ${d.sleepQuality}/5`);
  if (d.readiness != null) parts.push(`ready ${d.readiness}/10`);
  if (d.stress != null) parts.push(`stress ${d.stress}/10`);
  if (d.motivation != null) parts.push(`mot ${d.motivation}/10`);
  return parts.join(' · ') || 'Logged';
}

// ---------- shared controls ----------
function States({ status, error }: { status: string; error: { code: string; message: string } | null }) {
  if (status === 'saved') return <Banner kind="ok">SAVED</Banner>;
  if (status === 'error') return <Banner kind="err">{humanError(error)}</Banner>;
  return null;
}
const numOrOmit = (v: string) => (v.trim() === '' ? undefined : Number(v));

function PlanCtx({ planned }: { planned: string | null }) {
  return (
    <Panel>
      <div className="tagrow"><span className="tag tag-planned">TODAY&apos;S PLAN</span><span className="muted">read-only</span></div>
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

// ---------- RUN LOGGER ----------
function RunLogger({ daily, plan, onSaved, onDone }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void; onDone: () => void }) {
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
      // Injury detail is meaningful only when pain > 0; clear it otherwise.
      body.painLocation = pain > 0 ? painLoc : null;
      body.painTiming = pain > 0 ? painTiming : null;
    }
    if (note.trim() !== '') body.note = note;
    const r = await run(() => api.saveRun(body));
    if (r?.ok) { onSaved(); onDone(); }
  }

  return (
    <form onSubmit={submit}>
      <PlanCtx planned={planned} />
      <Panel>
        <div className="tagrow"><span className="tag tag-actual">ACTUAL</span></div>
        <label>RUN TYPE</label>
        <Chips value={runType} options={RUN_TYPES} onChange={setRunType} field="runType" />
        <label>ACTUAL KM</label>
        <input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} data-field="km" />

        <div className="tagrow" style={{ marginTop: 12 }}><span className="tag tag-response">RESPONSE</span></div>
        <label>RPE (EFFORT)</label>
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
        <label>RUN NOTE</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Anything about the run…" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE RUN" /></div>
      </Panel>
    </form>
  );
}

// ---------- GYM LOGGER ----------
function GymLogger({ daily, plan, onSaved, onDone }: { daily: DailyView | null; plan: PlanView | null; onSaved: () => void; onDone: () => void }) {
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
    if (r?.ok) { onSaved(); onDone(); }
  }

  return (
    <form onSubmit={submit}>
      <PlanCtx planned={planned} />
      <Panel>
        <div className="tagrow"><span className="tag tag-actual">ACTUAL</span></div>
        <label>COMPLETED?</label>
        <div className="toggle" data-field="gym">
          <button type="button" className={done === true ? 'sel' : ''} onClick={() => setDone(true)}>YES</button>
          <button type="button" className={done === false ? 'sel' : ''} onClick={() => setDone(false)}>NO</button>
        </div>
        {done ? (
          <>
            <label>SESSION TYPE</label>
            <Chips value={gymType} options={GYM_TYPES} onChange={setGymType} field="gymType" />
            <label>DURATION (MIN)</label>
            <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} data-field="duration" />
            <label>RPE (EFFORT)</label>
            <RpeGrid value={rpe} onChange={setRpe} field="gymRpe" />
            <label>GYM NOTE</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="gymNote" placeholder="Anything about the session…" />
          </>
        ) : null}
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE GYM" /></div>
      </Panel>
    </form>
  );
}

// ---------- DAILY STATE LOGGER ----------
function Scale({ label, value, onChange, min, max, field }: { label: string; value: number | null; onChange: (v: number) => void; min: number; max: number; field: string }) {
  const opts = [];
  for (let i = min; i <= max; i += 1) opts.push(i);
  return (
    <>
      <label>{label}</label>
      <div className="seg wrap" data-field={field}>
        {opts.map((n) => (
          <button type="button" key={n} className={value === n ? 'sel' : ''} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </>
  );
}

function StateLogger({ daily, onSaved, onDone }: { daily: DailyView | null; onSaved: () => void; onDone: () => void }) {
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
    if (r?.ok) { onSaved(); onDone(); }
  }

  return (
    <form onSubmit={submit}>
      <Panel>
        <div className="muted" style={{ marginBottom: 8 }}>Morning check-in — about a minute.</div>
        <div className="row">
          <div><label>WEIGHT (KG)</label><input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} data-field="weight" /></div>
          <div><label>SLEEP (H)</label><input inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} data-field="sleep" /></div>
        </div>
        <Scale label="SLEEP QUALITY (1-5)" value={sleepQ} onChange={setSleepQ} min={1} max={5} field="sleepQuality" />
        <Scale label="READINESS (1-10)" value={readiness} onChange={setReadiness} min={1} max={10} field="readiness" />
        <Scale label="STRESS (1-10)" value={stress} onChange={setStress} min={1} max={10} field="stress" />
        <Scale label="MOTIVATION (1-10)" value={motivation} onChange={setMotivation} min={1} max={10} field="motivation" />
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE STATE" /></div>
      </Panel>
    </form>
  );
}

// ---------- NOTE LOGGER ----------
function NoteLogger({ daily, onSaved, onDone }: { daily: DailyView | null; onSaved: () => void; onDone: () => void }) {
  const [note, setNote] = useState(daily?.noteText ?? '');
  const { status, error, run } = useSave();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api.saveNote({ note })); // '' clears
    if (r?.ok) { onSaved(); onDone(); }
  }
  return (
    <form onSubmit={submit}>
      <Panel>
        <div className="muted" style={{ marginBottom: 8 }}>Write what happened, in your own words.</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} data-field="note" placeholder="Woke up with heavy calves. Easy 4 km felt fine…" style={{ minHeight: 140 }} />
        {/* Attachment area — reserved so future TEXT + PHOTO + AUDIO attach here without redesign. */}
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled title="Coming soon">+ PHOTO (SOON)</button>
          <button type="button" disabled title="Coming soon">+ AUDIO (SOON)</button>
        </div>
        <States status={status} error={error} />
        <div style={{ marginTop: 12 }}><SaveButton status={status} label="SAVE NOTE" /></div>
      </Panel>
    </form>
  );
}
