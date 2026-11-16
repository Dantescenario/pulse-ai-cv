"""Exercise real VIDEO-mode inference; this is not an accuracy benchmark."""

import time

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python.vision import PoseLandmarkerResult

from services.video_analysis_service import _create_pose_landmarker


def validate_result(result):
    """Accept zero detections, but reject an invalid result structure."""
    if not isinstance(result, PoseLandmarkerResult):
        raise AssertionError("Inference did not return PoseLandmarkerResult")
    normalized = result.pose_landmarks
    world = result.pose_world_landmarks
    if not isinstance(normalized, list) or not isinstance(world, list):
        raise AssertionError("Pose landmark collections must be lists")
    if len(normalized) != len(world):
        raise AssertionError("Normalized and world pose counts must match")
    for collection in (normalized, world):
        for pose in collection:
            if not isinstance(pose, list) or len(pose) != 33:
                raise AssertionError("Each detected pose must contain 33 landmarks")
            for landmark in pose:
                if not all(np.isfinite(getattr(landmark, axis)) for axis in ("x", "y", "z")):
                    raise AssertionError("Landmark coordinates must be finite")


def main():
    started = time.perf_counter()
    landmarker = _create_pose_landmarker()
    processed = 0
    try:
        for timestamp_ms in (0, 33, 66):
            frame = np.zeros((256, 256, 3), dtype=np.uint8, order="C")
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            result = landmarker.detect_for_video(image, timestamp_ms)
            validate_result(result)
            processed += 1
    finally:
        landmarker.close()
    elapsed = time.perf_counter() - started
    print(f"PoseLandmarker inference smoke test passed: {processed} frames in {elapsed:.2f}s; cleanup succeeded. Not an accuracy benchmark.")


if __name__ == "__main__":
    main()
