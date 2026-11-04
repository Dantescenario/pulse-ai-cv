import StatInfo from './StatInfo';
import { displayText } from '../utils/displayText';
import React from 'react';
import { normalizeRep, parseRepDetails } from '../utils/repReview';
import './RepReview.css';

const show = (value, unit) => Number.isFinite(value) ? `${Number(value.toFixed(2))}${unit}` : 'Not recorded';

export default function RepReview({ reps, onReplay }) {
  const records = parseRepDetails(reps);
  return <section className="rep-review" aria-label="Rep-by-rep review">
    <h3>Rep-by-rep review</h3>
    <p className="rep-review-note">Expand a counted rep to inspect its measurements. Angles are 2D estimates. Uncounted attempts are not stored.</p>
    {records.length === 0 ? <p>No rep details recorded yet.</p> : records.map((record, index) => {
      const rep = normalizeRep(record, index);
      return <details key={index} className="rep-review-item">
        <summary>Rep {rep.number} · {show(rep.angle, '°')} · {show(rep.duration, 's')}</summary>
        <dl className="rep-review-metrics">
          <div><dt>Extreme joint angle<StatInfo stat="Extreme joint angle" /></dt><dd>{show(rep.angle, '°')}</dd></div>
          <div><dt>Tracked side<StatInfo stat="Tracked side" /></dt><dd>{rep.side}</dd></div>
          <div><dt>Lowering phase<StatInfo stat="Lowering phase" /></dt><dd>{show(rep.eccentric, 's')}</dd></div>
          <div><dt>Lifting phase<StatInfo stat="Lifting phase" /></dt><dd>{show(rep.concentric, 's')}</dd></div>
        </dl>
        {rep.evidence ? <div>
          <strong>Why it counted</strong>
          <p>The counter detected a starting position, working position and full return, with stable endpoints.</p>
          <ul>
            <li>Cycle duration: {show(rep.evidence.duration_seconds, 's')} (required 0.65–15s).</li>
            <li>Angular excursion from the configured start threshold: {show(rep.evidence.excursion_degrees, '°')} (minimum {show(rep.evidence.min_range_degrees, '°')}).</li>
            <li>Return phase: {show(rep.evidence.return_seconds, 's')} (minimum 0.18s).</li>
          </ul>
          <p className="rep-review-note">These checks explain the count; they do not certify correct form.</p>
        </div> : <p className="rep-review-note">Counting evidence was not saved for this older rep.</p>}
        <p>{rep.flaws.length ? `Recorded cues: ${displayText(rep.flaws.join('; '))}` : 'No movement cues recorded.'}</p>
        {onReplay && rep.canReplay && <button type="button" className="btn-secondary" onClick={() => onReplay(rep.start, rep.end)}>Replay rep {rep.number}</button>}
        {!onReplay && <p className="rep-review-note">Video replay is available while the analyzed upload is open in the trainer. Camera footage is not recorded.</p>}
      </details>;
    })}
  </section>;
}
