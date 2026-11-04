# MediaPipe model provenance and release scope

Current public-release model selection: `backend/pose_landmarker.task` for uploaded-video inference and Docker's native initialization check, and `frontend/public/mediapipe/pose/pose_landmark_full.tflite` for webcam tracking. Browser Lite and Heavy are audited optional alternatives, not included in the selected public-release model set. All four binaries currently remain on disk in this local export; this documentation update does not remove, stage or publish any binary.

Verified on 2026-11-04 by downloading the official Google objects into memory and comparing their complete bytes by size and SHA-256. The bundled asset was not replaced or modified.

| Field | Verified value |
| --- | --- |
| Model | MediaPipe Pose Landmarker Lite |
| Distribution | float16, version 1 |
| Size | 5,777,746 bytes |
| SHA-256 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| Versioned URL | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task |

Google's [official pose guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) links the corresponding `float16/latest/pose_landmarker_lite.task` object. At verification time it had the same size and SHA-256 as version 1 and this repository's asset. Use the versioned URL above for reproducible provisioning, and verify the checksum before installation.

The bundle contains:

- `pose_detector.tflite`: 2,959,078 bytes; embedded identifier `blazepose_detector_eff_retina_4kp_sparse_2021_10_18`.
- `pose_landmarks_detector.tflite`: 2,818,390 bytes; embedded identifier `blazepose_ghum_39kp_lite_oss_2021_07_02`; descriptive strings include `Pose landmarks` and `Detects human pose landmarks with frontal camera.`

Those embedded dates identify model builds; they are not claimed to be the repository's download date. In the original PulseAI repository, Git first records the bundle in commit `fd3f037` on 2026-10-30; that history is not part of this clean export. No original download log or source URL was found in the repository history inspected. The checksum match establishes the current artifact's identity, not who originally downloaded it or when.

## Licensing and attribution

Google's [BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), covering Lite, Full and Heavy variants, identifies Apache License, Version 2.0 and names Google authors Valentin Bazarevsky, Ivan Grishchenko and Eduard Gabriel Bazavan. The model card is dated April 16, 2021.

The accompanying [LICENSE](LICENSE) is the unmodified Apache 2.0 text retrieved from [MediaPipe's upstream LICENSE](https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE). [NOTICE](NOTICE) is a PulseAI-authored attribution record based on the model card and checksum verification, not a claimed upstream NOTICE. No LICENSE/NOTICE entry is embedded in the two-file task archive. These files document this model; they do not assign a licence to PulseAI's own code or claim to catalogue every other bundled dependency's notices.

The backend model and browser Full model must be explicitly included when the clean repository is staged: inherited `*.task` and `*.tflite` ignore rules currently hide them. The clean export has no initial commit. Browser Lite and Heavy should remain unstaged for this release. Dependencies and inference parameters are unchanged. The model card describes pose estimation, not medically validated biomechanical measurements or guaranteed recognition/counting accuracy.


## Browser models: audited package and selected release asset

All three browser files were verified byte-for-byte against the published `@mediapipe/pose@0.5.1675469404` npm package. Its tarball's SHA-512 integrity matched the registry metadata. Verification was performed in memory; the local model binaries were not changed.

- Registry metadata: https://registry.npmjs.org/@mediapipe/pose/0.5.1675469404
- Versioned package tarball: https://registry.npmjs.org/@mediapipe/pose/-/pose-0.5.1675469404.tgz
- Each upstream tarball member is `package/` followed by the model filename below. These files belong to the browser Solutions package, not the backend Tasks float16/1 bundle; their versions and checksums must not be conflated.

| Local artifact | Release selection | Size (bytes) | SHA-256 |
| --- | --- | ---: | --- |
| `frontend/public/mediapipe/pose/pose_landmark_full.tflite` | Included in current release selection | 6,440,512 | `e9a5c5cb17f736fafd4c2ec1da3b3d331d6edbe8a0d32395855aeb2cdfd64b9f` |
| `frontend/public/mediapipe/pose/pose_landmark_lite.tflite` | Optional; not included | 2,819,824 | `f17bfbecadb61c3be1baa8b8d851cc6619c870a87167b32848ad20db306b9d61` |
| `frontend/public/mediapipe/pose/pose_landmark_heavy.tflite` | Optional; not included | 27,709,200 | `59e42d71bcd44cbdbabc419f0ff76686595fd265419566bd4009ef703ea8e1fe` |

`frontend/src/components/VisionTrainer.jsx` initializes the locally loaded `pose.js` with `modelComplexity: 1` and a local `locateFile` resolver. The package loader maps complexity 1 to Full, 0 to Lite, and 2 to Heavy. Full is therefore required by the current webcam configuration. Lite and Heavy are unnecessary for that configuration; using them later would require an explicit configuration/release decision. Their embedded identifiers are respectively `blazepose_ghum_39kp_full_oss_2021_07_02`, `blazepose_ghum_39kp_lite_oss_2021_07_02` and `blazepose_ghum_39kp_heavy_oss_2021_07_02`. Embedded build dates are not package version numbers or original download dates.

The published npm metadata specifies `Apache-2.0`, consistent with Google's model card covering Lite, Full and Heavy. Apache 2.0 permits redistribution subject to its conditions, including supplying the licence and preserving applicable notices. The existing adjacent [LICENSE](LICENSE) provides the unmodified upstream Apache 2.0 terms; it is not a blanket licence for PulseAI's own code. The existing [NOTICE](NOTICE) is preserved unchanged as a PulseAI-authored attribution record for the backend Lite bundle. This README supplements that record for the browser artifacts and preserves the Google/model-card attribution above. No separate LICENSE or NOTICE entry was found in the audited npm tarball; none is invented here.

The checksum matches establish that these are unchanged upstream artifacts, with no PulseAI-specific datasets, recordings or user data appended. They do not establish that learned weights cannot memorize upstream training data. The original local download dates and downloader identities remain undocumented.

Release-scope caveat: the optional binaries still exist locally, and Vite copies files physically present under `frontend/public` into a local build. Therefore a local build from this export can still contain Lite and Heavy despite their exclusion from the intended Git release selection. Before publication, verify the staged file list and build from that selected snapshot. This documentation-only update does not alter the model files or build behavior.
