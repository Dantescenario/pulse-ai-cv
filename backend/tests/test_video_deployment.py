"""Verify the runtime image includes the configuration needed by video imports."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class VideoDeploymentTests(unittest.TestCase):
    def test_runtime_rep_counter_configuration(self):
        root = Path(__file__).resolve().parents[2]
        dockerfile = (root / "Dockerfile").read_text()
        self.assertIn('--workers 1', dockerfile)
        # This file is not part of Vite's dist output. It must be copied explicitly.
        self.assertIn(
            "COPY --from=frontend /build/src/utils/repConfig.json /app/frontend/src/utils/repConfig.json",
            dockerfile,
        )
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory)
            services = runtime / "backend/services"
            services.mkdir(parents=True)
            shutil.copy(root / "backend/services/rep_counter.py", services)
            config = runtime / "frontend/src/utils/repConfig.json"
            config.parent.mkdir(parents=True)
            shutil.copy(root / "frontend/src/utils/repConfig.json", config)
            exercises = json.loads(config.read_text())
            result = subprocess.run(
                [sys.executable, "-B", "-c",
                 "from services.rep_counter import CONFIG, RepCounter; "
                 "[RepCounter(key) for key in CONFIG]; print(len(CONFIG))"],
                cwd=runtime / "backend", capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(int(result.stdout.strip()), len(exercises))
