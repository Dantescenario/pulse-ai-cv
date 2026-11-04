import assert from 'node:assert/strict';
import { comparisonGroups, sessionMeasurements, measurementDelta } from './sessionComparison.js';

const rep = { depthAngle: 90, eccentricSeconds: 2, concentricSeconds: 1 };
const measured = sessionMeasurements({ reps_completed: 4, eccentric_tempo_avg: 99,
  rep_details_json: JSON.stringify([rep, { depth_angle: 100, eccentric_seconds: 0, concentric_seconds: 2 }, {}, null]) });
assert.equal(measured.reps.value, 4);
assert.equal(measured.angle.value, 95);
assert.equal(measured.angle.count, 2);
assert.equal(measured.eccentric.value, 1);
assert.equal(measured.duration.value, 2.5);
const missing = sessionMeasurements({ reps_completed: 0, avg_tut_seconds: 3.2, rep_details_json: 'bad' });
assert.equal(missing.reps.value, 0);
assert.equal(missing.duration.value, null);
assert.equal(missing.duration.count, 0);
assert.equal(sessionMeasurements({rep_details_json: [{eccentricSeconds: -2}]}).eccentric.value, null);
assert.equal(measurementDelta(0, 2), -2);
assert.equal(measurementDelta(2, 0), 2);
assert.equal(measurementDelta(null, 2), null);
const groups = comparisonGroups([
  {id: 1, exercise: 'Squat', created_at: '2026-01-01', source: 'webcam'},
  {id: 2, exercise: 'Squat', created_at: '2026-01-02', source: 'webcam'},
  {id: 3, exercise: 'Squat', created_at: '2026-01-02', source: 'webcam'},
  {id: 4, exercise: 'Squat', created_at: '2026-01-03', source: 'simulation'},
  {id: 5, exercise: 'Curl', created_at: '2026-01-03'},
]);
assert.equal(groups.length, 3);
assert.deepEqual(groups[0].sessions.map(s => s.id), [3, 2]);
assert.equal(groups[1].sessions.length, 1);
assert.equal(groups[2].source, 'unknown');
assert.deepEqual(comparisonGroups([]), []);
console.log('PASS: session comparisons preserve zero, exclude missing measurements, separate sources and order sessions');
