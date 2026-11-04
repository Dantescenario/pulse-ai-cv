import assert from 'node:assert/strict';
import { analyzeWorkoutVideo } from './videoAnalysisApi.js';

const originalFetch = globalThis.fetch;
try {
  const body = new FormData();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.example.com/api/workouts/analyze-video');
    assert.equal(options.body, body);
    assert.equal(options.method, 'POST');
    return Response.json({ reps_completed: 2 });
  };
  assert.equal((await analyzeWorkoutVideo('https://api.example.com', body)).reps_completed, 2);
  for (const [status, message] of [[413, /upload limit/], [502, /stopped/], [504, /time limit/], [404, /endpoint is unavailable/]]) {
    globalThis.fetch = async () => new Response('<html>Hosting error</html>', { status });
    await assert.rejects(analyzeWorkoutVideo('', body), message);
  }
  globalThis.fetch = async () => Response.json({ detail: 'No pose detected' }, { status: 422 });
  await assert.rejects(analyzeWorkoutVideo('', body), /No pose detected/);
  globalThis.fetch = async () => new Response('<html>Frontend</html>');
  await assert.rejects(analyzeWorkoutVideo('', body), /invalid analysis response/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(analyzeWorkoutVideo('', body), /Cannot reach/);
  for (const [status, code, message] of [[413, 'UPLOAD_TOO_LARGE', 'Video exceeds 10 MiB.'],
                                       [422, 'INVALID_VIDEO', 'Cannot decode this video.'],
                                       [503, 'ANALYSIS_BUSY', 'Video analysis is busy. Please retry shortly.']]) {
    globalThis.fetch = async () => Response.json({ detail: { code, message } }, { status });
    await assert.rejects(analyzeWorkoutVideo('', body), error => error.message === message);
  }

  // Browser transport: status follows upload events rather than a timer.
  for (const diagnostics of [undefined, {}, { rejection_reason: 'ambiguous_candidates', candidates: [{ exercise: 'squats', score: 5 }] }]) {
    globalThis.fetch = async () => Response.json({ detail: { code: 'EXERCISE_UNCLEAR', message: 'Original message', recognition_diagnostics: diagnostics } }, { status: 422 });
    await assert.rejects(analyzeWorkoutVideo('', body), error => {
      assert.equal(error.code, 'EXERCISE_UNCLEAR');
      assert.deepEqual(error.recognitionDiagnostics, diagnostics ?? null);
      assert.match(error.message, /select your exercise manually/);
      assert.doesNotMatch(error.message, /probability|confidence|%/);
      if (diagnostics?.rejection_reason === 'ambiguous_candidates') assert.match(error.message, /Multiple exercises matched/);
      return true;
    });
  }

  const originalXHR = globalThis.XMLHttpRequest;
  let request;
  class FakeXHR {
    constructor() { this.upload = {}; request = this; }
    open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/api/workouts/analyze-video'); }
    send(value) { assert.equal(value, body); }
    abort() { this.onabort(); }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  try {
    const phases = [];
    const pending = analyzeWorkoutVideo('', body, { onStatus: state => phases.push(state) });
    assert.deepEqual(phases, ['uploading']);
    request.upload.onload();
    assert.deepEqual(phases, ['uploading', 'processing']);
    request.status = 200;
    request.response = { reps_completed: 2 };
    request.onload();
    assert.equal((await pending).reps_completed, 2);
    assert.deepEqual(phases, ['uploading', 'processing', 'complete']);
    const controller = new AbortController();
    const cancelled = analyzeWorkoutVideo('', body, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    const timedOut = analyzeWorkoutVideo('', body);
    request.ontimeout();
    await assert.rejects(timedOut, /timed out/);
    const busy = analyzeWorkoutVideo('', body);
    request.status = 503;
    request.response = { detail: { code: 'ANALYSIS_BUSY', message: 'Retry shortly.' } };
    request.onload();
    await assert.rejects(busy, /Retry shortly/);
  } finally {
    if (originalXHR === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = originalXHR;
  }
  console.log('Video analysis API checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
