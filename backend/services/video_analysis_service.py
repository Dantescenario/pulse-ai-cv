"""
PulseAI Server-Side Video Analysis Engine
Uses MediaPipe Tasks PoseLandmarker to process uploaded workout videos frame-by-frame,
extracts real 33-landmark pose data, runs biomechanical rep counting for 6 exercises,
detects form flaws, computes Hypertrophy Stimulus Index, and returns a full report.
"""

from services.rep_counter import RepCounter
from services.exercise_detection import detect_exercise
import cv2
import math
import os
import json
import numpy as np
import time
from video_limits import VideoLimits, VideoRejected, log_failure
from typing import List, Dict, Optional

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    mp = None

# Path to the downloaded pose landmarker model
MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'pose_landmarker.task')
MODEL_PATH = os.path.abspath(MODEL_PATH)


def calculate_angle(a: dict, b: dict, c: dict) -> float:
    """Calculate angle at vertex B between vectors BA and BC."""
    ax, ay = a['x'], a['y']
    bx, by = b['x'], b['y']
    cx, cy = c['x'], c['y']
    radians = math.atan2(cy - by, cx - bx) - math.atan2(ay - by, ax - bx)
    angle = abs(math.degrees(radians))
    if angle > 180.0:
        angle = 360.0 - angle
    return round(angle, 1)


def lm_to_dict(lm) -> dict:
    """Convert a mediapipe NormalizedLandmark to plain dict."""
    return {
        'x': float(lm.x),
        'y': float(lm.y),
        'z': float(getattr(lm, 'z', 0.0)),
        'visibility': float(getattr(lm, 'visibility', 0.0)),
        'presence': float(getattr(lm, 'presence', 1.0))
    }


EXERCISE_CONFIG = {
    'pullups': {
        'name': 'Strict Pull-up / Chin-up',
        'angle_landmarks': (11, 13, 15),    # left: shoulder-elbow-wrist
        'angle_landmarks_r': (12, 14, 16),  # right
        'top_angle_threshold': 58,           # contracted = small angle
        'bottom_angle_threshold': 148,       # dead hang = large angle
        'target_depth_angle': 55,
        'ideal_eccentric_tempo': 2.5,
        'muscles': ['Latissimus Dorsi (Lats)', 'Teres Major & Rhomboids', 'Biceps Brachii', 'Core Anti-Kip Stability'],
        'inverted': True  # small angle = TOP (contracted), large angle = BOTTOM (stretched)
    },
    'squats': {
        'name': 'Barbell/Goblet Squat',
        'angle_landmarks': (23, 25, 27),
        'angle_landmarks_r': (24, 26, 28),
        'top_angle_threshold': 158,
        'bottom_angle_threshold': 92,
        'target_depth_angle': 90,
        'ideal_eccentric_tempo': 2.5,
        'muscles': ['Quads (Vastus Lateralis)', 'Gluteus Maximus', 'Adductor Magnus', 'Spinal Stability'],
        'inverted': False
    },
    'pushups': {
        'name': 'Chest Push-up',
        'angle_landmarks': (11, 13, 15),
        'angle_landmarks_r': (12, 14, 16),
        'top_angle_threshold': 150,
        'bottom_angle_threshold': 82,
        'target_depth_angle': 80,
        'ideal_eccentric_tempo': 2.2,
        'muscles': ['Pectoralis Major', 'Anterior Deltoids', 'Triceps Brachii', 'Core Plank Integrity'],
        'inverted': False
    },
    'curls': {
        'name': 'Strict Bicep Curl',
        'angle_landmarks': (11, 13, 15),
        'angle_landmarks_r': (12, 14, 16),
        'top_angle_threshold': 58,
        'bottom_angle_threshold': 148,
        'target_depth_angle': 45,
        'ideal_eccentric_tempo': 2.5,
        'muscles': ['Biceps Brachii', 'Brachialis', 'Brachioradialis', 'Torso Anti-Swing'],
        'inverted': True
    },
    'lateral_raises': {
        'name': 'Dumbbell Lateral Raise',
        'angle_landmarks': (23, 11, 13),
        'angle_landmarks_r': (24, 12, 14),
        'top_angle_threshold': 72,
        'bottom_angle_threshold': 22,
        'target_depth_angle': 85,
        'ideal_eccentric_tempo': 2.0,
        'muscles': ['Lateral Deltoid', 'Supraspinatus', 'Upper Trap Isolation', 'Shoulder Alignment'],
        'inverted': False  # angle goes UP as arms raise
    },
    'lunges': {
        'name': 'Walking/Reverse Lunge',
        'angle_landmarks': (23, 25, 27),
        'angle_landmarks_r': (24, 26, 28),
        'top_angle_threshold': 158,
        'bottom_angle_threshold': 90,
        'target_depth_angle': 90,
        'ideal_eccentric_tempo': 2.2,
        'muscles': ['Quads', 'Gluteal Complex', 'Hamstrings', 'Knee Joint Stability'],
        'inverted': False
    }
}


def calculate_hypertrophy_stimulus(eccentric_sec: float, depth_angle: float,
                                    target_depth: float, flaws: List[str]) -> dict:
    """Compute Hypertrophy Stimulus Index (HSI) with 3-component scoring."""
    depth_delta = abs(depth_angle - target_depth)
    rom_score = max(12.0, 40.0 - depth_delta * 1.2)

    if eccentric_sec < 1.3:
        tempo_score = 14.0
    elif eccentric_sec < 2.0:
        tempo_score = 25.0
    elif eccentric_sec <= 3.8:
        tempo_score = 35.0
    else:
        tempo_score = 30.0

    stability_score = max(5.0, 25.0 - len(flaws) * 8.0)
    total = round(min(100, rom_score + tempo_score + stability_score))

    if total >= 92:
        tier = 'Tier S (Optimal Stimulus)'
    elif total >= 82:
        tier = 'Tier A (High Stimulus)'
    elif total >= 70:
        tier = 'Tier B (Moderate - Control Tempo)'
    else:
        tier = 'Tier C (Sub-Optimal)'

    return {'total_score': total, 'rom_score': round(rom_score), 'tempo_score': round(tempo_score),
            'stability_score': round(stability_score), 'tier': tier}


def compute_muscle_activation(exercise: str, avg_depth: float, avg_eccentric: float, flaws: List[str]) -> dict:
    config = EXERCISE_CONFIG.get(exercise, EXERCISE_CONFIG['squats'])
    muscles = config['muscles']
    target = config['target_depth_angle']
    ideal = config['ideal_eccentric_tempo']
    depth_q = max(0.3, 1.0 - abs(avg_depth - target) / max(target, 1))
    tempo_q = min(1.0, avg_eccentric / ideal) if avg_eccentric > 0 else 0.6
    bases = [92, 76, 68, 52]
    result = {}
    for i, muscle in enumerate(muscles):
        base = bases[i] if i < len(bases) else 60
        val = round(base * (depth_q * 0.7 + 0.3) if i == 0 else base * (tempo_q * 0.65 + 0.35))
        for _ in flaws:
            val = max(20, val - 4)
        result[muscle] = min(99, max(20, val))
    return result


def _detect_flaws(exercise: str, lm: list, angle: float) -> list:
    flaws = []
    try:
        if exercise in ['squats', 'lunges']:
            lk, rk, la, ra = lm[25], lm[26], lm[27], lm[28]
            if angle < 130 and abs(lk['x'] - rk['x']) < abs(la['x'] - ra['x']) * 0.72:
                flaws.append('Knee Valgus (Knees Caving In)')
        elif exercise == 'pullups':
            lh, rh = lm[23], lm[24]
            hip_x = (lh['x'] + rh['x']) / 2
            shoulder_x = (lm[11]['x'] + lm[12]['x']) / 2
            torso = max(abs((lh['y']+rh['y'])/2 - (lm[11]['y']+lm[12]['y'])/2), .05)
            if abs(hip_x - shoulder_x) > torso * .65:
                flaws.append('Kipping / Hip Swing Detected')
        elif exercise == 'pushups':
            ls, lh, la = lm[11], lm[23], lm[27]
            expected = (ls['y'] + la['y']) / 2
            if lh['y'] > expected + 0.07:
                flaws.append('Hip Sag - Core Not Engaged')
        elif exercise == 'curls':
            ls, le = lm[11], lm[13]
            if abs(le['x'] - ls['x']) > 0.13:
                flaws.append('Elbow Drift / Cheating Momentum')
    except (IndexError, KeyError, TypeError):
        pass
    return flaws


def _build_coaching_verdict(exercise: str, reps: int, form_score: float,
                              eccentric_sec: float, depth_angle: float,
                              target_depth: float, ideal_tempo: float, flaws: List[str]) -> str:
    config = EXERCISE_CONFIG.get(exercise, EXERCISE_CONFIG['squats'])
    name = config['name']
    if reps == 0:
        return (f"No complete reps detected in this {name} video. "
                "Make sure your full body is visible and you perform at least one full rep.")
    parts = [f"Analyzed {reps} verified rep{'s' if reps > 1 else ''} of {name}."]
    if form_score >= 90:
        parts.append(f"Excellent form ({form_score}%).")
    elif form_score >= 78:
        parts.append(f"Good mechanics ({form_score}%), some refinements available.")
    else:
        parts.append(f"Form needs work ({form_score}%). See flaws below.")
    if eccentric_sec >= 2.0:
        parts.append(f"Controlled eccentric phase ({eccentric_sec:.1f}s). Ideal for hypertrophy.")
    elif eccentric_sec > 0:
        parts.append(f"Eccentric too fast ({eccentric_sec:.1f}s). Target â‰¥{ideal_tempo}s.")
    if depth_angle > 0:
        if abs(depth_angle - target_depth) <= 10:
            parts.append(f"Good depth ({depth_angle:.0f}Â°, target {target_depth}Â°).")
        elif depth_angle > target_depth:
            parts.append(f"Insufficient depth ({depth_angle:.0f}Â° â€” target is {target_depth}Â°).")
        else:
            parts.append(f"Excellent depth ({depth_angle:.0f}Â° â€” exceeded target).")
    if flaws:
        parts.append(f"Key correction: {flaws[0]}.")
    return ' '.join(parts)


def _create_pose_landmarker():
    """Create a MediaPipe PoseLandmarker using the new Tasks API."""
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Pose model not found at {MODEL_PATH}")

    base_options = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
        min_tracking_confidence=0.4,
        output_segmentation_masks=False
    )
    return mp_vision.PoseLandmarker.create_from_options(options)


def _release(resource, method):
    if resource is not None:
        try:
            getattr(resource, method)()
        except Exception as error:
            log_failure('Video resource cleanup failed', error)


def replay_indices(count, limit):
    """Uniform sample positions, keeping first/last without changing counter input."""
    if count <= limit:
        return set(range(count))
    if limit == 1:
        return {0}
    return {round(i * (count-1) / (limit-1)) for i in range(limit)}


def analyze_video(video_path: str, exercise: str = "auto", fps_skip: int = 2, limits=None) -> dict:
    limits = limits or VideoLimits.from_env()
    started = time.monotonic()
    def check_deadline():
        if time.monotonic() - started > limits.analysis_seconds:
            raise VideoRejected('ANALYSIS_TIMEOUT', 'Analysis took too long. Try a shorter clip.', 504)
    def check_dimensions(width, height):
        if not all(math.isfinite(v) and v > 0 for v in (width, height)):
            raise VideoRejected('INVALID_VIDEO', 'Video has invalid frame dimensions. Try an MP4 video.')
        if width > limits.width or height > limits.height:
            raise VideoRejected('VIDEO_DIMENSIONS', f'Video frames exceed {limits.width} x {limits.height} pixels. Resize the video before uploading.')
    if not MEDIAPIPE_AVAILABLE:
        raise VideoRejected('VIDEO_SERVICE_UNAVAILABLE', 'Video analysis is temporarily unavailable. Please retry later.', 503)
    if exercise != "auto" and exercise not in EXERCISE_CONFIG:
        raise VideoRejected('UNSUPPORTED_EXERCISE', 'Choose one of the six supported exercises.')
    cap, landmarker = None, None
    rep_details, rep_scores, all_angles, samples = [], [], [], []
    observed_flaws = {}
    rep_flaws = set()
    frames = []
    detection = None
    frame_idx, valid_frames, processed_frames = 0, 0, 0
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise VideoRejected('INVALID_VIDEO', 'Cannot decode this video. Try a supported MP4 video.')
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if not math.isfinite(video_fps) or video_fps <= 0 or not math.isfinite(frame_count) or frame_count < 2:
            raise VideoRejected('INVALID_VIDEO', 'Video must contain multiple frames and usable frame-rate metadata.')
        total_frames = int(frame_count)
        check_dimensions(cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if total_frames / video_fps > limits.duration_seconds:
            raise VideoRejected('VIDEO_DURATION', f'Video exceeds the {limits.duration_seconds:g} second limit. Trim the clip.')
        # Keep the existing sampling cadence: reject excess work, never silently
        # skip more counter input just to fit the budget.
        stride = max(1, min(int(fps_skip), int(video_fps / 12)))
        if math.ceil(total_frames / stride) > limits.processed_frames:
            raise VideoRejected('VIDEO_FRAME_LIMIT', f'Video exceeds the {limits.processed_frames} analysis-frame limit. Trim the clip or reduce its frame rate.')
        while cap.isOpened():
            check_deadline()
            ok, frame = cap.read()
            check_deadline()
            if not ok:
                break
            frame_idx += 1
            height, width = frame.shape[:2]
            check_dimensions(width, height)
            timestamp = (frame_idx-1)/video_fps
            # Runtime bounds also cover missing/dishonest container metadata.
            if frame_idx / video_fps > limits.duration_seconds:
                raise VideoRejected('VIDEO_DURATION', f'Video exceeds the {limits.duration_seconds:g} second limit. Trim the clip.')
            if frame_idx > limits.processed_frames * stride:
                raise VideoRejected('VIDEO_FRAME_LIMIT', 'Video exceeds the analysis-frame limit. Trim the clip.')
            if (frame_idx-1) % stride:
                continue
            if processed_frames >= limits.processed_frames:
                raise VideoRejected('VIDEO_FRAME_LIMIT', 'Video exceeds the analysis-frame limit. Trim the clip.')
            # Decode and validate the first frame BEFORE constructing inference.
            if landmarker is None:
                landmarker = _create_pose_landmarker()
            if max(height, width) > 960:
                scale = 960/max(height, width)
                frame = cv2.resize(frame, (round(width*scale), round(height*scale)), interpolation=cv2.INTER_AREA)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            result = landmarker.detect_for_video(image, round(timestamp*1000))
            check_deadline()
            processed_frames += 1
            lm = [lm_to_dict(p) for p in result.pose_landmarks[0]] if result.pose_landmarks else None
            frames.append((lm, timestamp, width/height))
        if frame_idx < 2 or processed_frames == 0 or frame_idx < total_frames:
            raise VideoRejected('INVALID_VIDEO', 'Video is empty, truncated or cannot be fully decoded. Try another MP4 video.')
    except cv2.error:
        raise VideoRejected('INVALID_VIDEO', 'Cannot decode this video. Try a supported MP4 video.') from None
    finally:
        _release(cap, 'release')
        _release(landmarker, 'close')
    if exercise == "auto":
        check_deadline()
        try:
            detection = detect_exercise(frames)
        except ValueError as error:
            raise VideoRejected('EXERCISE_UNCLEAR', 'Could not identify one exercise. Show complete reps of a single exercise or select it manually.',
                                recognition_diagnostics=getattr(error, 'diagnostics', None)) from None
        exercise = detection["exercise"]
    sample_positions = replay_indices(len(frames), limits.replay_samples)
    config = EXERCISE_CONFIG[exercise]
    counter = RepCounter(exercise)
    for frame_number, (lm, timestamp, aspect) in enumerate(frames):
        check_deadline()
        state = counter.update(lm,timestamp,aspect)
        if lm and frame_number in sample_positions:
            # Replay needs only these display fields, not z/presence or full
            # precision. Counting still uses the original unrounded landmarks.
            display_lm = [{"x": round(p["x"], 5), "y": round(p["y"], 5),
                           "visibility": round(p["visibility"], 3)} for p in lm]
            samples.append({"time":round(timestamp,4),"landmarks":display_lm,"angle":state["currentAngle"],"stage":state["stage"]})
        if state["stage"] == "WAIT_READY" and not state.get("rep"):
            rep_flaws.clear()
        if counter.last_valid == timestamp:
            valid_frames += 1
            all_angles.append(state["currentAngle"])
            flaws = _detect_flaws(exercise,lm,state["currentAngle"])
            rep_flaws.update(flaws)
            observed_flaws.update(dict.fromkeys(flaws))
        rep = state.get("rep")
        if rep:
            flaws = sorted(rep_flaws)
            analysis = calculate_hypertrophy_stimulus(rep["eccentric_seconds"],rep["depth_angle"],config["target_depth_angle"],flaws)
            rep.update(hypertrophy_score=analysis["total_score"],tier=analysis["tier"],flaws=flaws or ["Clean mechanics"])
            rep_details.append(rep)
            rep_scores.append(analysis["total_score"])
            rep_flaws.clear()
    reps = counter.reps
    total_tut = sum(r["eccentric_seconds"]+r["concentric_seconds"] for r in rep_details)
    avg_eccentric = round(sum(r["eccentric_seconds"] for r in rep_details)/reps,2) if reps else 0
    avg_depth = round(sum(r["depth_angle"] for r in rep_details)/reps,1) if reps else 0
    avg_form = round(sum(rep_scores)/reps) if reps else 0
    global_flaws = list(dict.fromkeys(observed_flaws))[:4]
    hsi = calculate_hypertrophy_stimulus(avg_eccentric,avg_depth,config["target_depth_angle"],global_flaws) if reps else {"total_score":0,"rom_score":0,"tempo_score":0,"stability_score":0,"tier":"No completed reps"}
    return {
        "reps_completed":reps,"avg_form_score":avg_form,"hypertrophy_score":hsi["total_score"],"tier":hsi["tier"],
        "avg_tut_seconds":round(total_tut/reps,1) if reps else 0,"total_tut_seconds":round(total_tut,1),
        "avg_eccentric_tempo":avg_eccentric,"avg_depth_angle":avg_depth,
        "muscle_activation":compute_muscle_activation(exercise,avg_depth,avg_eccentric,global_flaws) if reps else {},
        "rep_details":rep_details,"flaws":global_flaws,
        "coaching_verdict":_build_coaching_verdict(exercise,reps,avg_form,avg_eccentric,avg_depth,config["target_depth_angle"],config["ideal_eccentric_tempo"],global_flaws),
        "hsi_breakdown":hsi,"angle_timeline":all_angles[::max(1,len(all_angles)//300)][:300],
        "landmark_samples":samples,"video_fps":video_fps,"total_frames":total_frames,
        "exercise":exercise,"exercise_detection":detection,
        "exercise_name":config["name"],"source":"mediapipe_server",
        "tracking_coverage":round(valid_frames/processed_frames,3),
        "counting_note":"Only complete starting-position to working-position to starting-position cycles are counted. Partial reps and tracking gaps are excluded."
    }
