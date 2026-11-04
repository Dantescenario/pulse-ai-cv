"""Mock native decoding/inference to verify budgets, cleanup and counter inputs."""
from dataclasses import replace
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import video_analysis_service as service
from video_limits import VideoLimits, VideoRejected
from test_rep_counter import cases


class Capture:
    def __init__(self, count=10, metadata_count=None, fps=20, width=64, height=64, metadata_width=None):
        self.count, self.position, self.fps = count, 0, fps
        self.width, self.height = width, height
        self.metadata_count = count if metadata_count is None else metadata_count
        self.metadata_width = width if metadata_width is None else metadata_width
        self.released = False
    def isOpened(self):
        return True
    def get(self, prop):
        return {service.cv2.CAP_PROP_FPS: self.fps, service.cv2.CAP_PROP_FRAME_COUNT: self.metadata_count,
                service.cv2.CAP_PROP_FRAME_WIDTH: self.metadata_width, service.cv2.CAP_PROP_FRAME_HEIGHT: self.height}[prop]
    def read(self):
        if self.position >= self.count:
            return False, None
        self.position += 1
        return True, np.zeros((self.height, self.width, 3), dtype=np.uint8)
    def release(self):
        self.released = True


class VideoProcessingTests(unittest.TestCase):
    def test_recognition_failure_retains_evidence_and_original_status(self):
        from services.exercise_detection import RecognitionUnclear
        diagnostics = {'rejection_reason': 'ambiguous_candidates', 'leading_score': 5}
        for error, expected in [(RecognitionUnclear(diagnostics), diagnostics), (ValueError('private path'), None)]:
            model, cap = Mock(), Capture()
            model.detect_for_video.return_value = SimpleNamespace(pose_landmarks=[])
            with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), \
                 patch.object(service.cv2, 'VideoCapture', return_value=cap), \
                 patch.object(service, '_create_pose_landmarker', return_value=model), \
                 patch.object(service, 'detect_exercise', side_effect=error):
                with self.assertRaises(VideoRejected) as caught:
                    service.analyze_video('video', 'auto')
            self.assertEqual(caught.exception.code, 'EXERCISE_UNCLEAR')
            self.assertEqual(caught.exception.status, 422)
            self.assertEqual(caught.exception.recognition_diagnostics, expected)
            self.assertNotIn('private', str(caught.exception.detail))
            self.assertTrue(cap.released)
            model.close.assert_called_once()

    def run_video(self, cap, limits=None, landmark=None, **kwargs):
        model = Mock()
        model.detect_for_video.return_value = SimpleNamespace(pose_landmarks=[])
        if landmark is not None:
            model.detect_for_video.side_effect = landmark
        with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), patch.object(service.cv2, 'VideoCapture', return_value=cap), \
             patch.object(service, '_create_pose_landmarker', return_value=model) as create:
            try:
                result = service.analyze_video('not-an-upload-name', 'curls', fps_skip=1,
                                               limits=limits or VideoLimits(), **kwargs)
                return result, model, create
            finally:
                self.assertTrue(cap.released)

    def assert_rejected(self, cap, code, limits=None, model_created=False):
        model = Mock()
        model.detect_for_video.return_value = SimpleNamespace(pose_landmarks=[])
        with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), patch.object(service.cv2, 'VideoCapture', return_value=cap), \
             patch.object(service, '_create_pose_landmarker', return_value=model) as create:
            with self.assertRaises(VideoRejected) as caught:
                service.analyze_video('video', 'curls', fps_skip=1, limits=limits or VideoLimits())
            self.assertEqual(caught.exception.code, code)
            self.assertTrue(cap.released)
            if not model_created:
                create.assert_not_called()
            else:
                model.close.assert_called_once()

    def test_invalid_media_and_first_frame_failure_before_inference(self):
        cap = Capture()
        cap.isOpened = lambda: False
        self.assert_rejected(cap, 'INVALID_VIDEO')
        self.assert_rejected(Capture(count=0, metadata_count=2), 'INVALID_VIDEO')
        self.assert_rejected(Capture(count=1), 'INVALID_VIDEO')
        self.assert_rejected(Capture(fps=float('nan')), 'INVALID_VIDEO')

    def test_duration_dimensions_and_frame_metadata_limits(self):
        self.assert_rejected(Capture(count=601, fps=20), 'VIDEO_DURATION')
        self.assert_rejected(Capture(metadata_width=2000), 'VIDEO_DIMENSIONS')
        self.assert_rejected(Capture(width=2000, metadata_width=64), 'VIDEO_DIMENSIONS')
        self.assert_rejected(Capture(count=10), 'VIDEO_FRAME_LIMIT', replace(VideoLimits(), processed_frames=5))

    def test_runtime_limits_cover_dishonest_metadata(self):
        # No landmark output is needed to verify runtime bounds.
        with patch.object(service, 'lm_to_dict'):
            self.assert_rejected(Capture(count=10, metadata_count=2), 'VIDEO_FRAME_LIMIT',
                                 replace(VideoLimits(), processed_frames=3), model_created=True)
            self.assert_rejected(Capture(count=25, metadata_count=2), 'VIDEO_DURATION',
                                 replace(VideoLimits(), duration_seconds=1), model_created=True)

    def test_deadline_rejects_without_truncating_results(self):
        with patch.object(service.time, 'monotonic', side_effect=[0, 61]):
            self.assert_rejected(Capture(), 'ANALYSIS_TIMEOUT')

    def test_cleanup_errors_do_not_mask_validation_error(self):
        cap = Capture(count=1)
        def fail():
            cap.released = True
            raise OSError('SECRET')
        cap.release = fail
        with self.assertLogs('video_limits', level='ERROR'):
            self.assert_rejected(cap, 'INVALID_VIDEO')

    def test_counter_results_unchanged_and_response_is_bounded(self):
        case = cases()[0]  # two complete curls, original unrounded input
        records = case['frames']
        results = [SimpleNamespace(pose_landmarks=[[SimpleNamespace(**p) for p in row['landmarks']]]) for row in records]
        full, _, _ = self.run_video(Capture(count=len(records)), landmark=iter(results))
        compact, model, _ = self.run_video(Capture(count=len(records)),
                                          limits=replace(VideoLimits(), replay_samples=12), landmark=iter(results))
        self.assertEqual(compact['reps_completed'], case['expected'])
        for key in ('rep_details', 'avg_form_score', 'total_tut_seconds', 'avg_depth_angle', 'avg_eccentric_tempo'):
            self.assertEqual(compact[key], full[key])
        self.assertLessEqual(len(compact['landmark_samples']), 12)
        self.assertEqual(compact['landmark_samples'][0]['time'], 0)
        self.assertEqual(compact['landmark_samples'][-1]['time'], round((len(records)-1)/20, 4))
        self.assertEqual(set(compact['landmark_samples'][0]['landmarks'][0]), {'x', 'y', 'visibility'})
        model.close.assert_called_once()

    def test_inference_failure_closes_all_resources(self):
        model, cap = Mock(), Capture()
        model.detect_for_video.side_effect = RuntimeError('internal failure')
        with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), patch.object(service.cv2, 'VideoCapture', return_value=cap), \
             patch.object(service, '_create_pose_landmarker', return_value=model):
            with self.assertRaises(RuntimeError):
                service.analyze_video('video', 'curls', limits=VideoLimits())
        self.assertTrue(cap.released)
        model.close.assert_called_once()

    def test_real_opencv_decode_ignores_extension_and_rejects_junk(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'clip.mp4'
            writer = service.cv2.VideoWriter(str(path), service.cv2.VideoWriter_fourcc(*'mp4v'), 20, (64, 64))
            self.assertTrue(writer.isOpened(), 'Test environment needs an MP4 encoder')
            try:
                for _ in range(10):
                    writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
            finally:
                writer.release()
            video = path.with_suffix('.video')
            path.rename(video)
            model = Mock()
            model.detect_for_video.return_value = SimpleNamespace(pose_landmarks=[])
            with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), patch.object(service, '_create_pose_landmarker', return_value=model):
                result = service.analyze_video(str(video), 'curls', limits=VideoLimits())
                self.assertEqual(result['reps_completed'], 0)
                self.assertEqual(result['total_frames'], 10)
            video.write_bytes(b'not a video')
            with patch.object(service, '_create_pose_landmarker') as create:
                with self.assertRaises(VideoRejected) as caught:
                    service.analyze_video(str(video), 'curls', limits=VideoLimits())
                self.assertEqual(caught.exception.code, 'INVALID_VIDEO')
                create.assert_not_called()

    def test_all_six_exercises_keep_original_counter_measurements(self):
        selected = cases()[:5] + [next(c for c in cases() if c['name'] == 'pullups three reps at 20 fps')]
        for case in selected:
            with self.subTest(exercise=case['exercise']):
                records = case['frames']
                model = Mock()
                model.detect_for_video.side_effect = [SimpleNamespace(pose_landmarks=[[SimpleNamespace(**p) for p in row['landmarks']]]) for row in records]
                cap = Capture(count=len(records))
                with patch.object(service, 'MEDIAPIPE_AVAILABLE', True), patch.object(service.cv2, 'VideoCapture', return_value=cap), \
                     patch.object(service, '_create_pose_landmarker', return_value=model):
                    result = service.analyze_video('video', case['exercise'], fps_skip=1,
                                                   limits=replace(VideoLimits(), replay_samples=20))
                self.assertEqual(result['reps_completed'], case['expected'])
                self.assertLessEqual(len(result['landmark_samples']), 20)


if __name__ == '__main__':
    unittest.main()
