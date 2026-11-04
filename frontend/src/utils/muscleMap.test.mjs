import assert from 'node:assert/strict';
import { exerciseMuscles, validMuscleMap } from './muscleMap.js';
for (const [exercise, map] of Object.entries(exerciseMuscles)) {
  assert.ok(validMuscleMap(map), `${exercise} must reference known, non-overlapping muscles`);
  assert.ok(map.primary.length > 0, `${exercise} needs a primary mover`);
}
assert.equal(Object.keys(exerciseMuscles).length, 6);
assert.ok(validMuscleMap({ primary: [], supporting: [] }));
for (const invalid of [null, {}, { primary: ['unknown'], supporting: [] }, { primary: ['biceps'], supporting: ['biceps'] }, { primary: 'biceps', supporting: [] }]) {
  assert.ok(!validMuscleMap(invalid), 'Invalid browser data must fall back to defaults');
}
console.log('Muscle map checks passed');
