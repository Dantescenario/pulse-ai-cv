"""Bounded upload/processing tests. Mock inference does not establish CV accuracy."""
import asyncio
from dataclasses import replace
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import main
from video_limits import (VideoLimits, VideoRejected, VideoUploadMiddleware, CHUNK_SIZE,
                          MULTIPART_OVERHEAD, cleanup_stale, copy_upload, remove_temp)


class UploadTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.directory = Path(folder.name)
        self.limits = VideoLimits(upload_bytes=1024, temp_dir=folder.name)
        for context in (patch.object(main.app.state, 'video_limits', self.limits),
                        patch.object(main.app, 'middleware_stack', None)):
            context.start()
            self.addCleanup(context.stop)
        entry = next(m for m in main.app.user_middleware if m.cls is VideoUploadMiddleware)
        context = patch.dict(entry.kwargs, limits=self.limits)
        context.start()
        self.addCleanup(context.stop)
        self.fake = types.ModuleType('services.video_analysis_service')
        self.fake.EXERCISE_CONFIG = {'curls': {}}
        self.fake.analyze_video = Mock(return_value={'reps_completed': 2, 'rep_details': []})
        context = patch.dict(sys.modules, {'services.video_analysis_service': self.fake})
        context.start()
        self.addCleanup(context.stop)
        self.client = TestClient(main.app)

    def post(self, content=b'video', **kwargs):
        return self.client.post('/api/workouts/analyze-video',
                                files={'file': ('untrusted.name', content, 'application/octet-stream')},
                                data={'exercise': 'curls'}, **kwargs)

    def assert_clean(self):
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_file_limit_rejects_and_removes_partial_file(self):
        response = self.post(b'x' * 1025)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['detail']['code'], 'UPLOAD_TOO_LARGE')
        self.fake.analyze_video.assert_not_called()
        self.assert_clean()
        self.assertEqual(self.post().status_code, 200)  # admission was released

    def test_large_content_length_rejected_before_analysis(self):
        response = self.client.post('/api/workouts/analyze-video', content=b'',
                                    headers={'Content-Length': str(1024 + MULTIPART_OVERHEAD + 1)})
        self.assertEqual(response.status_code, 413)
        self.fake.analyze_video.assert_not_called()
        self.assert_clean()

    def test_success_and_failure_cleanup_and_safe_errors(self):
        self.assertEqual(self.post().status_code, 200)
        path = self.fake.analyze_video.call_args.args[0]
        self.assertFalse(Path(path).exists())
        self.fake.analyze_video.side_effect = RuntimeError('/private/person-name/video SECRET')
        with self.assertLogs('video_limits', level='ERROR') as captured:
            response = self.post()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()['detail']['code'], 'ANALYSIS_FAILED')
        self.assertNotIn('SECRET', response.text)
        self.assertNotIn('SECRET', '\n'.join(captured.output))
        self.assert_clean()
        self.fake.analyze_video.side_effect = None
        self.assertEqual(self.post().status_code, 200)

    def test_known_validation_failure_is_stable(self):
        self.fake.analyze_video.side_effect = VideoRejected('INVALID_VIDEO', 'Cannot decode this video.')
        response = self.post()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail']['code'], 'INVALID_VIDEO')
        self.assert_clean()

    def test_only_one_request_admitted_and_failure_releases_slot(self):
        entered, finish = threading.Event(), threading.Event()
        def hold(*args, **kwargs):
            entered.set()
            if not finish.wait(5):
                raise AssertionError('Test failed to release request')
            raise VideoRejected('INVALID_VIDEO', 'Cannot decode this video.')
        self.fake.analyze_video.side_effect = hold
        # Initialize middleware before issuing requests from different threads.
        self.client.get('/api/health')
        with ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(self.post)
            try:
                self.assertTrue(entered.wait(5))
                busy = self.post()
                self.assertEqual(busy.status_code, 503)
                self.assertEqual(busy.json()['detail']['code'], 'ANALYSIS_BUSY')
                self.assertEqual(busy.headers['Retry-After'], '10')
                self.assertEqual(self.client.get('/api/health').status_code, 200)
            finally:
                finish.set()
            self.assertEqual(first.result(timeout=5).status_code, 422)
        self.fake.analyze_video.side_effect = None
        self.assertEqual(self.post().status_code, 200)
        self.assert_clean()

    def test_copy_uses_bounded_reads(self):
        class Source(io.BytesIO):
            def read(self, size=-1):
                self.test.assertEqual(size, CHUNK_SIZE)
                return super().read(size)
        source = Source(b'video')
        source.test = self
        target = io.BytesIO()
        copy_upload(source, target, self.limits)
        self.assertEqual(target.getvalue(), b'video')

    def test_storage_failure_is_safe_and_admission_recovers(self):
        with patch('video_limits.prepare_temp_dir', side_effect=OSError('PRIVATE path')):
            with self.assertLogs('video_limits', level='ERROR'):
                response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail']['code'], 'VIDEO_STORAGE_UNAVAILABLE')
        self.assertNotIn('PRIVATE', response.text)
        self.assertEqual(self.post().status_code, 200)

    def test_empty_and_invalid_multipart_release_admission(self):
        response = self.post(b'')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail']['code'], 'INVALID_VIDEO')
        missing = self.client.post('/api/workouts/analyze-video')
        self.assertEqual(missing.status_code, 422)
        self.assertEqual(self.post().status_code, 200)
        self.assert_clean()


class AdmissionStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_chunked_body_limit_does_not_trust_length(self):
        for claimed in ([], [(b'content-length', b'1')]):
            with self.subTest(headers=claimed), tempfile.TemporaryDirectory() as directory:
                called = []
                async def app(scope, receive, send):
                    called.append(True)
                middleware = VideoUploadMiddleware(app, VideoLimits(upload_bytes=1, temp_dir=directory))
                messages, received = [], 0
                async def receive():
                    nonlocal received
                    received += 1
                    return {'type': 'http.request', 'body': b'x' * 4096, 'more_body': True}
                async def send(message):
                    messages.append(message)
                await middleware({'type': 'http', 'path': '/api/workouts/analyze-video',
                                  'method': 'POST', 'headers': claimed}, receive, send)
                self.assertEqual(messages[0]['status'], 413)
                self.assertEqual(received, 17)
                self.assertFalse(called)
                self.assertFalse(middleware.slot.locked())
                self.assertEqual(list(Path(directory).iterdir()), [])

    async def test_disconnect_and_timeout_release_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            async def app(*args):
                raise AssertionError('Incomplete uploads must not reach app')
            middleware = VideoUploadMiddleware(app, VideoLimits(temp_dir=directory, upload_seconds=.01))
            scope = {'type': 'http', 'path': '/api/workouts/analyze-video', 'method': 'POST', 'headers': []}
            messages = []
            async def send(message):
                messages.append(message)
            async def disconnect():
                return {'type': 'http.disconnect'}
            await middleware(scope, disconnect, send)
            self.assertFalse(middleware.slot.locked())
            async def slow():
                await asyncio.sleep(1)
            await middleware(scope, slow, send)
            self.assertEqual(messages[0]['status'], 408)
            self.assertFalse(middleware.slot.locked())
            self.assertEqual(list(Path(directory).iterdir()), [])


class LifecycleTests(unittest.TestCase):
    def test_stale_cleanup_only_removes_owned_old_uploads(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            old = directory / 'pulseai-upload-old.video'
            recent = directory / 'pulseai-upload-recent.video'
            other = directory / 'unrelated.video'
            for path in (old, recent, other):
                path.write_bytes(b'test')
            os.utime(old, (1, 1))
            cleanup_stale(VideoLimits(temp_dir=folder))
            self.assertFalse(old.exists())
            self.assertTrue(recent.exists())
            self.assertTrue(other.exists())

    def test_cleanup_failure_does_not_raise_or_log_filename(self):
        with patch.object(Path, 'unlink', side_effect=OSError('secret name')):
            with self.assertLogs('video_limits', level='ERROR') as captured:
                remove_temp('/private/secret-name')
        self.assertNotIn('secret name', '\n'.join(captured.output))

    def test_limit_configuration(self):
        with patch.dict(os.environ, PULSEAI_VIDEO_MAX_UPLOAD_BYTES='1234'):
            self.assertEqual(VideoLimits.from_env().upload_bytes, 1234)
        with patch.dict(os.environ, PULSEAI_VIDEO_MAX_UPLOAD_BYTES='0'):
            with self.assertRaises(ValueError):
                VideoLimits.from_env()


if __name__ == '__main__':
    unittest.main()
