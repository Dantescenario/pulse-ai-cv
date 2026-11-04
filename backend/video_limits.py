"""Bounded video request admission, limits and temporary storage (one worker)."""
import asyncio
from dataclasses import dataclass
import logging
import os
from pathlib import Path
import tempfile
import threading
import time
import traceback

from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)
CHUNK_SIZE = 64 * 1024
MULTIPART_OVERHEAD = 64 * 1024


@dataclass(frozen=True)
class VideoLimits:
    upload_bytes: int = 10 * 1024 * 1024
    duration_seconds: float = 30
    width: int = 1920
    height: int = 1920
    processed_frames: int = 900
    replay_samples: int = 360
    analysis_seconds: float = 60
    upload_seconds: float = 30
    stale_seconds: int = 3600
    temp_dir: str = str(Path(tempfile.gettempdir()) / 'pulseai-video')

    @classmethod
    def from_env(cls):
        names = {'upload_bytes': 'MAX_UPLOAD_BYTES', 'duration_seconds': 'MAX_DURATION_SECONDS',
                 'width': 'MAX_WIDTH', 'height': 'MAX_HEIGHT', 'processed_frames': 'MAX_PROCESSED_FRAMES',
                 'replay_samples': 'MAX_REPLAY_SAMPLES', 'analysis_seconds': 'ANALYSIS_TIMEOUT_SECONDS',
                 'upload_seconds': 'UPLOAD_TIMEOUT_SECONDS', 'stale_seconds': 'TEMP_MAX_AGE_SECONDS'}
        values = {}
        for field, suffix in names.items():
            raw = os.getenv('PULSEAI_VIDEO_' + suffix)
            if raw is not None:
                try:
                    values[field] = int(raw)
                    if values[field] <= 0:
                        raise ValueError()
                except ValueError:
                    raise ValueError('PULSEAI_VIDEO_' + suffix + ' must be a positive integer') from None
        values['temp_dir'] = os.getenv('PULSEAI_VIDEO_TEMP_DIR', cls.temp_dir)
        return cls(**values)


class VideoRejected(ValueError):
    def __init__(self, code, message, status=422, *, recognition_diagnostics=None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.recognition_diagnostics = recognition_diagnostics

    @property
    def detail(self):
        detail = {'code': self.code, 'message': self.message}
        if self.recognition_diagnostics is not None:
            detail['recognition_diagnostics'] = self.recognition_diagnostics
        return detail


def upload_too_large(limits):
    return VideoRejected('UPLOAD_TOO_LARGE', f'Video exceeds the {limits.upload_bytes} byte upload limit. Choose a smaller clip.', 413)


def log_failure(context, error):
    # Log diagnostic stack locations, never exception text supplied by a decoder
    # or caller (which might contain filenames or other user-controlled data).
    logger.error('%s error_type=%s stack=%s', context, type(error).__name__, ''.join(traceback.format_tb(error.__traceback__)))


def prepare_temp_dir(limits):
    path = Path(limits.temp_dir)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def remove_temp(path):
    if path is None:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError as error:
        log_failure('Temporary video cleanup failed', error)


def cleanup_stale(limits):
    directory = prepare_temp_dir(limits)
    cutoff = time.time() - limits.stale_seconds
    for entry in directory.glob('pulseai-upload-*.video'):
        try:
            if not entry.is_symlink() and entry.is_file() and entry.stat().st_mtime < cutoff:
                remove_temp(entry)
        except OSError as error:
            log_failure('Stale video cleanup failed', error)


def copy_upload(source, destination, limits):
    total = 0
    while chunk := source.read(CHUNK_SIZE):
        total += len(chunk)
        if total > limits.upload_bytes:
            raise upload_too_large(limits)
        destination.write(chunk)
    if not total:
        raise VideoRejected('INVALID_VIDEO', 'The video is empty. Choose a decodable workout video.')


class VideoUploadMiddleware:
    """Reserve admission BEFORE multipart parsing; buffer bounded bytes to disk.

    This bounds Starlette's multipart spool too, including chunked requests and
    dishonest Content-Length. No request body is accumulated in a Python list.
    The lock covers upload, validation, inference and response generation.
    """
    def __init__(self, app, limits):
        self.app, self.limits = app, limits
        self.slot = threading.Lock()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path') != '/api/workouts/analyze-video' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        if not self.slot.acquire(blocking=False):
            await JSONResponse({'detail': {'code': 'ANALYSIS_BUSY', 'message': 'Video analysis is busy. Please retry shortly.'}},
                               status_code=503, headers={'Retry-After': '10'})(scope, receive, send)
            return
        buffer = None
        response_started = False
        async def tracked_send(message):
            nonlocal response_started
            if message['type'] == 'http.response.start':
                response_started = True
            await send(message)
        try:
            limit = self.limits.upload_bytes + MULTIPART_OVERHEAD
            length = dict(scope.get('headers', [])).get(b'content-length')
            if length is not None:
                try:
                    if int(length) < 0:
                        raise ValueError()
                    if int(length) > limit:
                        raise upload_too_large(self.limits)
                except ValueError as error:
                    if isinstance(error, VideoRejected):
                        raise
                    raise VideoRejected('INVALID_UPLOAD', 'Invalid upload request.', 400) from None
            directory = prepare_temp_dir(self.limits)
            # Unnamed temporary file closes on all paths; named analysis files
            # have a separate lifecycle so OpenCV can open them on Windows too.
            buffer = tempfile.TemporaryFile(dir=directory)
            total = 0
            try:
                async with asyncio.timeout(self.limits.upload_seconds):
                    while True:
                        message = await receive()
                        if message['type'] == 'http.disconnect':
                            return
                        chunk = message.get('body', b'')
                        total += len(chunk)
                        if total > limit:
                            raise upload_too_large(self.limits)
                        buffer.write(chunk)
                        if not message.get('more_body', False):
                            break
            except TimeoutError:
                raise VideoRejected('UPLOAD_TIMEOUT', 'Upload took too long. Try a smaller clip or a faster connection.', 408) from None
            buffer.seek(0)
            async def replay():
                chunk = buffer.read(CHUNK_SIZE)
                return {'type': 'http.request', 'body': chunk, 'more_body': buffer.tell() < total}
            await self.app(scope, replay, tracked_send)
        except VideoRejected as error:
            await JSONResponse({'detail': error.detail}, status_code=error.status)(scope, receive, send)
        except OSError as error:
            log_failure('Video temporary storage failed', error)
            if response_started:
                raise
            await JSONResponse({'detail': {'code': 'VIDEO_STORAGE_UNAVAILABLE',
                                           'message': 'Video upload storage is temporarily unavailable. Please retry later.'}},
                               status_code=503)(scope, receive, send)
        finally:
            if buffer is not None:
                try:
                    buffer.close()
                except OSError as error:
                    log_failure('Upload buffer cleanup failed', error)
            self.slot.release()
