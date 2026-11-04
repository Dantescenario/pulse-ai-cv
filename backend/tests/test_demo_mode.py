"""HTTP policy tests use mocked CV inference and never access application data."""
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import main
from demo_mode import DEMO_ERROR, demo_mode_enabled


class PortfolioDemoTests(unittest.TestCase):
    def setUp(self):
        self.mode = patch.object(main.app.state, 'demo_mode', True)
        self.mode.start()
        self.addCleanup(self.mode.stop)
        self.init = patch.object(main, 'init_db', side_effect=AssertionError('Demo must not initialize DB'))
        self.init.start()
        self.addCleanup(self.init.stop)
        # Catch accidental handler execution, not just successful response codes.
        for module in (main, sys.modules['plan_routes'], sys.modules['diary_routes']):
            guard = patch.object(module, 'get_connection', side_effect=AssertionError('Demo must not access DB'))
            guard.start()
            self.addCleanup(guard.stop)
        self.client = TestClient(main.app)

    def test_startup_and_cv_handler_do_not_read_nutrition_catalogues(self):
        from services import nutrition_service
        fake = types.ModuleType('services.video_analysis_service')
        fake.EXERCISE_CONFIG = {'squats': {}}
        fake.analyze_video = Mock(return_value={'reps_completed': 2, 'exercise': 'squats'})
        with patch.object(nutrition_service, 'catalogue', side_effect=AssertionError('CV accessed nutrition data')), \
             patch.dict(sys.modules, {'services.video_analysis_service': fake}):
            with self.client as client:
                self.assertEqual(client.get('/api/health').status_code, 200)
                response = client.post('/api/workouts/analyze-video',
                                       files={'file': ('synthetic.mp4', b'synthetic HTTP test bytes', 'video/mp4')},
                                       data={'exercise': 'squats'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['reps_completed'], 2)
                self.assertEqual(client.get('/api/nutrition/foods').status_code, 403)
        fake.analyze_video.assert_called_once()

    def test_default_and_explicit_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(demo_mode_enabled())
        for value, expected in [('true', True), (' TRUE ', True), ('false', False)]:
            with patch.dict(os.environ, PULSEAI_DEMO_MODE=value):
                self.assertEqual(demo_mode_enabled(), expected)
        with patch.dict(os.environ, PULSEAI_DEMO_MODE='flase'):
            with self.assertRaises(ValueError):
                demo_mode_enabled()

    def test_health_and_demo_startup_do_not_access_database(self):
        with self.client as client:
            response = client.get('/api/health')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['status'], 'healthy')
            self.assertTrue(response.json()['demo_mode'])

    def test_every_non_cv_api_rejects_before_validation_or_handler(self):
        tested = set()
        # OpenAPI includes nested/deferred routers across supported FastAPI versions.
        for path, operations in main.app.openapi()['paths'].items():
            if not path.startswith('/api/') or path in ('/api/health', '/api/workouts/analyze-video'):
                continue
            path = path.replace('{log_id}', '1').replace('{plan_id}', '1')
            for method in operations:
                if method.upper() not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'):
                    continue
                with self.subTest(method=method, path=path):
                    response = self.client.request(method, path, content=b'not valid JSON', headers={'Content-Type': 'application/json'})
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.json(), DEMO_ERROR)
                    tested.add(path)
        for expected in ('/api/profile', '/api/workouts', '/api/workout-comparisons', '/api/analytics',
                         '/api/diary', '/api/plans', '/api/nutrition', '/api/coach/chat'):
            self.assertIn(expected, tested)

    def test_trailing_slashes_and_unknown_api_are_fail_closed(self):
        for path in ('/api/profile/', '/api/plans/1/runs/', '/api/new-personal-feature', '/api'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json(), DEMO_ERROR)

    def test_video_upload_reaches_cv_handler_and_cleans_up(self):
        fake = types.ModuleType('services.video_analysis_service')
        fake.EXERCISE_CONFIG = {'curls': {}}
        def analyze(path, exercise, fps_skip, limits):
            self.assertEqual(Path(path).read_bytes(), b'test clip')
            self.assertEqual(exercise, 'curls')
            self.assertEqual(fps_skip, 2)
            return {'reps_completed': 2, 'exercise': exercise, 'rep_details': []}
        fake.analyze_video = Mock(side_effect=analyze)
        with patch.dict(sys.modules, {'services.video_analysis_service': fake}):
            response = self.client.post('/api/workouts/analyze-video',
                                        files={'file': ('clip.mp4', b'test clip', 'video/mp4')}, data={'exercise': 'curls'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['reps_completed'], 2)
        self.assertFalse(Path(fake.analyze_video.call_args.args[0]).exists())

    def test_missing_video_is_validation_error_not_demo_denial(self):
        self.assertEqual(self.client.post('/api/workouts/analyze-video').status_code, 422)

    def test_private_mode_restores_routes_and_startup(self):
        with patch.object(main.app.state, 'demo_mode', False), patch.object(main, 'init_db') as initialize:
            with self.client as client:
                self.assertFalse(client.get('/api/health').json()['demo_mode'])
                # Invalid payload reaches normal validation instead of demo policy.
                self.assertEqual(client.post('/api/profile', json={}).status_code, 422)
            initialize.assert_called_once_with()

    def test_import_and_demo_startup_never_open_sqlite(self):
        script = """
import sqlite3
def forbidden(*args, **kwargs):
    raise AssertionError('Database opened during demo import/startup')
sqlite3.connect = forbidden
import main
main.startup()
assert main.health()['demo_mode'] is True
"""
        result = subprocess.run([sys.executable, '-B', '-c', script],
                                cwd=Path(__file__).resolve().parents[1],
                                env={**os.environ, 'PULSEAI_DEMO_MODE': 'true'}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
