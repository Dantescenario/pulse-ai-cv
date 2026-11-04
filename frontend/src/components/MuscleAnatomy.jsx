import React, { useId, useState } from 'react';
import { muscles, exerciseMuscles, validMuscleMap } from '../utils/muscleMap';
import './MuscleAnatomy.css';

// Bilateral regions are drawn once and reflected around the body's midline.
const front = {
  deltoids: 'M67 70 Q52 70 48 88 L61 94 74 80Z',
  chest: 'M78 74 Q66 77 64 91 Q76 109 98 96 L98 77Z',
  biceps: 'M51 96 Q42 109 43 127 L55 132 Q64 111 60 99Z',
  forearms: 'M43 134 Q34 149 32 174 L41 178 55 139Z',
  abs: 'M82 104 L98 102 98 153 84 151 Q79 126 82 104Z',
  obliques: 'M69 103 L79 109 80 153 71 146 65 120Z',
  quads: 'M72 170 Q61 193 68 229 L82 239 Q95 210 94 177Z',
  adductors: 'M95 177 L99 185 94 230 86 231Z',
  calves: 'M70 249 Q64 272 74 294 L82 298 88 250Z',
};
const rear = {
  traps: 'M86 61 L98 66 98 109 Q80 97 69 81Z',
  deltoids: front.deltoids,
  lats: 'M65 96 L80 102 96 115 96 146 80 151 Q69 128 65 96Z',
  triceps: 'M51 96 Q42 109 43 127 L55 132 Q64 111 60 99Z',
  forearms: front.forearms,
  back: 'M90 118 L98 114 98 164 90 158Z',
  glutes: 'M76 156 Q67 165 68 181 Q80 193 97 181 L98 159Z',
  hamstrings: 'M69 190 Q64 209 70 237 L84 239 94 190Z',
  calves: 'M70 249 Q61 270 74 292 L82 298 Q92 275 88 250Z',
};
const outline = 'M89 54 L87 63 67 70 Q52 72 47 90 L38 128 27 176 33 187 42 183 57 138 65 110 70 146 66 169 Q59 194 65 237 L65 251 72 300 69 316 85 316 88 301 94 250 100 198 106 250 112 301 115 316 131 316 128 300 135 251 135 237 Q141 194 134 169 L130 146 135 110 143 138 158 183 167 187 173 176 162 128 153 90 Q148 72 133 70 L113 63 111 54Z';

export default function MuscleAnatomy({ exercise, exerciseName }) {
  const titleId = useId();
  const defaults = exerciseMuscles[exercise] || { primary: [], supporting: [] };
  const storageKey = `pulse-muscles-v1-${exercise}`;
  const [map, setMap] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey)); return validMuscleMap(saved) ? saved : defaults; }
    catch { return defaults; }
  });
  const [message, setMessage] = useState('');
  const role = id => map.primary.includes(id) ? 'primary' : map.supporting.includes(id) ? 'supporting' : 'inactive';
  const save = next => {
    setMap(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setMessage('Muscle map saved in this browser.'); }
    catch { setMessage('Browser storage unavailable. Changes apply until you leave this exercise.'); }
  };
  const update = (id, value) => {
    const next = { primary: map.primary.filter(item => item !== id), supporting: map.supporting.filter(item => item !== id) };
    if (value !== 'inactive') next[value].push(id);
    save(next);
  };
  return <section className="glass-card muscle-anatomy" aria-labelledby={titleId}>
    <span className="eyebrow">Exercise anatomy</span>
    <h3 id={titleId}>{exerciseName}: muscle map</h3>
    <div className="anatomy-legend"><span className="primary">Primary</span><span className="supporting">Supporting</span><span>Other muscles</span></div>
    <div className="anatomy-figures">
      {[[front, 'Front'], [rear, 'Back']].map(([regions, view]) => <figure key={view}>
        <svg viewBox="20 8 160 320" role="img" aria-label={`${view} muscle map. Primary: ${map.primary.map(id => muscles[id]).join(', ') || 'none'}. Supporting: ${map.supporting.map(id => muscles[id]).join(', ') || 'none'}.`}>
          <ellipse cx="100" cy="32" rx="16" ry="22" className="anatomy-body" />
          <path d={outline} className="anatomy-body" />
          {Object.entries(regions).map(([id, path]) => <g key={id} className={`anatomy-muscle ${role(id)}`}><title>{`${muscles[id]}: ${role(id) === 'inactive' ? 'not highlighted' : role(id)}`}</title><path d={path} /><path d={path} transform="translate(200 0) scale(-1 1)" /></g>)}
          <path d={view === 'Front' ? "M100 76V155 M83 118H117 M83 132H117 M84 145H116" : "M100 66V180"} className="anatomy-detail" />
        </svg><figcaption>{view}</figcaption>
      </figure>)}
    </div>
    {['primary', 'supporting'].map(group => <div className="anatomy-muscle-list" key={group}><strong>{group === 'primary' ? 'Primary movers' : 'Supporting muscles'}</strong><p>{map[group].map(id => muscles[id]).join(' · ') || 'None selected'}</p></div>)}
    <p className="anatomy-note">Simplified muscle groups for the selected exercise, not measured activation. Technique, grip and load can change involvement.</p>
    <details className="anatomy-customize"><summary>Customize this exercise’s muscle map</summary>
      <p>Choose your own emphasis for this variation. Changes affect this reference map only, and are saved per exercise in this browser.</p>
      {Object.entries(muscles).map(([id, label]) => <label key={id}>{label}<select value={role(id)} onChange={event => update(id, event.target.value)}><option value="inactive">Not highlighted</option><option value="primary">Primary</option><option value="supporting">Supporting</option></select></label>)}
      <button type="button" className="btn-secondary" onClick={() => save(defaults)}>Restore exercise defaults</button>
    </details>
    <p role="status" className="anatomy-note">{message}</p>
    <a className="anatomy-source" href="https://www.nasm.org/workout-exercise-guidance" target="_blank" rel="noreferrer">Exercise reference: NASM library</a>
  </section>;
}
