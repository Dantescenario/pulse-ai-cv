"""Offline runner: python -m backend.evaluation.run --help (from repo root)."""
import argparse
import csv
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import time

from .manifest import EXERCISES, count, load_manifest, video_path
from .metrics import sample_metrics, summarize

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(1024 * 1024):
            result.update(block)
    return result.hexdigest()


def native_inference(path, exercise, limits):
    # The existing service uses backend-local imports. No main/database import.
    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    from services.video_analysis_service import analyze_video
    return analyze_video(str(path), exercise=exercise, fps_skip=2, limits=limits)


def evaluate(manifest, root, limits, mode='auto', infer=None):
    if mode not in ('auto', 'labelled'):
        raise ValueError('mode must be auto or labelled')
    infer = infer or native_inference
    rows = []
    for annotation in manifest['samples']:
        row = {**annotation, 'mode': mode, 'recognition_evaluated': mode == 'auto',
               'status': 'pending', 'error_code': None, 'predicted_reps': None,
               'predicted_exercise': None, 'predicted_rep_intervals': [], 'video_sha256': None,
               'elapsed_seconds': None, 'tracking_coverage': None, 'recognition_diagnostics': None}
        started = time.perf_counter()
        try:
            path = video_path(annotation, root)
            if path is None or not path.is_file():
                row.update(status='missing_video', error_code='MISSING_VIDEO')
            elif mode == 'labelled' and annotation['exercise'] is None:
                row.update(status='missing_exercise_label', error_code='MISSING_EXERCISE_LABEL')
            elif path.stat().st_size > limits.upload_bytes:
                row.update(status='rejected', error_code='UPLOAD_TOO_LARGE')
            else:
                row['video_sha256'] = digest(path)
                result = infer(path, 'auto' if mode == 'auto' else annotation['exercise'], limits)
                if not isinstance(result, dict):
                    row.update(status='invalid_prediction', error_code='INVALID_PREDICTION')
                else:
                    detection = result.get('exercise_detection')
                    if isinstance(detection, dict):
                        row['recognition_diagnostics'] = detection.get('diagnostics')
                    prediction = result.get('reps_completed')
                    label = result.get('exercise')
                    row.update(status='ok', predicted_reps=prediction if count(prediction) else None,
                               count_prediction_issue=None if count(prediction) else 'missing' if prediction is None else 'invalid',
                               predicted_exercise=(label if isinstance(label, str) and label in EXERCISES else None if label is None else '__invalid__') if mode == 'auto' else None)
                    coverage = result.get('tracking_coverage')
                    if type(coverage) in (int, float) and 0 <= coverage <= 1:
                        row['tracking_coverage'] = coverage
                    details = result.get('rep_details', [])
                    if isinstance(details, list):
                        for rep in details:
                            if not isinstance(rep, dict):
                                continue
                            start, end = rep.get('start_time'), rep.get('end_time')
                            if all(type(v) in (int, float) for v in (start, end)) and 0 <= start < end < float('inf'):
                                row['predicted_rep_intervals'].append({'start_seconds': start, 'end_seconds': end})
        except Exception as error:
            # Do not export arbitrary exception messages or private absolute paths.
            code = getattr(error, 'code', None)
            row['recognition_diagnostics'] = getattr(error, 'recognition_diagnostics', None)
            row.update(status='rejected' if isinstance(code, str) else 'inference_error',
                       error_code=code if isinstance(code, str) else type(error).__name__)
        row['elapsed_seconds'] = round(time.perf_counter()-started, 6)
        row.update(sample_metrics(row))
        rows.append(row)
    return rows


def provenance(manifest_path, limits, mode):
    versions = {}
    for package in ('mediapipe', 'opencv-contrib-python', 'numpy'):
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    try:
        commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True,
                                text=True, check=True, timeout=5).stdout.strip()
        dirty = bool(subprocess.run(['git', 'status', '--porcelain'], cwd=ROOT, capture_output=True,
                                    text=True, check=True, timeout=5).stdout)
    except (OSError, subprocess.SubprocessError):
        commit, dirty = None, None
    sources = ['backend/services/video_analysis_service.py', 'backend/services/rep_counter.py',
               'backend/services/exercise_detection.py', 'frontend/src/utils/repConfig.json', 'backend/video_limits.py',
               'backend/evaluation/run.py', 'backend/evaluation/metrics.py', 'backend/evaluation/manifest.py']
    hashes = {name: digest(ROOT / name) for name in sources}
    pose = BACKEND / 'pose_landmarker.task'
    return {'created_utc': datetime.now(timezone.utc).isoformat(), 'mode': mode, 'fps_skip': 2,
            'python': platform.python_version(), 'platform': platform.platform(), 'packages': versions,
            'git_commit': commit, 'git_dirty': dirty, 'source_sha256': hashes,
            'manifest_sha256': digest(manifest_path), 'pose_model_sha256': digest(pose) if pose.is_file() else None,
            'limits': {key: value for key, value in asdict(limits).items() if key != 'temp_dir'}}


def export_results(directory, rows, report):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    # Do not overwrite previous runs: choose a fresh directory for each evaluation.
    json_path, csv_path = directory / 'results.json', directory / 'samples.csv'
    if json_path.exists() or csv_path.exists():
        raise ValueError('Output directory already contains evaluation results; choose a fresh directory')
    fields = ['video_id', 'mode', 'exercise', 'ground_truth_reps', 'predicted_exercise', 'predicted_reps',
              'status', 'error_code', 'count_prediction_status', 'count_prediction_issue', 'absolute_count_error',
              'relative_count_error', 'exact_count', 'recognition_correct', 'recognition_evaluated', 'camera_view', 'elapsed_seconds',
              'tracking_coverage', 'video_sha256', 'repetitions', 'predicted_rep_intervals', 'recognition_diagnostics']
    with json_path.open('x', encoding='utf-8') as stream:
        json.dump({**report, 'samples': rows}, stream, indent=2, allow_nan=False)
        stream.write('\n')
    with csv_path.open('x', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            writer.writerow({**row, 'repetitions': json.dumps(row['repetitions']),
                             'predicted_rep_intervals': json.dumps(row['predicted_rep_intervals']),
                             'recognition_diagnostics': json.dumps(row.get('recognition_diagnostics'))})


def main(argv=None):
    parser = argparse.ArgumentParser(description='Evaluate existing PulseAI CV without API or database access.')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--video-root', type=Path, help='Base for relative video paths; defaults to manifest directory')
    parser.add_argument('--output-dir', type=Path, help='New local report directory; required unless validating only')
    parser.add_argument('--mode', choices=('auto', 'labelled'), default='auto')
    parser.add_argument('--validate-only', action='store_true', help='Validate annotations without loading videos or CV dependencies')
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        if args.validate_only:
            print(f'Valid manifest: {len(manifest["samples"])} samples; no inference performed.')
            return 0
        if args.output_dir is None:
            parser.error('--output-dir is required for evaluation')
        if (args.output_dir / 'results.json').exists() or (args.output_dir / 'samples.csv').exists():
            raise ValueError('Choose a fresh output directory; previous results will not be overwritten')
        if str(BACKEND) not in sys.path:
            sys.path.insert(0, str(BACKEND))
        from video_limits import VideoLimits
        limits = VideoLimits.from_env()
        run = provenance(args.manifest, limits, args.mode)
        rows = evaluate(manifest, args.video_root or args.manifest.parent, limits, args.mode)
        report = {'schema_version': 1, 'dataset_name': manifest['dataset_name'], 'run': run, 'metrics': summarize(rows)}
        export_results(args.output_dir, rows, report)
        failed = sum(r['status'] != 'ok' or r['count_prediction_status'] != 'valid' or
                     (r['recognition_evaluated'] and r['predicted_exercise'] not in EXERCISES) for r in rows)
        print(f'Evaluated {len(rows)} samples; {failed} failed/invalid predictions. See results.json and samples.csv.')
        return 1 if failed else 0
    except (ValueError, OSError) as error:
        print(f'Evaluation configuration error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
