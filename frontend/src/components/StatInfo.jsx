import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';
import './StatInfo.css';

const statDefinitions = {
  'Completed reps': 'Full movement cycles accepted by the counter: a starting position, working position and full return. Partial reps and low-confidence movements can be excluded. This does not certify correct technique.',
  'Form score': 'A heuristic percentage estimated from detected movement geometry and exercise rules. It is not a professional technique assessment; camera placement and tracking quality affect it.',
  'Hypertrophy stimulus': 'The Hypertrophy Stimulus Index (HSI) combines range of motion (up to 40 points), tempo (35) and stability (25). It is a movement-based estimate, not a measurement of muscle growth, effort or external load.',
  'Time under tension': 'Estimated total seconds spent in counted movement cycles. It describes movement time, not measured muscle tension, and differs from the full video or session duration.',
  'Avg TUT': 'Estimated time under tension per completed rep, in seconds: total counted movement time divided by completed reps.',
  'Eccentric Tempo': 'Estimated average duration of the lowering phase of counted reps, in seconds. Longer is not automatically better; compare the same exercise and setup.',
  'Lifting phase': 'Estimated duration of the lifting (concentric) phase of a counted rep, in seconds.',
  'Extreme joint angle': 'The most flexed or raised tracked joint angle reached during a rep, depending on the exercise. This is a 2D camera estimate in degrees, not a calibrated anatomical measurement.',
  'Tracked side': 'The left or right side used to measure this rep, selected from visible joints. Changing sides or camera views can affect comparisons.',
  'ROM': 'Range of motion. The live overlay shows the current tracked joint angle in degrees. The HSI ROM component awards up to 40 points based on the rep’s extreme angle relative to the exercise target.',
  'Tempo': 'The HSI tempo component contributes up to 35 points based on estimated lowering time. It is a scoring rule, not a measurement of training effectiveness.',
  'Stability': 'The HSI stability component contributes up to 25 points based on detected movement flaws. Tracking errors can affect it; it does not measure joint integrity.',
  'Muscle Engagement': 'The anatomy map highlights primary and supporting muscle groups for the selected exercise. You can customize these assignments per exercise. Colors describe a reference role, not measured activation or force.',
  'Joint Angle Timeline': 'Tracked joint angles across analyzed video frames. Peaks and troughs show movement changes; gaps, camera perspective and pose errors can affect the trace.',
  'Total reps': 'Sum of completed reps across saved workout sessions. This summary is separate from manual Daily Log entries and can include saved simulations or older sample sessions.',
  'Workout sessions': 'Number of saved workout sessions across all time. Saving individual sets separately creates separate sessions.',
  'Average form estimate': 'Average of available saved session form scores. Missing scores are excluded. Scores are heuristic estimates rather than measured technique quality.',
  'Active days this week': 'Distinct dates with saved workouts since Monday, using your browser timezone. Multiple sessions on one day count as one active day; this is not a consecutive-day streak.',
  'Rep duration': 'Elapsed seconds from the start to completion of one accepted movement cycle. Comparison averages include only reps with recorded measurements.',
  'Session duration': 'Recorded length of a saved session in seconds. This can include time outside counted repetitions, so it differs from time under tension.',
  'Angular excursion': 'Movement in degrees relative to the configured starting threshold. The counter requires a minimum excursion; this is not a calibrated anatomical range of motion.',
};
const aliases = { 'Verified Reps': 'Completed reps', Reps: 'Completed reps', 'Form Score': 'Form score', 'HSI Score': 'Hypertrophy stimulus', 'Hypertrophy Stimulus Index': 'Hypertrophy stimulus', 'Lowering phase': 'Eccentric Tempo', 'Average lowering phase': 'Eccentric Tempo', 'Average lifting phase': 'Lifting phase', 'Average extreme joint angle': 'Extreme joint angle', 'Average rep duration': 'Rep duration' };

export default function StatInfo({ stat }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({});
  const placeTooltip = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(270, window.innerWidth * 0.7);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 8 });
  };
  const description = statDefinitions[aliases[stat] || stat];
  if (!description) return null;
  return <span className={`stat-info${pinned ? ' is-open' : ''}`}>
    <button type="button" className="stat-info-button" aria-label={`About ${stat}`} aria-describedby={id}
      onMouseEnter={placeTooltip} onFocus={placeTooltip} onClick={event => { placeTooltip(event); setPinned(value => !value); }} onBlur={() => setPinned(false)} onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); event.currentTarget.blur(); } }}>
      <Info size={14} aria-hidden="true" />
    </button>
    <span id={id} role="tooltip" className="stat-info-tooltip" style={position}>{description}</span>
  </span>;
}

export function StatisticsGuide() {
  return <section className="statistics-guide">
    <div className="glass-card"><h3>Reading your movement report</h3><p>Hover over an info icon, focus it with your keyboard, or tap it for a quick explanation. The trainer estimates movement from visible joints. Use consistent camera placement, exercise variation and load when comparing sessions.</p></div>
    {Object.entries(statDefinitions).map(([name, description]) => <article className="glass-card" key={name}><h3>{name}</h3><p>{description}</p></article>)}
    <div className="glass-card"><h3>Missing measurements and demo results</h3><p>“Not measured” or “Not recorded” means a value is unavailable, not zero. Before any reps are counted, zero scores are placeholders. Demo mode uses simulated movements and does not describe your training.</p></div>
  </section>;
}
