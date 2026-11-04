"""Conservative movement recognition for the trainer's supported exercises."""
import math
from services.rep_counter import RepCounter, angle

EXERCISES = ("pullups", "squats", "pushups", "curls", "lateral_raises", "lunges")


class RecognitionUnclear(ValueError):
    """Original ValueError contract with bounded, non-identifying evidence."""
    def __init__(self, diagnostics):
        super().__init__("Could not confidently identify one supported exercise. Use a clip showing complete reps of a single exercise, or select the exercise manually.")
        self.diagnostics = diagnostics


def detect_exercise(frames):
    counters = {key: RepCounter(key) for key in EXERCISES}
    coverage = dict.fromkeys(EXERCISES, 0)
    split_frames = bent_frames = 0
    for lm, timestamp, aspect in frames:
        for key, counter in counters.items():
            counter.update(lm, timestamp, aspect)
            coverage[key] += counter.last_valid == timestamp
        if not lm or len(lm) < 29:
            continue
        ids = (23, 24, 25, 26, 27, 28)
        if any(lm[i].get("visibility", 0) < .55 for i in ids):
            continue
        points = {i: {"x": lm[i]["x"] * aspect, "y": lm[i]["y"]} for i in ids}
        left = angle(points[23], points[25], points[27])
        right = angle(points[24], points[26], points[28])
        if left is None or right is None:
            continue
        if min(left, right) < 135:
            bent_frames += 1
            torso = math.hypot((lm[11]["x"]-lm[23]["x"])*aspect, lm[11]["y"]-lm[23]["y"])
            separation = math.hypot((lm[27]["x"]-lm[28]["x"])*aspect, lm[27]["y"]-lm[28]["y"])
            if abs(left-right) > 30 or (separation > torso*.8 and abs(lm[27]["y"]-lm[28]["y"]) > torso*.25):
                split_frames += 1
    # Squats and lunges use the same rep counter; distinguish by leg asymmetry.
    leg_exercise = "lunges" if bent_frames and split_frames/bent_frames > .35 else "squats"
    scores = {}
    for key, counter in counters.items():
        if counter.reps and (key not in ("squats", "lunges") or key == leg_exercise):
            scores[key] = counter.reps * (coverage[key]/max(1, len(frames)))
    ranked = sorted(scores, key=scores.get, reverse=True)
    leading = scores[ranked[0]] if ranked else None
    runner_up = scores[ranked[1]] if len(ranked) > 1 else None
    rejection = ('insufficient_evidence' if not ranked else
                 'ambiguous_candidates' if len(ranked) > 1 and scores[ranked[1]] >= scores[ranked[0]]*.8 else None)
    diagnostics = {
        'score_kind': 'heuristic_ranking_score',
        'total_processed_frames': len(frames),
        'leading_score': leading, 'runner_up_score': runner_up,
        'score_margin': leading-runner_up if runner_up is not None else None,
        'rejection_reason': rejection,
        'leg_classification': {'selected_exercise': leg_exercise, 'bent_frames': bent_frames,
                               'split_frames': split_frames},
        'candidates': [{
            'exercise': key, 'completed_repetitions': counter.reps,
            'valid_tracking_frames': coverage[key], 'total_processed_frames': len(frames),
            'tracking_coverage': coverage[key]/max(1, len(frames)),
            'score': scores.get(key), 'eligible': key in scores,
            'exclusion_reason': ('no_complete_repetitions' if not counter.reps else
                                 'leg_classification_mismatch' if key not in scores else None),
            'ranking_position': ranked.index(key)+1 if key in ranked else None,
        } for key, counter in counters.items()],
    }
    if not ranked or (len(ranked) > 1 and scores[ranked[1]] >= scores[ranked[0]]*.8):
        raise RecognitionUnclear(diagnostics)
    return {"exercise": ranked[0], "method": "pose_movement", "note": "Estimated from complete movement cycles and body position; review the identified exercise before saving.", "diagnostics": diagnostics}
