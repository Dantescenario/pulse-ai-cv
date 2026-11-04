import unittest
from unittest.mock import patch
from types import SimpleNamespace
from test_rep_counter import cases
from services.exercise_detection import detect_exercise, RecognitionUnclear, EXERCISES


class ExerciseDetectionTests(unittest.TestCase):
    def candidates(self, reps):
        return {key: SimpleNamespace(reps=reps.get(key, 0), last_valid=0,
                                     update=lambda *args: None) for key in EXERCISES}

    def test_ranking_boundary_and_diagnostics(self):
        for second, rejected in [(3, False), (4, True), (5, True)]:
            counters = self.candidates({'squats': 5, 'lateral_raises': second, 'lunges': 5})
            with self.subTest(second=second), patch('services.exercise_detection.RepCounter', side_effect=lambda key: counters[key]):
                if rejected:
                    with self.assertRaises(RecognitionUnclear) as caught:
                        detect_exercise([(None, 0, 1)])
                    self.assertIsInstance(caught.exception, ValueError)
                    diagnostics = caught.exception.diagnostics
                    self.assertEqual(diagnostics['rejection_reason'], 'ambiguous_candidates')
                else:
                    result = detect_exercise([(None, 0, 1)])
                    self.assertEqual(result['exercise'], 'squats')
                    diagnostics = result['diagnostics']
                    self.assertIsNone(diagnostics['rejection_reason'])
                self.assertEqual(diagnostics['leading_score'], 5)
                self.assertEqual(diagnostics['runner_up_score'], second)
                self.assertEqual(diagnostics['score_margin'], 5-second)
                rows = {row['exercise']: row for row in diagnostics['candidates']}
                self.assertEqual(rows['lunges']['exclusion_reason'], 'leg_classification_mismatch')
                self.assertIsNone(rows['lunges']['score'])
                self.assertEqual(rows['pullups']['exclusion_reason'], 'no_complete_repetitions')
                self.assertEqual(rows['squats']['ranking_position'], 1)
                self.assertEqual(rows['squats']['valid_tracking_frames'], 1)
                self.assertEqual(rows['squats']['completed_repetitions'], 5)
                self.assertEqual(diagnostics['score_kind'], 'heuristic_ranking_score')
                self.assertNotIn('probability', str(diagnostics))

    def test_empty_evidence_is_serializable(self):
        import json
        with self.assertRaises(RecognitionUnclear) as caught:
            detect_exercise([])
        diagnostics = caught.exception.diagnostics
        self.assertEqual(diagnostics['rejection_reason'], 'insufficient_evidence')
        self.assertIsNone(diagnostics['leading_score'])
        self.assertIsNone(diagnostics['score_margin'])
        json.dumps(diagnostics, allow_nan=False)

    def test_supported_movements(self):
        for case in cases()[:5] + [c for c in cases() if c["name"] in ("synthetic portrait two pullups", "synthetic mirrored wide-frame four pullups")]:
            # Symmetric synthetic leg motion represents squats, even if generated for the lunge counter.
            expected = "squats" if case["exercise"] == "lunges" else case["exercise"]
            with self.subTest(exercise=case["exercise"]):
                frames = [(f["landmarks"], f["time"], case["aspect"]) for f in case["frames"]]
                self.assertEqual(detect_exercise(frames)["exercise"], expected)

    def test_missing_or_partial_motion_is_unknown(self):
        for case in [None] + cases()[5:8]:
            frames = [] if case is None else [(f["landmarks"], f["time"], 1) for f in case["frames"]]
            with self.assertRaises(ValueError):
                detect_exercise(frames)
