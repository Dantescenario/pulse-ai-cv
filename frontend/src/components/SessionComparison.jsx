import StatInfo from './StatInfo';
import React, { useState } from 'react';
import { comparisonGroups, sessionMeasurements, measurementDelta } from '../utils/sessionComparison';
import './SessionComparison.css';

const sources = { webcam: 'Live camera', video_upload: 'Uploaded video', simulation: 'Simulation', unknown: 'Source not recorded' };
const format = (value, unit = '') => Number.isFinite(value) ? `${Number(value.toFixed(2))}${unit}` : 'Not measured';
const date = value => {
  const parsed = new Date(/Z$|[+-]\d\d:\d\d$/.test(value || '') ? value : `${value?.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : parsed.toLocaleString();
};

export default function SessionComparison({ sessions }) {
  const [selected, setSelected] = useState('');
  const groups = comparisonGroups(sessions);
  const group = groups.find(item => item.key === selected) || groups[0];
  if (!group) return <div className="glass-card"><h3>Session comparison</h3><p>Save two sessions of the same exercise to compare them.</p></div>;
  const [latest, previous] = group.sessions;
  const current = sessionMeasurements(latest);
  const before = previous ? sessionMeasurements(previous) : null;
  const rows = [['reps', 'Completed reps', ''], ['angle', 'Average extreme joint angle', '°'], ['eccentric', 'Average lowering phase', 's'], ['concentric', 'Average lifting phase', 's'], ['duration', 'Average rep duration', 's']];
  return <section className="glass-card session-comparison" aria-label="Session comparison">
    <h3>Session comparison</h3>
    <label>Exercise and capture method <select value={group.key} onChange={event => setSelected(event.target.value)}>
      {groups.map(item => <option key={item.key} value={item.key}>{item.exercise} · {sources[item.source] || item.source}</option>)}
    </select></label>
    {group.source === 'unknown' && <p>These sessions have no recorded capture method and may include older sample data.</p>}
    {group.source === 'simulation' && <p>Simulation results demonstrate the tracker; they do not represent personal training progress.</p>}
    {!previous ? <p>One session saved for this exercise and capture method. Save another to see changes.</p> : <>
      <p>Latest: {date(latest.created_at)} (#{latest.id})<br />Previous: {date(previous.created_at)} (#{previous.id})</p>
      <div className="comparison-table-wrap"><table>
        <caption>Two latest saved sessions of this exercise and capture method</caption>
        <thead><tr><th scope="col">Measurement</th><th scope="col">Previous</th><th scope="col">Latest</th><th scope="col">Change</th></tr></thead>
        <tbody>{rows.map(([key, label, unit]) => {
          const delta = measurementDelta(current[key].value, before[key].value);
          return <tr key={key}><th scope="row">{label}<StatInfo stat={label} /></th>
            <td>{format(before[key].value, unit)}{key !== 'reps' && <small>{before[key].count} reps measured</small>}</td>
            <td>{format(current[key].value, unit)}{key !== 'reps' && <small>{current[key].count} reps measured</small>}</td>
            <td>{delta === null ? 'Not comparable' : `${delta > 0 ? '+' : ''}${format(delta, unit)}`}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </>}
    <p className="rep-review-note">Changes describe the recorded movement, not a quality ranking. Use the same camera view, tracked side, exercise variation and load for useful comparisons. Timings and angles come from individual rep records; missing records are excluded.</p>
  </section>;
}
