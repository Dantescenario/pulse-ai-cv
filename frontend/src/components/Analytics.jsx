import StatInfo from './StatInfo';
import { displayText } from '../utils/displayText';
import { Repeat2, Dumbbell, Activity, CalendarDays } from 'lucide-react';
import RepReview from './RepReview';
import SessionComparison from './SessionComparison';
import React, { useEffect, useState } from 'react';

const API = '';
const metric = (value, suffix = '') => Number.isFinite(value) ? `${value}${suffix}` : 'Not measured';

export default function Analytics() {
  const [stats, setStats] = useState(null);
  const [workouts, setWorkouts] = useState(null);
  const [comparisons, setComparisons] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setErrors({});
    const results = await Promise.allSettled([
      fetch(`${API}/api/analytics?tz_offset=${-new Date().getTimezoneOffset()}`).then(async r => {
        if (!r.ok) throw new Error('Summary unavailable');
        return r.json();
      }),
      fetch(`${API}/api/workouts`).then(async r => {
        if (!r.ok) throw new Error('History unavailable');
        return r.json();
      }),
      fetch(`${API}/api/workout-comparisons`).then(async r => {
        if (!r.ok) throw new Error('Comparisons unavailable');
        return r.json();
      }),
    ]);
    setStats(results[0].status === 'fulfilled' ? results[0].value : null);
    setWorkouts(results[1].status === 'fulfilled' ? results[1].value : null);
    setComparisons(results[2].status === 'fulfilled' ? results[2].value : null);
    setErrors({ summary: results[0].status === 'rejected', workouts: results[1].status === 'rejected', comparisons: results[2].status === 'rejected' });
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cards = [
    ['Total reps', stats?.total_reps, 'Across all saved sessions'],
    ['Workout sessions', stats?.total_sessions, 'All-time saved sessions'],
    ['Average form estimate', stats?.avg_form_score, 'Heuristic movement score', '%'],
    ['Active days this week', stats?.weekly_active_days, 'Distinct workout days since Monday in your timezone'],
  ];
  return (
    <div className="analytics-screen" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} aria-busy={loading}>
      {(errors.summary || errors.workouts || errors.comparisons) && <div className="glass-card" role="alert">
        <p>{errors.summary ? 'Workout summary is unavailable. ' : ''}{errors.workouts ? 'Workout history is unavailable. ' : ''}{errors.comparisons ? 'Session comparisons are unavailable.' : ''}</p>
        <button type="button" onClick={load} disabled={loading}>Retry</button>
      </div>}
      <div className="analytics-metrics">
        {cards.map(([label, value, description, suffix], index) => <div className="glass-card" key={label}>
          <div className="metric-label" style={{ color: '#94a3b8' }}>{label}<StatInfo stat={label} />{React.createElement([Repeat2, Dumbbell, Activity, CalendarDays][index], { size: 16 })}</div>
          <div className="mono-metric" style={{ fontSize: '1.8rem', color: '#19c995', margin: '0.5rem 0' }}>
            {loading ? 'Loading…' : errors.summary ? 'Unavailable' : metric(value, suffix)}
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{description}</span>
        </div>)}
      </div>
      {!loading && comparisons && <SessionComparison sessions={comparisons} />}
      <div className="glass-card analytics-history">
        <h3>Recent workout history</h3>
        <p style={{ color: '#94a3b8' }}>Up to 20 saved sessions. Form scores are heuristic estimates from movement geometry.</p>
        {loading ? <p role="status">Loading workouts…</p> : workouts?.length === 0 ? <p>No workouts logged yet. Complete and save a set in the Vision Trainer.</p> : workouts?.map(w =>
          <div key={w.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '1rem', padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div><strong>{w.exercise}</strong><p style={{ color: '#94a3b8' }}>{displayText(w.feedback_summary) || 'No feedback recorded.'}</p></div>
            <div style={{ textAlign: 'right' }}>
              <div>{metric(w.reps_completed)} reps · Session duration: {metric(w.duration_seconds, 's')}</div>
              <div style={{ color: '#65ddb8' }}>Form estimate: {metric(w.avg_form_score, '%')}</div>
            </div>
            <div style={{ width: '100%' }}><RepReview reps={w.rep_details_json} /></div>
          </div>
        )}
      </div>
      <div className="glass-card">
        <h3>Measurement limits</h3>
        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>Muscle growth, muscle activation and joint integrity are not measured by this dashboard. Existing history may include sample sessions from earlier versions.</p>
      </div>
    </div>
  );
}
