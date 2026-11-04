"""Strict metadata-only manifest validation; all timings are source-video seconds."""
import json
import math
from pathlib import Path, PurePosixPath
import re

EXERCISES = ('squats', 'pushups', 'pullups', 'curls', 'lateral_raises', 'lunges')
VIEWS = ('front', 'side', 'rear', 'oblique', 'mixed', 'unknown')


def count(value):
    return type(value) is int and value >= 0


def text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_manifest(data):
    if not isinstance(data, dict) or set(data) != {'schema_version', 'dataset_name', 'samples'}:
        raise ValueError('Manifest requires only schema_version, dataset_name and samples')
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('Unsupported manifest schema_version')
    if not text(data['dataset_name']) or not isinstance(data['samples'], list):
        raise ValueError('dataset_name must be nonempty and samples must be a list')
    ids = set()
    required = {'video_id', 'video_path', 'exercise', 'ground_truth_reps', 'repetitions',
                'timestamps_complete', 'camera_view', 'quality_notes', 'tracking_difficulties', 'annotation_source'}
    for index, sample in enumerate(data['samples']):
        prefix = f'Sample {index+1}: '
        if not isinstance(sample, dict) or set(sample) != required:
            raise ValueError(prefix + 'missing or unknown annotation fields')
        identifier = sample['video_id']
        if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier) or identifier in ids:
            raise ValueError(prefix + 'video_id must be unique and use letters, digits, underscore or hyphen')
        ids.add(identifier)
        path = sample['video_path']
        if path is not None:
            if not text(path) or '\\' in path or ':' in path or PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
                raise ValueError(prefix + 'video_path must be a relative forward-slash path without parent traversal, or null')
        if sample['exercise'] is not None and sample['exercise'] not in EXERCISES:
            raise ValueError(prefix + 'exercise must be a supported identifier or null')
        truth = sample['ground_truth_reps']
        if truth is not None and not count(truth):
            raise ValueError(prefix + 'ground_truth_reps must be a nonnegative integer or null')
        if sample['camera_view'] not in VIEWS or not isinstance(sample['quality_notes'], str):
            raise ValueError(prefix + 'invalid camera_view or quality_notes')
        if not text(sample['annotation_source']):
            raise ValueError(prefix + 'annotation_source is required')
        if not isinstance(sample['tracking_difficulties'], list) or not all(text(v) for v in sample['tracking_difficulties']):
            raise ValueError(prefix + 'tracking_difficulties must be a list of nonempty notes')
        repetitions = sample['repetitions']
        if not isinstance(repetitions, list) or type(sample['timestamps_complete']) is not bool:
            raise ValueError(prefix + 'repetitions must be a list and timestamps_complete a boolean')
        if truth is not None and len(repetitions) > truth:
            raise ValueError(prefix + 'more timestamps than ground-truth repetitions')
        if sample['timestamps_complete'] and (truth is None or len(repetitions) != truth):
            raise ValueError(prefix + 'complete timestamps require a known count and matching number of intervals')
        previous = -1
        for rep in repetitions:
            if not isinstance(rep, dict) or set(rep) != {'start_seconds', 'end_seconds'}:
                raise ValueError(prefix + 'each repetition requires start_seconds and end_seconds')
            start, end = rep['start_seconds'], rep['end_seconds']
            if not all(type(v) in (float, int) and math.isfinite(v) for v in (start, end)) or start < 0 or end <= start or start < previous:
                raise ValueError(prefix + 'rep times must be finite, ordered, non-overlapping and end after start')
            previous = end
    return data


def load_manifest(path):
    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON field: ' + key)
            result[key] = value
        return result
    return validate_manifest(json.loads(Path(path).read_text(encoding='utf-8-sig'), object_pairs_hook=no_duplicates))


def video_path(sample, root):
    if sample['video_path'] is None:
        return None
    root = Path(root).resolve()
    resolved = (root / sample['video_path']).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError('Video path escapes video root (including symlinks)')
    return resolved
