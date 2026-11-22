"""Verify real VIDEO-mode pose detection on the synthetic fixture."""

import hashlib
from pathlib import Path
import time

import cv2
import mediapipe as mp
import numpy as np

from services.video_analysis_service import _create_pose_landmarker
from smoke_pose_landmarker import validate_result


FIXTURE = Path(__file__).resolve().parent / "tests" / "fixtures" / "pose-positive.png"
EXPECTED_SHA256 = "fc78ec2d5c5a9c6f89d924fffb17639a2e0f87d9f4195d1348b77137333013de"


def main():
    started = time.perf_counter()
    encoded = FIXTURE.read_bytes()
    actual_sha256 = hashlib.sha256(encoded).hexdigest()
    if actual_sha256 != EXPECTED_SHA256:
        raise AssertionError(
            f"Fixture SHA-256 mismatch: expected {EXPECTED_SHA256}, got {actual_sha256}"
        )
    print(f"Fixture SHA-256 verified: {actual_sha256}")

    frame = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        raise ValueError(f"Could not decode pose fixture: {FIXTURE}")
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    total_poses = 0
    landmarker = _create_pose_landmarker()
    try:
        for timestamp_ms in (0, 33, 66):
            result = landmarker.detect_for_video(image, timestamp_ms)
            validate_result(result)
            count = len(result.pose_landmarks)
            print(f"{timestamp_ms} ms: {count} pose(s)")
            if count == 0:
                raise AssertionError(f"No pose detected at {timestamp_ms} ms")
            total_poses += count
    finally:
        landmarker.close()

    elapsed = time.perf_counter() - started
    print(f"Total detected poses: {total_poses} in {elapsed:.2f}s. Cleanup succeeded.")


if __name__ == "__main__":
    main()
