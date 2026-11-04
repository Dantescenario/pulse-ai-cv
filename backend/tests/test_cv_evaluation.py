"""Synthetic annotations/predictions for metric and runner mechanics, not CV accuracy."""
import csv
from dataclasses import replace
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'backend'))
from backend.evaluation.manifest import EXERCISES, load_manifest, validate_manifest, video_path
from backend.evaluation.metrics import counting, recognition, sample_metrics, summarize
from backend.evaluation.run import evaluate, export_results, main
from video_limits import VideoLimits, VideoRejected


def sample(**changes):
    return dict(dict(video_id='synthetic_test_only', video_path='clip.mp4', exercise='squats', ground_truth_reps=3,
                repetitions=[], timestamps_complete=False, camera_view='side', quality_notes='Synthetic unit test fixture',
                tracking_difficulties=[], annotation_source='Synthetic unit test; not real annotation'), **changes)


def manifest(samples=None):
    return {'schema_version': 1, 'dataset_name': 'synthetic unit tests only', 'samples': [] if samples is None else samples}


def prediction(truth=3, predicted=3, exercise='squats', label='squats', status='ok', **extra):
    return {'ground_truth_reps': truth, 'predicted_reps': predicted, 'exercise': exercise,
            'predicted_exercise': label, 'status': status, **extra}


class EvaluationMetricTests(unittest.TestCase):
    def test_exact_count(self):
        result = counting([prediction()])
        self.assertEqual(result['mae_on_valid_predictions'], 0)
        self.assertEqual(result['exact_count_accuracy'], 1)
        self.assertEqual(result['ground_truth_repetitions'], 3)
        self.assertEqual(result['predicted_repetitions_on_valid_pairs'], 3)

    def test_absolute_relative_over_and_under(self):
        rows = [prediction(4, 6), prediction(4, 2), prediction(4, 4)]
        self.assertEqual(sample_metrics(rows[0])['absolute_count_error'], 2)
        self.assertEqual(sample_metrics(rows[0])['relative_count_error'], .5)
        result = counting(rows)
        self.assertAlmostEqual(result['mae_on_valid_predictions'], 4/3)
        self.assertAlmostEqual(result['exact_count_accuracy'], 1/3)
        self.assertAlmostEqual(result['overcount_rate_on_valid_predictions'], 1/3)
        self.assertAlmostEqual(result['undercount_rate_on_valid_predictions'], 1/3)

    def test_missing_invalid_and_failed_are_not_zero_predictions(self):
        rows = [prediction(), prediction(predicted=None), prediction(predicted=-1), prediction(status='rejected')]
        result = counting(rows)
        self.assertEqual(result['valid_predictions'], 1)
        self.assertEqual(result['missing_predictions'], 1)
        self.assertEqual(result['invalid_predictions'], 1)
        self.assertEqual(result['failed_predictions'], 1)
        self.assertEqual(result['prediction_coverage'], .25)
        self.assertEqual(result['exact_count_accuracy'], .25)
        self.assertEqual(result['mae_on_valid_predictions'], 0)
        self.assertIsNone(sample_metrics(rows[1])['absolute_count_error'])
        for bad in (True, 3.0, float('nan'), '3'):
            self.assertEqual(counting([prediction(predicted=bad)])['invalid_predictions'], 1)

    def test_zero_ground_truth_relative_error_is_undefined(self):
        result = counting([prediction(0, 2)])
        self.assertEqual(result['mae_on_valid_predictions'], 2)
        self.assertEqual(result['overcount_rate_on_valid_predictions'], 1)
        self.assertIsNone(result['mean_relative_count_error'])
        self.assertEqual(result['relative_error_samples'], 0)

    def test_missing_ground_truth_is_excluded(self):
        result = summarize([prediction(truth=None, exercise=None)])
        self.assertEqual(result['overall']['counting']['annotated_samples'], 0)
        self.assertIsNone(result['overall']['recognition']['accuracy'])
        self.assertEqual(result['overall']['recognition']['annotated_samples'], 0)

    def test_recognition_precision_recall_f1_and_confusion(self):
        rows = [prediction(), prediction(label='pushups'), prediction(exercise='pushups', label='pushups')]
        result = recognition(rows)
        self.assertAlmostEqual(result['accuracy'], 2/3)
        squats, pushups = result['per_class']['squats'], result['per_class']['pushups']
        self.assertEqual(squats['precision'], 1)
        self.assertEqual(squats['recall'], .5)
        self.assertAlmostEqual(squats['f1'], 2/3)
        self.assertEqual(pushups['precision'], .5)
        self.assertEqual(pushups['recall'], 1)
        self.assertEqual(result['confusion_matrix']['counts']['squats']['pushups'], 1)

    def test_failed_missing_and_invalid_recognition_are_false_negatives(self):
        result = recognition([prediction(label=None), prediction(label=[]), prediction(status='rejected')])
        self.assertEqual(result['accuracy'], 0)
        self.assertEqual(result['per_class']['squats']['false_negative'], 3)
        for column in ('__missing__', '__invalid__', '__failed__'):
            self.assertEqual(result['confusion_matrix']['counts']['squats'][column], 1)

    def test_labelled_counter_mode_never_scores_recognition(self):
        result = recognition([prediction(recognition_evaluated=False)])
        self.assertIsNone(result['accuracy'])
        self.assertEqual(result['annotated_samples'], 0)

    def test_macro_scores_do_not_hide_minority_exercise(self):
        rows = [prediction()] * 9 + [prediction(truth=3, predicted=0, exercise='lunges', label='squats')]
        result = summarize(rows)
        self.assertEqual(result['overall']['counting']['exact_count_accuracy'], .9)
        self.assertEqual(result['macro_by_exercise']['exact_count_accuracy'], .5)
        self.assertEqual(result['macro_by_exercise']['mae_on_valid_predictions'], 1.5)
        self.assertEqual(result['overall']['recognition']['macro_recall'], .5)
        self.assertEqual(set(result['per_exercise']), set(EXERCISES))
        self.assertEqual(result['per_exercise']['lunges']['recognition']['recall'], 0)

    def test_empty_dataset_has_no_accuracy(self):
        result = summarize([])
        self.assertEqual(result['samples'], 0)
        self.assertIsNone(result['overall']['counting']['exact_count_accuracy'])
        self.assertIsNone(result['overall']['counting']['mae_on_valid_predictions'])
        self.assertIsNone(result['overall']['recognition']['accuracy'])
        self.assertIsNone(result['macro_by_exercise']['recognition_f1'])
        self.assertEqual(len(result['per_exercise']), 6)


class ManifestTests(unittest.TestCase):
    def test_metadata_only_and_partial_timing(self):
        row = sample()
        row.update(video_path=None, exercise=None, ground_truth_reps=None)
        self.assertEqual(validate_manifest(manifest([row]))['samples'][0], row)
        row = sample()
        row['repetitions'] = [{'start_seconds': 1, 'end_seconds': 2}]
        validate_manifest(manifest([row]))

    def test_bad_labels_counts_paths_and_duplicate_ids(self):
        for field, value in [('exercise', 'bench'), ('ground_truth_reps', -1), ('ground_truth_reps', True),
                             ('video_path', '../private.mp4'), ('video_path', 'C:/private.mp4'),
                             ('video_path', '/private.mp4'), ('camera_view', 'banana'), ('annotation_source', '')]:
            with self.subTest(field=field, value=value):
                row = sample()
                row[field] = value
                with self.assertRaises(ValueError):
                    validate_manifest(manifest([row]))
        with self.assertRaises(ValueError):
            validate_manifest(manifest([sample(), sample()]))

    def test_bad_timing_and_incomplete_complete_flag(self):
        for intervals in ([{'start_seconds': 2, 'end_seconds': 1}],
                          [{'start_seconds': float('nan'), 'end_seconds': 2}],
                          [{'start_seconds': 0, 'end_seconds': 2}, {'start_seconds': 1, 'end_seconds': 3}]):
            row = sample()
            row['repetitions'] = intervals
            with self.assertRaises(ValueError):
                validate_manifest(manifest([row]))
        row = sample()
        row['timestamps_complete'] = True
        with self.assertRaises(ValueError):
            validate_manifest(manifest([row]))

    def test_load_rejects_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            path.write_text('{"schema_version":1,"schema_version":1,"dataset_name":"x","samples":[]}', encoding='utf-8')
            with self.assertRaises(ValueError):
                load_manifest(path)

    def test_committed_manifests_have_no_ground_truth(self):
        self.assertEqual(load_manifest(ROOT / 'evaluation/manifest.json')['samples'], [])
        template = load_manifest(ROOT / 'evaluation/manifest.template.json')
        for row in template['samples']:
            self.assertIsNone(row['ground_truth_reps'])
            self.assertIsNone(row['exercise'])

    def test_resolved_path_stays_under_root(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(video_path(sample(), directory).is_relative_to(Path(directory)))
            row = sample()
            row['video_path'] = '../outside.mp4'
            with self.assertRaises(ValueError):
                video_path(row, directory)


class EvaluationRunnerTests(unittest.TestCase):
    def test_recognition_diagnostics_survive_failure_and_exports(self):
        diagnostics = {'rejection_reason': 'ambiguous_candidates', 'candidates': [{'exercise': 'squats', 'score': 5}]}
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'synthetic test input')
            def infer(*args):
                raise VideoRejected('EXERCISE_UNCLEAR', 'Select manually', recognition_diagnostics=diagnostics)
            rows = evaluate(manifest([sample()]), directory, VideoLimits(), infer=infer)
            self.assertEqual(rows[0]['error_code'], 'EXERCISE_UNCLEAR')
            self.assertIsNone(rows[0]['predicted_reps'])
            self.assertEqual(rows[0]['recognition_diagnostics'], diagnostics)
            export_results(directory, rows, {})
            self.assertEqual(json.loads((Path(directory)/'results.json').read_text())['samples'][0]['recognition_diagnostics'], diagnostics)
            with (Path(directory)/'samples.csv').open(newline='') as stream:
                self.assertEqual(json.loads(next(csv.DictReader(stream))['recognition_diagnostics']), diagnostics)
            self.assertEqual(VideoRejected('EXERCISE_UNCLEAR', 'Select manually', recognition_diagnostics=diagnostics).detail['recognition_diagnostics'], diagnostics)

    def test_missing_local_video_is_reported_without_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            def forbidden(*args):
                raise AssertionError('Missing file must not reach inference')
            rows = evaluate(manifest([sample()]), directory, VideoLimits(), infer=forbidden)
        self.assertEqual(rows[0]['status'], 'missing_video')
        self.assertIsNone(rows[0]['predicted_reps'])

    def test_invalid_video_and_internal_failures_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'not a real video')
            for error, expected in [(VideoRejected('INVALID_VIDEO', 'Bad video'), 'rejected'),
                                    (RuntimeError('PRIVATE filename'), 'inference_error')]:
                def infer(*args):
                    raise error
                rows = evaluate(manifest([sample()]), directory, VideoLimits(), infer=infer)
                self.assertEqual(rows[0]['status'], expected)
                self.assertNotIn('PRIVATE', json.dumps(rows))

    def test_auto_inference_never_receives_ground_truth_label(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'synthetic test input')
            def infer(path, exercise, limits):
                self.assertEqual(exercise, 'auto')
                return {'exercise': 'pushups', 'reps_completed': 2, 'rep_details': []}
            rows = evaluate(manifest([sample()]), directory, VideoLimits(), infer=infer)
        self.assertEqual(rows[0]['predicted_exercise'], 'pushups')
        self.assertEqual(sample_metrics(rows[0])['absolute_count_error'], 1)

    def test_labelled_mode_has_no_recognition_score(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'synthetic test input')
            def infer(path, exercise, limits):
                self.assertEqual(exercise, 'squats')
                return {'exercise': 'squats', 'reps_completed': 3}
            rows = evaluate(manifest([sample()]), directory, VideoLimits(), mode='labelled', infer=infer)
        self.assertIsNone(summarize(rows)['overall']['recognition']['accuracy'])
        self.assertIsNone(rows[0]['predicted_exercise'])

    def test_invalid_prediction_is_preserved_as_invalid_not_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'synthetic test input')
            rows = evaluate(manifest([sample()]), directory, VideoLimits(), infer=lambda *args: {'exercise': [], 'reps_completed': float('nan')})
        self.assertEqual(rows[0]['count_prediction_status'], 'invalid')
        self.assertIsNone(rows[0]['predicted_reps'])
        self.assertEqual(recognition(rows)['confusion_matrix']['counts']['squats']['__invalid__'], 1)
        json.dumps(rows, allow_nan=False)

    def test_file_size_limit_precedes_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'oversized test')
            rows = evaluate(manifest([sample()]), directory, replace(VideoLimits(), upload_bytes=1), infer=lambda *args: self.fail('Oversized file reached inference'))
        self.assertEqual(rows[0]['error_code'], 'UPLOAD_TOO_LARGE')

    def test_exports_and_previous_results_not_overwritten(self):
        row = sample()
        row.update(prediction())
        row.update(sample_metrics(row))
        row['predicted_rep_intervals'] = []
        with tempfile.TemporaryDirectory() as directory:
            export_results(directory, [row], {'metrics': summarize([row])})
            result = json.loads((Path(directory) / 'results.json').read_text())
            self.assertEqual(result['samples'][0]['video_id'], row['video_id'])
            with (Path(directory) / 'samples.csv').open(newline='', encoding='utf-8') as stream:
                self.assertEqual(list(csv.DictReader(stream))[0]['absolute_count_error'], '0')
            with self.assertRaises(ValueError):
                export_results(directory, [row], {})

    def test_empty_manifest_cli_outputs_null_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            with patch('sys.stdout', new=io.StringIO()):
                code = main(['--manifest', str(ROOT / 'evaluation/manifest.json'), '--output-dir', str(output)])
            self.assertEqual(code, 0)
            report = json.loads((output / 'results.json').read_text())
            self.assertIsNone(report['metrics']['overall']['recognition']['accuracy'])
            self.assertIn('source_sha256', report['run'])
            self.assertEqual(report['samples'], [])

    def test_failed_sample_does_not_stop_later_samples(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'synthetic test input')
            annotations = manifest([sample(video_id='missing', video_path=None), sample(video_id='present')])
            rows = evaluate(annotations, directory, VideoLimits(), infer=lambda *args: {'exercise': 'squats', 'reps_completed': 3})
        self.assertEqual([r['status'] for r in rows], ['missing_video', 'ok'])
        self.assertEqual(summarize(rows)['overall']['counting']['exact_count_accuracy'], .5)

    def test_failed_cli_run_exports_rows_and_returns_one(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            path.write_text(json.dumps(manifest([sample(video_path=None)])), encoding='utf-8')
            output = Path(directory) / 'output'
            with patch('sys.stdout', new=io.StringIO()), patch('sqlite3.connect', side_effect=AssertionError('Evaluation must not open SQLite')):
                code = main(['--manifest', str(path), '--output-dir', str(output)])
            self.assertEqual(code, 1)
            report = json.loads((output / 'results.json').read_text())
            self.assertEqual(report['samples'][0]['error_code'], 'MISSING_VIDEO')

    def test_invalid_manifest_cli_returns_two_without_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            path.write_text('{}', encoding='utf-8')
            with patch('sys.stderr', new=io.StringIO()):
                self.assertEqual(main(['--manifest', str(path), '--validate-only']), 2)

    def test_real_pipeline_rejects_invalid_video_without_inference_or_database(self):
        # Real OpenCV decode rejection; no real-video accuracy claim.
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'clip.mp4').write_bytes(b'not a video')
            with patch('services.video_analysis_service._create_pose_landmarker') as create, \
                 patch('sqlite3.connect', side_effect=AssertionError('Evaluation must not open SQLite')):
                rows = evaluate(manifest([sample()]), directory, VideoLimits(), mode='labelled')
            self.assertEqual(rows[0]['status'], 'rejected')
            self.assertEqual(rows[0]['error_code'], 'INVALID_VIDEO')
            create.assert_not_called()


if __name__ == '__main__':
    unittest.main()
