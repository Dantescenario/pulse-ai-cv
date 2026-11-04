import assert from 'node:assert/strict';
import { displayText } from './displayText.js';

assert.equal(displayText('Good depth (53\u00c2\u00b0, target 55\u00c2\u00b0). Target \u00e2\u2030\u00a52.5s.'), 'Good depth (53\u00b0, target 55\u00b0). Target \u22652.5s.');
assert.equal(displayText('Already correct: 53\u00b0 \u2265 2.5s'), 'Already correct: 53\u00b0 \u2265 2.5s');
assert.equal(displayText(null), null);
console.log('Display punctuation checks passed');
