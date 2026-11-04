# First real CV dataset: recording and annotation checklist

**Target: 30 consented videos, five for each exercise. Collection is pending, not completed or verified.** Folders, blank logs and an empty manifest are preparation only. Five per exercise means five videos, not five repetitions. Do not run inference or populate benchmark results until real footage and independent annotations exist.

## Local organization

```text
evaluation/
  videos/                         # ignored local footage
    squats/
    pushups/
    pullups/
    curls/
    lateral_raises/
    lunges/
  local/                          # ignored private metadata
    annotations.json              # samples initially []
    collection-log.csv            # headers only; no consent assertions
  results/                        # ignored; no benchmark outputs yet
```

Suggested filename stems are `squat_001` through `squat_005`, `pushup`, `pullup`, `curl`, `lateral_raise` and `lunge`, each under its exercise folder. These are naming plans, not claims that files exist. Do not add 30 placeholder samples to the live manifest. Empty ignored folders may need to be recreated after cloning.

## Before recording

- [ ] Obtain explicit permission to record and use footage for local CV evaluation. Explain who reviews it, retention and removal requests. Permission to evaluate locally is separate from permission to publish footage; a portfolio need not publish participants' videos.
- [ ] Assign a pseudonymous participant code. Keep signed consent and identity mappings in private storage outside the public repository. Record only the reference, scope and actual confirmation in the ignored collection log.
- [ ] Obtain location permission where applicable. Exclude nonconsenting bystanders, including mirror reflections.
- [ ] Use a familiar exercise variation and comfortable normal movement. Do not increase load, force range or train to failure for filming.
- [ ] Agree on the human counting convention before inspecting PulseAI predictions. Never derive ground truth from the model's counts or thresholds.

## Common recording envelope

- One identifiable participant and one exercise per clip. Stabilize the camera; keep the angle fixed.
- Start with **720p, 30 fps, MP4** (H.264 if available), without slow motion or HDR. Avoid 4K. File extension alone does not establish decodability.
- Aim for **15–25 seconds**, including approximately two seconds at the start position and a complete final return. Annotate the actual completed repetitions, not a requested or attempted number.
- Current defaults: **10 MiB maximum**, **30 seconds maximum**, decoded width/height each at most **1920**, and **900 inference frames**. Check configuration if overridden. Export a smaller final copy before annotation if necessary; then keep that file unchanged.
- Use steady, diffuse lighting toward the participant, avoiding bright windows behind them and strong shadows on joints. Record actual lighting, rather than claiming target conditions were achieved.
- Distances below are starting points. Adjust until all relevant joints and the complete movement fit with margin, without digital zoom. Record actual distance and lens height.

## Exercise-specific checklist

Use the common lighting and 15–25-second envelope for each exercise.

| Exercise / schema ID | View, distance and lens position | Framing / difficulties to document | Human counting convention |
| --- | --- | --- | --- |
| Squats / `squats` | Side; roughly 2–3 m away, lens near hip height. Mild oblique can be a separate condition. | Show shoulders, hips, knees and feet. Note far-leg overlap or rack/bar/plates hiding joints. | One descent from the standing start and full return is one cycle. Record partial/ambiguous movements separately; do not copy model angle thresholds. |
| Push-ups / `pushups` | Side; roughly 2–3 m away, camera 0.3–0.6 m above the floor. | Show hands, elbows, shoulders, hips and ankles. Note far-arm overlap, shadows, cropping and knee/bench variants. | One lowering from the top position and full return is one cycle. Record the actual variation and agree on the working-position convention before counting. |
| Pull-ups / `pullups` | Front or mild oblique; roughly 2.5–4 m away, positioned to include bar/hands and vertical travel. | Keep hands, elbows, shoulders and hips visible. Note overhead cropping, grip, equipment obstruction and swing. | One ascent from the extended hanging start and full return is one cycle. Agree on the top-position convention; disputed clearance/returns require review. |
| Bicep curls / `curls` | Side or mild oblique; roughly 2–3 m away, lens near mid-torso height. | Show shoulders, elbows, wrists and torso/hips. Note arm overlap, weights hiding wrists and upper-arm movement. | Each working-arm flexion and full return counts once. Alternating arms count separately; simultaneous bilateral curls count once. State which convention applies. |
| Lateral raises / `lateral_raises` | Front; roughly 2.5–3.5 m away, lens near mid-torso height. | Leave room for both arms at full spread; show hips, shoulders and elbows. Note clothing obstruction and wrists/weights leaving frame. | One raising and lowering back to the start counts once. Simultaneous bilateral movement is one cycle. Document incomplete attempts and variation. |
| Lunges / `lunges` | Side or mild oblique; roughly 2.5–4 m away, lens near hip height. | Show hips, both knees and both feet throughout. Document stationary/reverse/walking variation, far-leg overlap and travel out of frame. | Each working-leg descent and full return counts once. An alternating left/right pair is two cycles. Document ambiguous transitions. |

For five clips per exercise, include more than one consented participant where feasible and reasonable documented view/lighting variation. Do not deliberately create unsafe movement or conceal joints. Do not select or replace clips based on PulseAI's performance. This is a small pilot, not evidence of generalization.

| Exercise | Target videos | Verified collected |
| --- | ---: | --- |
| Squats | 5 | Not yet verified |
| Push-ups | 5 | Not yet verified |
| Pull-ups | 5 | Not yet verified |
| Bicep curls | 5 | Not yet verified |
| Lateral raises | 5 | Not yet verified |
| Lunges | 5 | Not yet verified |

## Exact annotation fields

The manifest has exactly `schema_version` (1), `dataset_name` (nonempty) and `samples` (array). Every sample requires **all ten fields**, without extra keys:

| Field | How to fill it |
| --- | --- |
| `video_id` | Unique pseudonymous ID: letters/digits/underscore/hyphen, at most 100 characters. |
| `video_path` | Forward-slash path relative to the eventual video root, such as `squats/squat_001.mp4`, or null. Not relative to the manifest folder when using `--video-root evaluation/videos`. |
| `exercise` | Reviewed canonical exercise ID from the table, or null until identified. |
| `ground_truth_reps` | Independently observed nonnegative integer, or null while unknown/disputed. Zero is a real confirmed count, never a placeholder. |
| `repetitions` | Ordered interval objects with exactly numeric `start_seconds` and `end_seconds`, or `[]` if unavailable. |
| `timestamps_complete` | True only when all reps have intervals matching the known count; false for missing/partial timings. |
| `camera_view` | Actual `front`, `side`, `rear`, `oblique`, `mixed` or `unknown`. |
| `quality_notes` | Actual distance, lens position, lighting, duration, resolution/FPS, variation and ambiguity notes. No separate schema keys exist for these details. |
| `tracking_difficulties` | List of actual/expected visibility difficulties. Use `[]` when none observed; do not invent successful tracking or occlusions. |
| `annotation_source` | Actual reviewer code, protocol version, verification status and date. Do not claim a second review before it occurs. |

Consent and additional reviewer details belong in the separate ignored collection log; do not add unsupported keys to annotations.

### Clearly marked placeholder example

**This is not a captured or annotated video. Do not add it to the live manifest as completed work.** It is structurally valid; schema validation cannot verify the evidence behind an annotation.

```json
{
  "video_id": "PLACEHOLDER_REPLACE_AFTER_CAPTURE",
  "video_path": null,
  "exercise": null,
  "ground_truth_reps": null,
  "repetitions": [],
  "timestamps_complete": false,
  "camera_view": "unknown",
  "quality_notes": "PLACEHOLDER: replace with actual distance, lighting, duration, settings and variation",
  "tracking_difficulties": [],
  "annotation_source": "PLACEHOLDER: unannotated and unverified; replace with actual reviewer provenance"
}
```

After recording a real first squat clip, use `squat_001` and `squats/squat_001.mp4` only if that is the actual file. Fill `exercise` with `squats` after review, and replace the count with the independently verified integer. Unknown counts stay null. Replace view, notes and source with observed information. Add that real sample inside `annotations.json`'s `samples` array.

## Ground-truth verification

- [ ] Review the final saved file locally before viewing model predictions. Confirm exercise, variation, subject and consent reference.
- [ ] Watch at normal speed, then slow playback/frame-step. Count complete cycles under the agreed human convention; list partial/borderline attempts separately.
- [ ] Count what actually completed, not what was requested, attempted or recalled by the participant.
- [ ] Have a second reviewer count independently. Resolve disagreements against footage and protocol; record reviewer codes/status in the private log.
- [ ] Leave disputed labels/counts null and mark pending review. Do not fill a quota by guessing.
- [ ] For timings, use seconds from the exact saved clip's first frame. Start at the first visible departure from the agreed starting position; end at the full return completing the cycle. Apply this convention consistently, without copying model event times.
- [ ] Intervals must be finite, nonnegative, ordered, non-overlapping, inside the video, and end after start. Complete interval lists must match the count. Partial/missing lists require `timestamps_complete=false`.
- [ ] Record actual provenance, update the log and freeze the file/annotation version. Any later crop/edit requires re-annotation.

The framework supports storing rep times but does not yet score temporal event matching. Validation checks ordering/count consistency, not actual alignment with footage.

## Record and annotate the first video

1. Complete consent/location checks and assign a participant code; do not prefill confirmation.
2. Record a squat from the side with a fixed camera around 2–3 m away at hip height. Use 720p/30 fps MP4 and even light. Fit the full body/feet, include the standing start and final return, and aim for 15–25 seconds within the current file limits.
3. Save the actual final clip as `evaluation/videos/squats/squat_001.mp4`. Export a smaller copy before annotation if needed, then keep it unchanged.
4. Review/count independently using the checklist. Add one real sample to the initially empty `samples` array in `evaluation/local/annotations.json`. Enter measured timings only when available; do not invent a count or consent status.
5. Run the command below from the repository root. It performs **validation only**, with no inference or results generation.
6. Manually confirm file existence, consent and label/count/timing correctness. Then continue toward five verified clips per exercise.

```powershell
backend/.venv/Scripts/python.exe -B -m backend.evaluation.run --manifest evaluation/local/annotations.json --video-root evaluation/videos --validate-only
```

The initial honest result is **0 samples**. Expect 1 after adding a real first annotation. A valid manifest does not mean collection is complete: `--validate-only` does not open videos, verify consent, confirm ground truth or enforce the five-per-exercise quota. Null labels/counts and placeholders can pass structural validation.

Before benchmarking, manually confirm 30 distinct actual files, five reviewed clips per exercise, actual consent references and resolved ground-truth counts. Do not count duplicate takes/files twice or treat pending/null entries as completed. No inference command is needed for this preparation task.

## Privacy checks before any future publication

- Keep footage under `evaluation/videos/`, private manifests/logs under `evaluation/local/`, and generated reports under `evaluation/results/`. Existing Git ignore rules cover these locations.
- Keep signed consent/identity mappings in private access-controlled storage outside the repository. Local storage and ignore rules are not anonymization or encryption.
- Check camera/editor cloud-sharing settings against agreed use; review faces, voices and location details before any separate sharing.
- Do not force-add ignored files. Existing tracked files remain tracked despite ignore rules; inspect before publishing:

```powershell
git check-ignore evaluation/videos/squats/squat_001.mp4 evaluation/local/annotations.json evaluation/local/collection-log.csv evaluation/results/run-001/results.json
git ls-files -- evaluation/videos evaluation/local evaluation/results
git status --short
```

Only the intentional `evaluation/videos/.gitkeep` may be tracked in these local folders. If private media/metadata appears, stop publication and address it deliberately. Do not delete participant data or rewrite history automatically.

No actual videos, labels, consent assertions or benchmark results were created by preparing this checklist.
