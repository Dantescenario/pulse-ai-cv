"""Removal regressions: no routes, imports or model reads in the portfolio app."""
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import main


class RemovedBodyCompositionTests(unittest.TestCase):
    def test_removed_routes_are_absent_in_private_and_demo_modes(self):
        paths = main.app.openapi()['paths']
        self.assertFalse(any(path.startswith('/api/body-composition') for path in paths))
        for demo in (True, False):
            with self.subTest(demo=demo), patch.object(main.app.state, 'demo_mode', demo):
                client = TestClient(main.app)
                for path in ('/api/body-composition/status', '/api/body-composition/analyze'):
                    response = client.request('POST' if path.endswith('analyze') else 'GET', path)
                    if demo:
                        self.assertEqual(response.status_code, 403)
                    else:
                        # An installed static frontend can return 405 for POST;
                        # without it the router returns 404. Neither is an API.
                        self.assertIn(response.status_code, (404, 405))

    def test_startup_does_not_import_research_or_read_bodym_models(self):
        script = '''
import builtins
from pathlib import Path
original_import = builtins.__import__
original_read = Path.read_text
def guarded_import(name, *args, **kwargs):
    if any(token in name for token in ('bodym', 'body_fat_model', 'body_composition_routes')):
        raise AssertionError('Removed research imported: ' + name)
    return original_import(name, *args, **kwargs)
def guarded_read(path, *args, **kwargs):
    if path.name.startswith('bodym_waist'):
        raise AssertionError('BodyM model read during startup')
    return original_read(path, *args, **kwargs)
builtins.__import__ = guarded_import
Path.read_text = guarded_read
import main
main.startup()
assert main.health()['demo_mode'] is True
assert '/api/workouts/analyze-video' in main.app.openapi()['paths']
'''
        result = subprocess.run([sys.executable, '-B', '-c', script],
                                cwd=Path(__file__).resolve().parents[1],
                                env={**os.environ, 'PULSEAI_DEMO_MODE': 'true'}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
