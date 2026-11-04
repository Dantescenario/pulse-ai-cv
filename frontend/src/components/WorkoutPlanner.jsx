import React, { useEffect, useState } from 'react';
import './WorkoutPlanner.css';

const API = '/api';
const EXERCISES = {
  pullups: 'Pull-up / Chin-up', squats: 'Barbell Squat', pushups: 'Chest Push-up',
  curls: 'Bicep Curl', lateral_raises: 'Lateral Raise', lunges: 'Lunge',
};
const DEFAULT = { target_sets: 3, reps_min: 8, reps_max: 12, load_kg: 0, increment_kg: 1, rest_seconds: 90, max_rpe: 8 };
const FIELDS = [
  ['target_sets', 'Sets', 1, 12, 1], ['reps_min', 'Minimum reps', 1, 100, 1], ['reps_max', 'Maximum reps', 1, 100, 1],
  ['load_kg', 'External weight (kg)', 0, 1000, 0.001], ['increment_kg', 'Weight increment (kg)', 0.001, 50, 0.001],
  ['rest_seconds', 'Rest between sets (seconds)', 0, 1800, 1], ['max_rpe', 'Difficulty limit (RPE 1–10)', 1, 10, 0.5],
];
async function request(path, data) {
  const response = await fetch(`${API}${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Check the entered values and try again.');
  return body;
}

function TargetEditor({ exercise, initial, onSaved }) {
  const [draft, setDraft] = useState({ ...DEFAULT, ...initial, exercise });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <form className="glass-card" onSubmit={async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { await request('/plans', draft); await onSaved('Target saved.'); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }}>
    <h3>{initial?.id ? 'Edit target' : 'Create a target'}</h3>
    <p>Choose your own targets. External weight excludes bodyweight; use the same convention each time, such as weight per dumbbell.</p>
    <div className="workout-fields">{FIELDS.map(([key, label, min, max, step]) => <label key={key}>{label}
      <input type="number" required min={min} max={max} step={step} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value === '' ? '' : Number(e.target.value) })} />
    </label>)}</div>
    {draft.reps_min > draft.reps_max && <p role="alert">Minimum reps must not exceed maximum reps.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="btn-primary" disabled={saving || draft.reps_min > draft.reps_max}>{saving ? 'Saving…' : 'Save target'}</button>
  </form>;
}

function RunLogger({ plan, workouts, onSaved }) {
  const fresh = () => ({ reps: '', load_kg: plan.load_kg, rpe: '', rest_seconds: '', workout_session_id: '' });
  const [sets, setSets] = useState(() => Array.from({ length: plan.target_sets }, fresh));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (index, patch) => setSets(values => values.map((value, i) => i === index ? { ...value, ...patch } : value));
  const eligible = (workouts || []).filter(w => w.exercise === EXERCISES[plan.exercise] && ['webcam', 'video_upload'].includes(w.source));
  return <form className="glass-card" onSubmit={async event => {
    event.preventDefault(); setSaving(true); setError('');
    const values = sets.map((set, index) => ({
      reps: Number(set.reps), load_kg: Number(set.load_kg), rpe: set.rpe === '' ? null : Number(set.rpe),
      rest_seconds: index === 0 || set.rest_seconds === '' ? null : Number(set.rest_seconds),
      workout_session_id: set.workout_session_id === '' ? null : Number(set.workout_session_id),
    }));
    try { await request(`/plans/${plan.id}/runs`, { target: plan, sets: values }); await onSaved('Workout logged. Your next-session suggestion is below.'); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }}>
    <h3>Log a workout</h3>
    <p>Target: {plan.target_sets} sets × {plan.reps_min}–{plan.reps_max} reps at {plan.load_kg} kg external weight. Rest: {plan.rest_seconds}s. Difficulty limit: RPE {plan.max_rpe}.</p>
    <p>RPE is your perceived difficulty: 1 is very easy, 10 is maximal effort. Leave unknown difficulty or rest blank; missing values prevent a weight-increase suggestion.</p>
    <p>Each row represents one set. For tracked sets, reset the trainer between sets and save each separately. The selector lists up to 20 recent unused camera/video sets. Unlinked rows are manual entries and do not add camera measurements to Analytics.</p>
    {sets.map((set, index) => <fieldset key={index} disabled={saving}>
      <legend>Set {index + 1}</legend>
      <label>Rep source <select value={set.workout_session_id} onChange={e => {
        const workout = eligible.find(w => w.id === Number(e.target.value));
        update(index, { workout_session_id: e.target.value, ...(workout ? { reps: workout.reps_completed } : {}) });
      }}>
        <option value="">Manual entry</option>
        {eligible.map(w => <option key={w.id} value={w.id} disabled={sets.some((s, i) => i !== index && Number(s.workout_session_id) === w.id)}>Saved set #{w.id}: {w.reps_completed} reps ({w.source})</option>)}
      </select></label>
      <div className="workout-fields">
        <label>Completed reps<input type="number" required min="0" max="1000" step="1" value={set.reps} readOnly={set.workout_session_id !== ''} onChange={e => update(index, { reps: e.target.value })} /></label>
        <label>External weight (kg)<input type="number" required min="0" max="1000" step="0.001" value={set.load_kg} onChange={e => update(index, { load_kg: e.target.value })} /></label>
        <label>Difficulty (RPE 1–10)<input type="number" min="1" max="10" step="0.5" value={set.rpe} onChange={e => update(index, { rpe: e.target.value })} /></label>
        {index > 0 && <label>Rest before this set (seconds)<input type="number" min="0" max="1800" step="1" value={set.rest_seconds} onChange={e => update(index, { rest_seconds: e.target.value })} /></label>}
      </div>
      <button type="button" className="btn-secondary" disabled={sets.length === 1} onClick={() => setSets(values => values.filter((_, i) => i !== index))}>Remove set {index + 1}</button>
    </fieldset>)}
    {!workouts && <p>Tracked sets are unavailable. You can still enter sets manually.</p>}
    <div className="workout-actions">
      <button type="button" className="btn-secondary" disabled={saving || sets.length >= 12} onClick={() => setSets(values => [...values, fresh()])}>Add set</button>
      <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save workout & calculate next target'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export default function WorkoutPlanner() {
  const [exercise, setExercise] = useState('squats');
  const [plans, setPlans] = useState(null);
  const [workouts, setWorkouts] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [proposal, setProposal] = useState(null);
  const load = async (message = '') => {
    const results = await Promise.allSettled([request('/plans'), request('/plans/available-sets')]);
    if (results[0].status === 'fulfilled') { setPlans(results[0].value); setError(''); }
    else { setError('Could not load workout targets. Retry to continue.'); }
    setWorkouts(results[1].status === 'fulfilled' ? results[1].value : null);
    if (message) { setNotice(message); setProposal(null); }
  };
  useEffect(() => { load(); }, []);
  const plan = plans?.find(item => item.exercise === exercise);
  const latest = plan?.latest_run;
  const currentTarget = plan && latest && FIELDS.every(([key]) => plan[key] === latest.target[key]);
  return <div className="workout-planner">
    <div className="glass-card"><h2>Workout targets</h2>
      <p>Plan an exercise, record each set and use a transparent rule to review your next target.</p>
      <label>Exercise <select value={exercise} onChange={e => { setExercise(e.target.value); setProposal(null); setNotice(''); }}>
        {Object.entries(EXERCISES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button className="btn-secondary" onClick={() => load()}>Retry</button></div>}
    {!plans && !error && <p role="status">Loading targets…</p>}
    {plans && !error && <>
      <TargetEditor key={JSON.stringify([exercise, plan, proposal])} exercise={exercise} initial={proposal || plan} onSaved={load} />
      {plan && <RunLogger key={JSON.stringify(plan)} plan={plan} workouts={workouts} onSaved={load} />}
      {latest && <section className="glass-card">
        <h3>Latest workout & next-session suggestion</h3>
        <p>Workout #{latest.id}: {latest.sets.length} sets. Target at the time: {latest.target.target_sets} × {latest.target.reps_min}–{latest.target.reps_max} at {latest.target.load_kg} kg.</p>
        <ol>{latest.sets.map((set, index) => <li key={index}>{set.reps} reps at {set.load_kg} kg · RPE {set.rpe ?? 'not recorded'}{index > 0 ? ` · ${set.rest_seconds ?? 'unknown'}s rest` : ''}{set.workout_session_id ? ` · linked set #${set.workout_session_id}` : ' · manual'}</li>)}</ol>
        <p><strong>{latest.suggestion.action === 'increase_load' ? `Suggested external weight: ${latest.suggestion.next_load_kg} kg; return to the lower end of your rep range.` : `Repeat your recorded target at ${latest.suggestion.next_load_kg} kg.`}</strong></p>
        <ul>{latest.suggestion.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {!currentTarget && <p>Your target has changed since this workout. This suggestion describes the older target.</p>}
        {currentTarget && latest.suggestion.action === 'increase_load' && <button type="button" className="btn-secondary" onClick={() => {
          setProposal({ ...plan, load_kg: latest.suggestion.next_load_kg });
          setNotice('Suggested weight copied to the target editor. Review it and select Save target to apply.');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}>Review suggested weight</button>}
        <p>No target changes automatically. Weight increases require every planned set to reach the upper rep count at the target load, difficulty at or below your limit, and enough recorded rest between sets. Camera tracking does not verify weight or difficulty.</p>
      </section>}
    </>}
  </div>;
}
