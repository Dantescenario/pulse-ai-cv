# PulseAI CV evaluation guide

For the first 30-video collection, follow the [recording and annotation checklist](COLLECTION.md). Local collection starts with an empty `evaluation/local/annotations.json`; planned clips are not annotations or verified consent records.

This framework evaluates the existing server-side CV pipeline offline. It does not call FastAPI endpoints, import the API application, write to SQLite, change counters, tune thresholds or upload media to an external service.

**No real-world benchmark results are included.** The committed `manifest.json` has no samples. `manifest.template.json` contains only an explicitly unannotated placeholder with null labels/counts. `results.template.json` leaves all performance results null. Tests use synthetic annotations/predictions for metric correctness; existing stored landmark fixtures are regression evidence, not a population accuracy study.

## Existing data flow

```text
local video
  -> OpenCV VideoCapture / decode and metadata validation
  -> source-frame timestamps and existing sample stride
  -> resize inference frames to longest side <= 960 pixels
  -> MediaPipe Tasks PoseLandmarker (VIDEO mode, one pose)
  -> full-precision normalized landmarks + visibility/presence
  -> optional automatic exercise recognition
  -> exercise-specific RepCounter
  -> per-rep timings, counting evidence and heuristic report
  -> evaluation adapter extracts predictions (not landmark replay data)
  -> compare with independent annotations -> JSON metrics + per-sample CSV
```

Implementation references:

- `backend/services/video_analysis_service.py`: size-independent media validation, preprocessing, pose inference, report generation and bounded replay sampling. The runner separately applies the configured file-byte limit, since it bypasses HTTP upload handling.
- `backend/services/exercise_detection.py`: runs candidate counters for six exercises and weights completed cycles by tracking coverage. Squat/lunge recognition uses leg asymmetry. Ambiguous candidates produce a rejection, not a guessed label.
- `backend/services/rep_counter.py`: server counter. `frontend/src/utils/repCounter.js` is the browser counterpart; both use `frontend/src/utils/repConfig.json`.
- `frontend/src/utils/poseEngine.js`: browser tracking wrapper. This offline runner evaluates the server pipeline, not browser camera latency or browser/runtime equivalence. Existing cross-language fixture tests remain separate.

### Pose confidence and counting

MediaPipe upload inference uses detection, presence and tracking confidence settings of 0.4. The counter then requires relevant landmarks with visibility >= 0.55 and presence >= 0.5, valid geometry and an appropriate exercise posture. Joint-angle geometry accounts for the video aspect ratio. Low-confidence/missing joints can interrupt a cycle.

The counter arms after a brief starting hold, follows an outbound movement, confirms a stable working position and requires a stable return. It checks duration, return time, exercise-specific angular excursion, posture and tracking gaps. Gaps above 0.35 seconds reset state; sustained invalid tracking beyond approximately 0.25 seconds cancels an unfinished cycle. Completed cycles must last approximately 0.65–15 seconds. See the source for the exact rules; evaluation does not alter them.

| Exercise ID | Principal tracked geometry / additional gates |
| --- | --- |
| `squats` | Hip–knee–ankle angle; starting extension, bent-knee working position and return |
| `pushups` | Shoulder–elbow–wrist angle; approximately horizontal body and shoulder–hip–ankle alignment |
| `pullups` | Shoulder–elbow–wrist angle plus shoulder rise relative to approximately stationary hands |
| `curls` | Shoulder–elbow–wrist angle; upright torso and upper arm near torso |
| `lateral_raises` | Hip–shoulder–elbow angle; upright torso, raising then lowering |
| `lunges` | Hip–knee–ankle cycle; recognition distinguishes it from squats using leg asymmetry |

Pull-ups favor the more visible arm. Other exercises select a suitable armed side; the side is locked during a movement cycle. Partial movements, incomplete starts/returns, degenerate geometry, invalid posture, insufficient excursion and tracking gaps can cause rejection. Accepted reps do not certify technique.

The final report includes counts, phase timings, extreme angles, heuristic form/stimulus scores, flaws and tracking coverage. This framework benchmarks **counts and exercise recognition only**. It does not establish the validity of hypertrophy scores, injury guidance, muscle activation, anatomy maps or technique judgments.

## Dataset layout and privacy

```text
evaluation/
  README.md
  manifest.schema.json       # structural reference
  manifest.json              # empty dataset; safe to commit
  manifest.template.json     # null/unannotated example; safe to commit
  results.template.json      # no measured results
  videos/                    # ignored local videos
  local/                     # ignored local annotation manifests
  results/                   # ignored generated run directories
backend/evaluation/
  manifest.py                # executable validation, including cross-field rules
  metrics.py                 # metrics without inference or third-party metric libraries
  run.py                     # CLI + existing-service adapter + exports/provenance
```

Actual videos can stay outside the repository: provide an explicit `--video-root`. Manifest paths are relative to that root and cannot escape it, including through symlinks. A metadata-only manifest can set `video_path` to null; attempting evaluation then produces `MISSING_VIDEO` without fabricating a prediction.

Git ignores `evaluation/videos/` contents, `evaluation/local/` and `evaluation/results/`. Docker excludes the root evaluation-data directory from the build context. These ignore rules are not anonymization and do not remove anything previously tracked. Do not put private videos elsewhere in tracked directories. Review `git status` before publishing any metadata; use pseudonymous IDs and omit names, injuries, contact information and identifying notes. Obtain permission to use footage and avoid bystanders.

## Annotation format

Copy `manifest.template.json` into `evaluation/local/annotations.json`. Use the top-level version/name/samples structure. Every sample contains:

| Field | Meaning |
| --- | --- |
| `video_id` | Unique pseudonymous ID (letters, digits, `_`, `-`) |
| `video_path` | Relative forward-slash path under `--video-root`, or null |
| `exercise` | One of the six canonical IDs, or null if not annotated |
| `ground_truth_reps` | Independently reviewed nonnegative integer, or null if unknown |
| `repetitions` | Ordered list of `{ "start_seconds": ..., "end_seconds": ... }` intervals, when available |
| `timestamps_complete` | True only if every annotated rep has an interval and the interval count matches the ground-truth total |
| `camera_view` | `front`, `side`, `rear`, `oblique`, `mixed` or `unknown` |
| `quality_notes` | Lighting, resolution, frame rate, motion blur, camera stability and exercise variation notes |
| `tracking_difficulties` | Notes about occluded joints, cropping, other people, equipment or other expected tracking challenges |
| `annotation_source` | Actual human reviewer/protocol/version or trusted dataset provenance; document permission separately |

Unknown is **null, never zero**. Zero is a real label meaning a reviewer confirmed no complete repetitions. Do not fill ground truth from the model's output or treat existing regression-fixture expectations as a newly annotated video dataset.

The runner checks unique IDs, allowed fields/labels, integer counts (not booleans/floats), safe paths and finite ordered non-overlapping timing intervals. Timestamps cannot outnumber the known count. JSON schema alone cannot express all these cross-field checks: use `--validate-only`. It does not open videos, so duration/timestamp alignment must still be reviewed by the annotator.

### How to annotate

1. Use a short clip containing one exercise and one clearly identifiable subject. Keep the clip unchanged after annotation; timestamps are relative to its first frame.
2. Select the actual exercise independently of PulseAI predictions. Record the variation and viewing angle; do not assume the interface's selected exercise is ground truth.
3. Count complete repetitions according to a written human movement protocol: start position, working position, full return. Record partial/ambiguous attempts in notes. Do not define human ground truth by copying the counter's numerical thresholds.
4. For curls, document the existing convention: alternating arm cycles count separately; simultaneous bilateral movement counts once. A completed lunge cycle on one working leg counts once. Agree on these conventions before annotation.
5. When possible, mark start/end times for each completed rep. Partial timing lists are allowed with `timestamps_complete=false`; no temporal precision/recall or event-matching score is calculated in this version.
6. Have a second reviewer check the count and label; resolve disagreements before freezing annotations. If unresolved, leave the relevant label null and retain an explanation rather than inventing certainty.
7. Record reviewer/protocol provenance, camera view, quality and occlusion difficulties. Validate the manifest before evaluating.

This is a closed-set six-exercise benchmark. Missing labels are not an "unknown exercise" class. Unsupported activities with null exercise labels are excluded from recognition metrics, so the framework cannot establish open-set rejection accuracy. Background/partial-only clips can contribute to count evaluation only when their count was independently annotated.

## Running evaluation

Run from the repository root with the existing CV virtual environment (Python 3.12 and `backend/requirements.txt`), bundled pose model and existing OpenCV/MediaPipe dependencies. No server, database, authentication, metric library or paid service is needed.

Validate the empty committed dataset without loading CV inference:

```powershell
backend/.venv/Scripts/python.exe -B -m backend.evaluation.run --manifest evaluation/manifest.json --validate-only
```

After placing consented videos in the ignored folder and writing real annotations:

```powershell
backend/.venv/Scripts/python.exe -B -m backend.evaluation.run --manifest evaluation/local/annotations.json --video-root evaluation/videos --output-dir evaluation/results/auto-run-001 --mode auto
```

Use a **fresh output directory** per run. Existing reports are not overwritten. On macOS/Linux replace the interpreter with `backend/.venv/bin/python`.

### Automatic versus labelled counting

- `--mode auto` (default) calls `analyze_video(..., exercise='auto', fps_skip=2)`. It never passes the ground-truth exercise to recognition. This evaluates the automatic end-to-end behavior; recognition rejection can prevent count output too.
- `--mode labelled` passes the annotated exercise to the existing service. This isolates counting with a known exercise. Recognition metrics are disabled, and the supplied label is not exported as a recognition prediction. Samples with no exercise label are reported as failures.

Run these as separate experiments. A labelled-mode count result must never be presented as end-to-end automatic accuracy.

The runner uses the same `PULSEAI_VIDEO_*` processing limits as the application. Limit rejections count as failed predictions; there is no silent retry with looser limits, no inferred zero count, and no automatic cropping/resizing beyond the service's existing preprocessing. Explicit environment overrides are captured in run provenance. Keep `PULSEAI_DEMO_MODE=true`; evaluation does not rely on or change that setting.

## Outputs and reproducibility

Each run exports:

- `results.json`: provenance, pooled and equal-weight exercise summaries, six exercise sections, recognition confusion matrix, and per-video annotations/predictions/errors.
- `samples.csv`: one row per video with ground truth, predictions, count errors, recognition correctness, failure code, timing intervals, coverage and elapsed time.

Provenance records UTC run time, mode, Python/platform/library versions, Git commit/dirty status, manifest hash, pose-model hash, relevant source/config hashes, configured limits and the existing frame-skip setting. Each existing in-budget video receives a streaming SHA-256 hash. Share only reviewed metadata; outputs do not contain footage or landmark samples. Runtime timing is hardware-dependent, and identical versions/hashes do not guarantee bit-for-bit native inference across all machines.

Exit codes: **0** for a completed run without prediction failures (including an empty dataset), **1** when reports were written but samples failed or predictions were missing/invalid, **2** for configuration/manifest/output errors. Poor but valid predictions do not cause a nonzero exit. Always inspect sample counts; an empty successful command is not a benchmark.

Missing files, metadata-only samples, size/media/processing-limit rejections, invalid predictions and inference exceptions remain explicit rows. Exceptions are exported as codes/types, not private paths or arbitrary exception messages. One failed sample does not stop later samples. Native decoder hangs/crashes remain an existing pipeline limitation; the analysis deadline is cooperative, not a hard process-isolation timeout.

## Metric definitions

All rates are fractions in `[0, 1]`; multiply by 100 for percentages. Empty/undefined metrics are JSON **null**, not a claimed zero-percent performance result.

### Repetition counting

For known nonnegative ground truth `g` and valid nonnegative integer prediction `p`:

- Absolute error: `|p - g|`.
- Relative error: `|p - g| / g`, only for `g > 0`. Zero-count clips still contribute to absolute error and exact/over/under counts; relative error is undefined even when both counts are zero.
- MAE: mean absolute error across valid prediction/ground-truth pairs. Named `mae_on_valid_predictions` to expose that failures are excluded.
- Exact-count accuracy: exactly matched counts divided by **all count-annotated samples**, including failed/missing/invalid predictions as incorrect.
- Conditional exact accuracy: exact matches divided by valid paired predictions, reported separately.
- Overcount/undercount rates: proportions of valid paired predictions above/below ground truth. Failures are neither overcounts nor undercounts.
- Prediction coverage: valid paired predictions divided by all count-annotated samples. Missing, invalid and failed prediction counts are also reported.

Ground-truth total covers every count-annotated sample. Predicted totals and a corresponding ground-truth total are separately reported **on valid pairs**, avoiding misleading total comparisons when predictions failed. Predictions without a ground-truth count do not enter counting scores.

A low conditional MAE with low coverage is not evidence of a reliable system. Read inclusive exact accuracy and failure counts alongside MAE.

### Exercise recognition

Only samples with an annotated supported exercise and `recognition_evaluated=true` participate.

- Accuracy: correct predictions / all recognition-eligible samples. Failed, missing and invalid predictions are incorrect.
- Per-exercise accuracy: correct predictions among clips with that true exercise. This equals that exercise's recall, rather than a one-versus-rest score inflated by true negatives.
- Precision: `TP / (TP + FP)` for each exercise.
- Recall: `TP / (TP + FN)` for each exercise.
- F1: `2TP / (2TP + FP + FN)` for each exercise.

The confusion matrix has true-exercise rows and predicted-exercise columns plus `__missing__`, `__invalid__` and `__failed__` columns. These failure columns create false negatives for the true exercise, rather than dropping samples. Clips missing ground-truth exercise labels are excluded, regardless of whether recognition returned a prediction.

For a represented exercise with no positive predictions, precision/F1 are zero. With no true samples, recall/F1 are null; precision is zero if false positives exist and otherwise null. Such exercises are not included in macro averages, and their zero support remains visible. If there are no annotated recognition labels, accuracy and macro metrics are null.

### Per-exercise and balanced summaries

Every report includes all six exercises, even if some have zero samples. Pooled metrics describe the observed sample distribution. `macro_by_exercise` gives equal weight to each represented exercise, so many squat clips cannot hide poor lunge performance.

Macro MAE averages exercise-specific valid-pair MAEs; exercises with no valid predictions cannot contribute an MAE. The report therefore also exposes the number of annotated exercises and those with valid predictions. Macro exact accuracy includes represented exercises whose predictions all failed, with zero accuracy. Recognition macro precision, recall and F1 average the classes with true support. Inspect both pooled and macro results, per-exercise sample sizes and failures.

## Adding videos and interpreting results

Add local media, append validated annotations with unique pseudonymous IDs and rerun both modes into new directories. Do not alter frozen clips without re-annotation and a new dataset/version name. Keep a separate held-out set when tuning later; changing thresholds to improve the evaluation set and then reporting that same set as unseen performance is misleading.

Record diverse participants, camera views, lighting, clothing, devices, tempo, loads, occlusion, partial attempts and exercise variants. Keep exercise representation balanced. Avoid leakage from repeated clips or the same participant across development and held-out evaluation sets; maintain private participant grouping outside published manifests if needed.

A small convenience dataset cannot establish generalization. Multiple clips of one person are not independent evidence across gym-goers. Report sample/participant coverage, annotation disagreements, excluded/missing labels, rejection rates and collection limitations. Do not present these count/recognition metrics as technique, safety or physiological validity.

## Results template

Use `results.template.json` for a future reviewed benchmark summary. Leave fields null until real, independently annotated videos have been run. Include the dataset version, run/provenance reference, mode, per-exercise sample counts, inclusive exact accuracy, MAE with coverage, recognition confusion matrix/macro scores and limitations. Unit-test output and stored regression fixtures must not populate a real-world benchmark table.

## Tests

```powershell
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests -p test_cv_evaluation.py
backend/.venv/Scripts/python.exe -B -m unittest discover -s backend/tests
```

Metric tests intentionally use synthetic records to prove arithmetic, missing-data policies and aggregation. Runner tests use temporary local files and mocked inference to test error/export behavior. These tests verify the framework, not real-video recognition/count accuracy. CV counter regression coverage is retained; deployment and upload tests cover shared configuration, single-worker operation, request limits, admission control, cleanup and safe errors. Processing tests also exercise OpenCV encoding/decoding and bounded inference behavior.

### Recorded fixture provenance

The original pull-up MP4s `data/excercise/pull up/13894900_2160_3840_30fps.mp4` and `data/excercise/pull up/15859716-uhd_3840_2160_30fps.mp4` remain preserved in the original private project, outside this clean release. Runtime and regression tests do not need these MP4s; tests use generated poses and the remaining public landmark fixtures instead.

`backend/tests/rear_pullup_landmarks.json` explicitly identifies the second recording as its source and records an expected count of four. It is retained byte-for-byte in the original private project, outside this clean release, because the source video's redistribution rights are unresolved. Its SHA-256 is `25e89410655fa65bf5abc959643e50387bb0d33b71b0b74482383aaa485d9ae0`. Runtime, tests and CI do not read or require it.

Counter and recognition tests instead use `synthetic mirrored wide-frame four pullups`, generated in `backend/tests/test_rep_counter.py` from analytic arm geometry and a deterministic four-cycle angle sequence. Mirroring and aspect correction exercise wide-frame orientation, stationary hands, shoulder rise, four-rep counting and exercise recognition. No coordinates or motion samples from the recorded rear-view fixture are used. This preserves deterministic software regression coverage, not real-video accuracy coverage. A guard test fails if the case generator attempts to read the local recorded fixture.

Source-media provenance and applicable permissions still require review before redistributing the archived original. No permission is asserted here. Earlier commits in the original private repository retain the recordings and fixture because its history has not been rewritten. This clean release does not contain that history.


The additional unverified `backend/tests/pullup_sample_landmarks.json` fixture is also excluded from this release and Docker build. Its original bytes were preserved outside the release directory. The previous two-rep portrait case is replaced by `synthetic portrait two pullups`: analytic fixed-hand arm geometry with shoulder rise, deterministic two-cycle motion, and x-coordinate conversion for a 9:16 frame. It does not reuse coordinates or motion samples from any recording. Source provenance for the archived original remains unresolved.
