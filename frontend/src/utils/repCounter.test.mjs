import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizeRep, parseRepDetails } from './repReview.js';
const config=JSON.parse(fs.readFileSync(new URL('./repConfig.json',import.meta.url)));
const source=fs.readFileSync(new URL('./repCounter.js',import.meta.url),'utf8').replace("import CONFIG from './repConfig.json';",'').replace('export class RepCounter','class RepCounter');
const Counter=vm.runInNewContext(source+'; RepCounter',{CONFIG:config,Math,Number,Object,Set,Error});
const generate="import sys,json;sys.path.insert(0,'backend/tests');from test_rep_counter import cases;print(json.dumps(cases()))";
const cases=JSON.parse(execFileSync('python',['-B','-c',generate],{cwd:new URL('../../..',import.meta.url),maxBuffer:16*1024*1024}).toString());
for(const test of cases) {
 const tracker=new Counter(test.exercise);
 for(const f of test.frames) tracker.update(f.landmarks,f.time,test.aspect);
 assert.equal(tracker.reps,test.expected,test.name);
 console.log('PASS:',test.name);
}

const trackerSource=fs.readFileSync(new URL('./poseEngine.js',import.meta.url),'utf8').replace("import { RepCounter } from './repCounter';",'').replaceAll('export ','');
const Tracker=vm.runInNewContext(trackerSource+'; ExerciseTracker',{RepCounter:Counter,Math,Number,Object,Set,Error});
for(const test of cases) {
 const events=[];
 const tracker=new Tracker(test.exercise,rep=>events.push(rep));
 tracker.audioEnabled=false;
 for(const f of test.frames) tracker.processLandmarks(f.landmarks,f.time,test.aspect);
 assert.equal(tracker.reps,test.expected,test.name+' wrapper');
 assert.equal(events.length,test.expected,test.name+' callback count');
 for (const event of events) {
   const rep = normalizeRep(event);
   assert.ok(rep.canReplay, test.name+' timestamps');
   assert.ok(event.start_time < event.peak_time && event.peak_time < event.end_time);
   assert.equal(rep.evidence.full_cycle, true);
   assert.ok(rep.evidence.excursion_degrees >= rep.evidence.min_range_degrees);
   assert.ok(Math.abs(rep.duration - rep.evidence.duration_seconds) < .011);
 }
}
console.log('PASS: live telemetry and callbacks match all core cases');
assert.deepEqual(parseRepDetails('invalid'), []);
assert.deepEqual(parseRepDetails('{"rep_number":1}'), []);
assert.deepEqual(parseRepDetails('[null,3,[],{"rep_number":1}]'), [{rep_number:1}]);
const legacy = normalizeRep({repNumber: 1, depthAngle: 0, eccentricSeconds: 0, concentricSeconds: 1});
assert.equal(legacy.angle, 0);
assert.equal(legacy.duration, 1);
assert.equal(legacy.canReplay, false);
assert.equal(legacy.evidence, null);
assert.equal(normalizeRep({start_time: 3, end_time: 2}).canReplay, false);
assert.equal(normalizeRep({start_time: 0, end_time: 2}).canReplay, true);
assert.equal(normalizeRep({eccentric_seconds: 1}).duration, null);
console.log('PASS: rep review handles legacy records, missing data and invalid timestamps');
