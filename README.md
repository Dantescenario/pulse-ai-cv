# PulseAI â€” Computer Vision Portfolio Demo

PulseAI demonstrates workout movement analysis using React + Vite, FastAPI, MediaPipe and OpenCV. It opens directly on Vision Trainer. Public demo mode is enabled by default and does not read or write the shared application database.

## Portfolio architecture

- **Browser:** React interface, local MediaPipe Pose tracking for live camera input, canvas skeleton/joint-angle overlays, rep review and video replay.
- **Backend:** FastAPI receives uploaded videos; OpenCV decodes frames and MediaPipe Tasks extracts pose landmarks. Existing exercise-recognition and full-cycle rep-counting rules produce the report.
- **Demo access policy:** middleware allows only `/api/health` and `/api/workouts/analyze-video` under `/api`. Other API requests receive a stable HTTP 403 response before payload validation or handler execution. Frontend files and bundled MediaPipe assets remain accessible.
- **Storage:** uploads are copied to temporary server files and deleted in the analysis handler's `finally` block. Reports remain in browser memory until the trainer is left or reset. Live camera footage is processed in the browser and is not recorded. Muscle-map preferences remain browser-local settings.
- **Existing SQLite data:** preserved. Demo startup skips database initialization and importing the database module no longer opens a connection. No tables or records are deleted or migrated by this change.

No authentication, external model API key, paid service or database migration is required for the portfolio demo.

## Available features

- Uploaded-video analysis, live camera tracking and a synthetic demonstration mode.
- Manual exercise selection and automatic identification for uploaded single-exercise clips.
- Pull-ups/chin-ups, squats, push-ups, bicep curls, lateral raises and lunges.
- Full-cycle rep counting, joint angles, phase timings and movement reports.
- Rep-by-rep measurements, counting evidence and replay while an analyzed upload remains open.
- Front/back muscle reference maps with browser-local customization.
- Statistics Guide and hover/focus/tap metric explanations.

Use a stationary camera with working joints visible. Hold the starting position briefly, complete the movement and return fully. Partial reps and tracking gaps can be excluded. Automatic recognition is heuristic; review the selected exercise. Scores describe movement-based estimates, not measured muscle growth, activation, joint integrity or clinical technique quality.

## Disabled features in public demo mode

Navigation exposes only **Vision Trainer** and **Stats Guide**. Saving sessions is hidden and guarded. Profile, diary, targets, nutrition and analytics screens are unavailable. Legacy coach APIs remain blocked. Body-composition and waist-estimation routes, services and frontend pages have been removed from the application.

The API policy blocks all methods on these paths and their subpaths:

| API family | Disabled functionality |
| --- | --- |
| `/api/profile` | Shared profile read/write |
| `/api/workouts` except `/api/workouts/analyze-video` | Workout history and saving |
| `/api/workout-comparisons` | Saved-session comparisons |
| `/api/analytics` | Shared workout/nutrition aggregates |
| `/api/diary` | Manual diary and weekly progress |
| `/api/plans` | Targets, available sets and workout runs |
| `/api/nutrition` | Meal logs, catalogue, calculation and photo inference |
| `/api/coach` | Legacy chat and shared profile context |

All non-allowlisted `/api` paths, including newly added APIs, fail closed with HTTP **403** and this stable JSON body:

```json
{
  "detail": {
    "code": "DEMO_MODE_DISABLED",
    "message": "Personal-data and non-CV APIs are disabled in the public portfolio demo."
  }
}
```

Stateless nutrition APIs are intentionally blocked as well to keep the public project focused on workout CV. Browser CORS preflight handling may answer an OPTIONS request; the subsequent personal-data request is still blocked. API documentation is available at `/docs`; documented legacy APIs remain subject to the policy.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PULSEAI_DEMO_MODE` | `true` | Backend runtime switch. Accepts `true` or `false` (case-insensitive). Invalid values stop startup rather than silently enabling private features. Restart the backend after changing it. |
| `DATABASE_PATH` | `backend/pulse_fitness.db`; Docker: `/data/pulse_fitness.db` | Existing SQLite location, used only by private database-backed features. Not opened by demo startup. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed browser origins for a separately hosted frontend. |
| `VITE_API_URL` | Empty (same origin) | Optional frontend build-time backend origin, without `/api`. Used by the public trainer and health check. Vite proxies `/api` locally. |

The recommended public setting is explicitly:

```text
PULSEAI_DEMO_MODE=true
```

There is no separate frontend demo switch. `/api/health` returns `demo_mode`; the interface defaults to demo mode while loading, if configuration is missing or if the request fails. Backend enforcement is authoritative.

### Private legacy behavior

`PULSEAI_DEMO_MODE=false` restores the existing database-backed APIs and frontend navigation (AI Coach remains absent from navigation). It does not restore the removed body-composition endpoints. Startup then runs the existing SQLite initialization logic. This is an unauthenticated shared-profile application: use this setting only in a private local environment. It is not multi-user isolation. Do not expose private mode publicly with personal data.

## Local setup

Prerequisites: Python 3.12, Node.js 22/npm, and a webcam or short exercise video. The bundled `backend/pose_landmarker.task` and frontend MediaPipe assets are required.

The pose bundle matches Google's versioned Pose Landmarker Lite float16/1 download. Its checksum, embedded metadata, pinned source URL and Apache 2.0 licensing material are documented in [third-party model provenance](third_party/mediapipe/README.md).

From the repository root:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:PULSEAI_DEMO_MODE = 'true'
Set-Location backend
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

On macOS/Linux, use `python3 -m venv backend/.venv`, `backend/.venv/bin/python -m pip install -r backend/requirements.txt`, then from `backend` run:

```sh
PULSEAI_DEMO_MODE=true .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. FastAPI documentation is at `http://127.0.0.1:8000/docs`.

Optional legacy food classification uses `backend/requirements-ml.txt` and `backend/training/install_food_model.py`; neither is required for local CV demo setup. The existing Docker build still includes the optional food model; nutrition catalogue datasets are excluded from this release.

## Tests and verification

Install backend test dependencies into the virtual environment:

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-test.txt
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests
```

Use the equivalent `.venv/bin/python` path on macOS/Linux. Persistence tests explicitly use temporary databases; demo-policy tests verify no SQLite access during demo import/startup. HTTP upload tests mock inference to test route accessibility, admission and cleanup. Budget tests mock native inference and include an actual OpenCV encode/decode check; they do not establish real-video model accuracy. Existing counter tests cover synthetic sequences and stored pull-up landmarks.

From `frontend`:

```sh
npm run test:demo
npm run test:reps
npm run test:comparisons
node src/utils/videoAnalysisApi.test.mjs
node src/utils/displayText.test.mjs
node src/utils/muscleMap.test.mjs
npm run build
```

## Continuous integration

[CI workflow](.github/workflows/ci.yml) runs on pushes to `main`, pull requests targeting `main`, and manual runs from GitHub Actions. The inspected Git remote is `https://github.com/Dantescenario/pulse-AI.git`.

Two independent Ubuntu jobs use the same Python 3.12 and Node.js 22 major versions as local setup and Docker:

- **Backend tests (Python 3.12):** installs the native CV runtime libraries and `backend/requirements-test.txt`, checks dependency compatibility and CV imports, then runs `python -B -m unittest discover -s backend/tests -v` from the repository root.
- **Frontend tests, lint and build (Node 22):** runs `npm ci` using `frontend/package-lock.json`, `node --test src/utils/*.test.mjs` (all six current utility test files), `npm run lint`, and `npm run build` from `frontend`.

Pip and npm download caches are keyed by their dependency files; dependencies are still installed and tests run on every job. Oxlint keeps the existing application rules and excludes only bundled third-party `public/mediapipe` assets, whose generated OpenGL functions otherwise trigger React hook false positives. No backend linter or type checker is currently configured.

The complete backend suite runs without camera/GPU hardware, external services, private evaluation videos or downloaded food-model weights. Existing tests use synthetic/stored landmarks, temporary databases and mocked inference where appropriate; OpenCV encode/decode checks still execute. CI installs neither `requirements-ml.txt` nor model weights and sets Hugging Face offline flags. It does not run real-video benchmarks or verify pose-model accuracy. No tests are excluded by the workflow. Any test-reported skip remains visible in the verbose output.

The workflow has read-only repository permissions, uses no application secrets, and does not deploy or publish artifacts. Superseded runs on the same branch/PR are cancelled.

To inspect a failure, open the repository's **Actions â†’ CI â†’ run â†’ failed job â†’ failed step**. Backend logs identify the failing unittest; frontend test logs identify the failing file, lint logs include source locations, and build logs show compilation errors. Dependency-install failures are separate from test failures. Reproduce with the commands above; additionally run `python -m pip check` after installing backend test dependencies and `npm run lint` from `frontend`.

After reviewing and committing/pushing these files yourself, ensure GitHub Actions is enabled in repository settings and allow the checkout/setup actions if your organization restricts actions. Open a PR targeting `main` or use **Run workflow** once the workflow is on the default branch. After the first run, optionally configure branch protection/rulesets to require both named jobs. No manual GitHub changes are performed by this task.

## Hosting and current limits

The Dockerfile builds React, includes CV dependencies and shared rep configuration, checks native pose initialization during build, and serves FastAPI plus frontend from one origin. It binds to `0.0.0.0` using `PORT` (default 8000) and explicitly sets `--workers 1` so an inherited worker-count environment variable cannot multiply admission slots. Keep `PULSEAI_DEMO_MODE=true` in the hosting environment. No hosting account changes or deployment are performed by this task.

A database disk is unnecessary for public demo results because they are not saved. Preserve any existing disk and data. Live camera access requires HTTPS outside localhost. A static frontend alone cannot perform server video analysis.

Video requests are size-limited before multipart parsing and only one request is admitted at a time per worker. Use **one Uvicorn worker and one service instance**, as the existing Docker command does: multiple workers each have their own admission slot. No Redis, job queue or paid service is used.

## Video resource limits

All values below are backend runtime settings. Numeric overrides must be positive integers; invalid values stop startup. Health responses expose the upload bytes, duration and dimensions so the Trainer can show current limits. Server checks remain authoritative even if the UI has not loaded that information.

| Environment variable | Default | Behavior |
| --- | --- | --- |
| `PULSEAI_VIDEO_MAX_UPLOAD_BYTES` | `10485760` (10 MiB) | Exact file-byte limit; HTTP 413 if exceeded. |
| `PULSEAI_VIDEO_MAX_DURATION_SECONDS` | `30` | Maximum clip duration; checked against metadata and during decode. |
| `PULSEAI_VIDEO_MAX_WIDTH` | `1920` | Maximum decoded frame width, before the existing inference resize. |
| `PULSEAI_VIDEO_MAX_HEIGHT` | `1920` | Maximum decoded frame height. Portrait 1080Ã—1920 is supported; 4K must be resized. |
| `PULSEAI_VIDEO_MAX_PROCESSED_FRAMES` | `900` | Maximum inference frames/retained landmark frames. Excess work is rejected, never silently truncated. |
| `PULSEAI_VIDEO_MAX_REPLAY_SAMPLES` | `360` | Uniformly spaced replay samples, including first/last frame positions. Lower values reduce replay detail. |
| `PULSEAI_VIDEO_ANALYSIS_TIMEOUT_SECONDS` | `60` | Cooperative wall-time budget checked between decode, inference and counting operations. |
| `PULSEAI_VIDEO_UPLOAD_TIMEOUT_SECONDS` | `30` | Maximum time to receive the multipart request body. |
| `PULSEAI_VIDEO_TEMP_MAX_AGE_SECONDS` | `3600` | Age after which leftover named application uploads can be removed. |
| `PULSEAI_VIDEO_TEMP_DIR` | OS temporary directory + `/pulseai-video` | Dedicated ephemeral directory for request buffers and analysis files. |

The multipart envelope is capped at the file limit plus **64 KiB** for form overhead. `Content-Length` is checked early, but actual received bytes are counted too, including chunked requests and dishonest length headers. The body is buffered to a temporary disk file and replayed in 64 KiB chunks to the existing FastAPI multipart parser; the handler then copies the file in bounded chunks with the exact file limit. This can temporarily require roughly three upload-sized disk copies (bounded request buffer, framework spool, analysis file), rather than loading an entire video into Python memory.

OpenCV must decode a multi-frame video with usable FPS/frame-count/dimension metadata. File extension and browser MIME are not used as proof of validity. Dimensions are checked before inference and on every decoded frame; duration and work limits are checked during processing as well. Truncated videos or unusable metadata are rejected. The existing frame-sampling cadence and rep counters are unchanged. Automatic recognition retains at most the configured inference-frame budget. Replay contains only rounded display coordinates and visibility; counts and measurements use the original full-precision landmarks. Angle timelines remain capped at 300 values.

### Admission, cleanup and errors

One slot covers upload reception, multipart parsing, validation, inference and response generation. A simultaneous request receives **503**, `ANALYSIS_BUSY`, and `Retry-After: 10`. It is not queued. Health checks and static frontend assets remain accessible. The slot is released on success, rejection, disconnect, timeout or an inference exception; browser cancellation does not prematurely release a slot while native analysis is still running.

Unnamed request buffers are closed on all paths. Named analysis uploads are closed before OpenCV opens them and unlinked after success or failure. Captures and landmarkers are released in `finally` blocks. Cleanup failures are logged without replacing the original error. Startup and subsequent admitted uploads sweep only old `pulseai-upload-*.video` files in the dedicated directory, excluding symlinks and unrelated files. Process termination can leave a named file until the next sweep; this is not durable video storage.

API rejections use `{ "detail": { "code": "...", "message": "..." } }`. Examples: `UPLOAD_TOO_LARGE` (413), `INVALID_VIDEO`, `VIDEO_DURATION`, `VIDEO_DIMENSIONS`, `VIDEO_FRAME_LIMIT`, `EXERCISE_UNCLEAR` (422), `ANALYSIS_BUSY`/`VIDEO_SERVICE_UNAVAILABLE` (503), `UPLOAD_TIMEOUT` (408), and `ANALYSIS_TIMEOUT` (504). Unexpected failures return `ANALYSIS_FAILED` (500) without Python exception text or paths. Application diagnostics record exception type and stack locations, not exception messages, original filenames, videos or landmarks. Native OpenCV/MediaPipe libraries may emit their own runtime diagnostics.

The Trainer shows actual known request stages: uploading, then upload sent/server validation and analysis, then completion or error. It does not invent percentages or claim frame-level progress. It prevents repeated submissions, cancels its request on unmount, revokes replaced video URLs, and keeps the selected clip and previous successful report when a reanalysis fails. Changing to a different selected video clears its old report to avoid mismatching footage and measurements.

### Remaining hosting risks

The analysis budget is cooperative: it cannot interrupt a single stuck native decoder/inference call or prevent a native-process crash. Dimension metadata is checked before decode, but a malicious decoder allocation can occur before post-decode validation. Hard isolation would require a separate process and remains outside this task. There is no per-IP rate limiter or global multi-instance admission control. A user can repeatedly occupy the one slot; hosting memory, cold starts, proxy limits and real CPU throughput still need deployment-specific testing. The existing Docker image also includes optional food-model dependencies even though those endpoints are disabled in demo mode. These changes do not guarantee an arbitrary free host can run MediaPipe within its memory limit.

BodyM/body-composition research, model files and attribution notes are not included in this clean portfolio release. They remain preserved separately in the original private project; this release has no inherited Git history. No application endpoint or startup operation requires those assets. Shared MediaPipe/OpenCV/NumPy dependencies and the pose landmarker bundle remain required for workout CV. No authentication or per-user storage is introduced.

## Computer vision evaluation

See the [CV evaluation guide](evaluation/README.md) for annotation conventions, the existing CV data flow, offline commands, metrics, failure handling and balanced exercise summaries. Evaluation calls the existing service directly without the API or SQLite. The committed manifest is empty and benchmark results are unfilled; synthetic regression tests are not real-world accuracy evidence. Keep real videos, private manifests and generated reports in the ignored evaluation directories.


### Excluded legacy data

The public CV demo does not require nutrition catalogues. Nutrition datasets and both unverified recorded pull-up fixtures are excluded from Git and Docker. Removed export copies were preserved separately outside the release directory; backups are not part of this release.

In private mode, catalogue search, status and meal calculation return HTTP 503 with `NUTRITION_CATALOGUE_UNAVAILABLE` if catalogue files are missing or invalid. No replacement nutrition values are fabricated. Optional private nutrition use requires separately provisioned, reviewed catalogue data. Nutrition unit tests use explicitly synthetic temporary records; pull-up regression cases use independently generated geometry rather than recorded coordinates. Public demo mode continues to block nutrition endpoints with HTTP 403.
