import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.coach_service import chat_with_coach
from services.local_coach import retrieve
from services.food_model import load_classifier

class LocalModelTests(unittest.TestCase):
    def test_retrieval_and_unknown(self):
        self.assertEqual(retrieve('How do I squat?')[1], 'squat')
        self.assertEqual(retrieve('quantum astronomy')[1], 'unknown')

    def test_injury_overrides_exercise_match(self):
        self.assertEqual(retrieve('squat with knee pain')[1], 'injury')

    @patch('services.coach_service.get_user_context')
    @patch('requests.post', side_effect=AssertionError('Network forbidden'))
    def test_coach_is_local_and_grounded(self, post, context):
        context.return_value = {'profile': {'fitness_goal': 'Strength', 'injury_notes': ''}, 'recent_workouts': [{'reps_completed': 12}], 'recent_meals': []}
        result = chat_with_coach('squat technique')
        self.assertIn('12 reps', result['reply'])
        self.assertIn('Strength', result['reply'])
        post.assert_not_called()

    @patch('services.food_model.model_ready', return_value=False)
    def test_missing_weights_fail_without_download(self, ready):
        load_classifier.cache_clear()
        with self.assertRaisesRegex(RuntimeError, 'model missing'):
            load_classifier()
