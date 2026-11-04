"""Metrics only: synthetic records in unit tests are not real CV evidence."""
from .manifest import EXERCISES, count

SENTINELS = ('__missing__', '__invalid__', '__failed__')


def mean(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def count_status(row):
    if row.get('status') != 'ok':
        return 'failed'
    if row.get('count_prediction_issue') == 'invalid':
        return 'invalid'
    prediction = row.get('predicted_reps')
    return 'valid' if count(prediction) else 'missing' if prediction is None else 'invalid'


def sample_metrics(row):
    truth, prediction = row.get('ground_truth_reps'), row.get('predicted_reps')
    paired = count(truth) and count_status(row) == 'valid'
    error = abs(prediction-truth) if paired else None
    return {'count_prediction_status': count_status(row), 'absolute_count_error': error,
            'relative_count_error': error/truth if paired and truth > 0 else None,
            'exact_count': prediction == truth if paired else None,
            'recognition_correct': (row.get('status') == 'ok' and row.get('predicted_exercise') == row['exercise'])
                if row.get('exercise') in EXERCISES and row.get('recognition_evaluated', True) else None}


def counting(rows):
    eligible = [r for r in rows if count(r.get('ground_truth_reps'))]
    pairs = [r for r in eligible if count_status(r) == 'valid']
    errors = [sample_metrics(r) for r in pairs]
    exact = sum(r['predicted_reps'] == r['ground_truth_reps'] for r in pairs)
    return {
        'annotated_samples': len(eligible), 'valid_predictions': len(pairs),
        'missing_predictions': sum(count_status(r) == 'missing' for r in eligible),
        'invalid_predictions': sum(count_status(r) == 'invalid' for r in eligible),
        'failed_predictions': sum(count_status(r) == 'failed' for r in eligible),
        'prediction_coverage': ratio(len(pairs), len(eligible)),
        'ground_truth_repetitions': sum(r['ground_truth_reps'] for r in eligible),
        'ground_truth_repetitions_on_valid_pairs': sum(r['ground_truth_reps'] for r in pairs),
        'predicted_repetitions_on_valid_pairs': sum(r['predicted_reps'] for r in pairs),
        'mae_on_valid_predictions': mean([e['absolute_count_error'] for e in errors]),
        'mean_relative_count_error': mean([e['relative_count_error'] for e in errors]),
        'relative_error_samples': sum(r['ground_truth_reps'] > 0 for r in pairs),
        'exact_count_accuracy': ratio(exact, len(eligible)),
        'exact_count_accuracy_on_valid_predictions': ratio(exact, len(pairs)),
        'overcount_rate_on_valid_predictions': ratio(sum(r['predicted_reps'] > r['ground_truth_reps'] for r in pairs), len(pairs)),
        'undercount_rate_on_valid_predictions': ratio(sum(r['predicted_reps'] < r['ground_truth_reps'] for r in pairs), len(pairs)),
    }


def recognition(rows):
    eligible = [r for r in rows if r.get('exercise') in EXERCISES and r.get('recognition_evaluated', True)]
    columns = EXERCISES + SENTINELS
    matrix = {label: dict.fromkeys(columns, 0) for label in EXERCISES}
    for row in eligible:
        prediction = row.get('predicted_exercise')
        if row.get('status') != 'ok':
            prediction = '__failed__'
        elif prediction is None:
            prediction = '__missing__'
        elif not isinstance(prediction, str) or prediction not in EXERCISES:
            prediction = '__invalid__'
        matrix[row['exercise']][prediction] += 1
    per_class = {}
    for label in EXERCISES:
        support = sum(matrix[label].values())
        tp = matrix[label][label]
        fp = sum(matrix[other][label] for other in EXERCISES if other != label)
        fn = support - tp
        precision = ratio(tp, tp+fp) if tp+fp else (0.0 if support else None)
        recall = ratio(tp, support)
        f1 = ratio(2*tp, 2*tp+fp+fn) if support else None
        per_class[label] = {'support': support, 'true_positive': tp, 'false_positive': fp, 'false_negative': fn,
                            'accuracy': recall, 'precision': precision, 'recall': recall, 'f1': f1}
    supported = [v for v in per_class.values() if v['support']]
    correct = sum(matrix[label][label] for label in EXERCISES)
    return {'annotated_samples': len(eligible), 'accuracy': ratio(correct, len(eligible)),
            'macro_precision': mean([v['precision'] for v in supported]),
            'macro_recall': mean([v['recall'] for v in supported]),
            'macro_f1': mean([v['f1'] for v in supported]),
            'represented_exercises': len(supported), 'per_class': per_class,
            'confusion_matrix': {'row_labels': list(EXERCISES), 'column_labels': list(columns), 'counts': matrix}}


def summarize(rows):
    recognized = recognition(rows)
    grouped = {label: [r for r in rows if r.get('exercise') == label] for label in EXERCISES}
    per_exercise = {label: {'samples': len(group), 'counting': counting(group),
                            'recognition': recognized['per_class'][label]} for label, group in grouped.items()}
    return {'samples': len(rows), 'inference_completed_samples': sum(r.get('status') == 'ok' for r in rows),
            'prediction_issue_samples': sum(r.get('status') == 'ok' and (count_status(r) != 'valid' or
                (r.get('recognition_evaluated', True) and r.get('predicted_exercise') not in EXERCISES)) for r in rows),
            'failed_samples': sum(r.get('status') != 'ok' for r in rows),
            'unlabelled_exercise_samples': sum(r.get('exercise') not in EXERCISES for r in rows),
            'overall': {'counting': counting(rows), 'recognition': recognized},
            'macro_by_exercise': {
                'represented_count_exercises': sum(v['counting']['annotated_samples'] > 0 for v in per_exercise.values()),
                'count_exercises_with_valid_predictions': sum(v['counting']['valid_predictions'] > 0 for v in per_exercise.values()),
                'mae_on_valid_predictions': mean([v['counting']['mae_on_valid_predictions'] for v in per_exercise.values()]),
                'exact_count_accuracy': mean([v['counting']['exact_count_accuracy'] for v in per_exercise.values()]),
                'recognition_precision': recognized['macro_precision'], 'recognition_recall': recognized['macro_recall'],
                'recognition_f1': recognized['macro_f1']},
            'per_exercise': per_exercise}
