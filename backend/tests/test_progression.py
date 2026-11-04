import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pydantic import ValidationError
from fastapi import HTTPException
import database
import main
import plan_routes
from services.progression_service import PlanInput, SetInput, RunInput, suggest_next

TARGET = dict(exercise='squats', target_sets=2, reps_min=8, reps_max=12,
              load_kg=20, increment_kg=2.5, rest_seconds=90, max_rpe=8)
SETS = [dict(reps=12, load_kg=20, rpe=8, rest_seconds=None),
        dict(reps=12, load_kg=20, rpe=7, rest_seconds=90)]

class ProgressionRuleTests(unittest.TestCase):
    def test_increase_only_when_all_conditions_are_met(self):
        result = suggest_next(TARGET, SETS)
        self.assertEqual(result['action'], 'increase_load')
        self.assertEqual(result['next_load_kg'], 22.5)
        self.assertEqual(TARGET['load_kg'], 20)

    def test_repeat_reasons_for_each_failed_condition(self):
        cases = [
            ([SETS[0]], 'number'),
            ([SETS[0], {**SETS[1], 'load_kg': 0}], 'load'),
            ([SETS[0], {**SETS[1], 'reps': 11}], 'rep'),
            ([SETS[0], {**SETS[1], 'rpe': None}], 'missing'),
            ([SETS[0], {**SETS[1], 'rpe': 9}], 'difficulty'),
            ([SETS[0], {**SETS[1], 'rest_seconds': None}], 'Rest'),
            ([SETS[0], {**SETS[1], 'rest_seconds': 89}], 'Rest'),
        ]
        for sets, text in cases:
            with self.subTest(text=text):
                result = suggest_next(TARGET, sets)
                self.assertEqual(result['action'], 'repeat_target')
                self.assertEqual(result['next_load_kg'], 20)
                self.assertTrue(any(text in reason for reason in result['reasons']))

    def test_input_validation(self):
        for changes in [dict(reps_min=13), dict(load_kg=float('nan')), dict(increment_kg=0), dict(target_sets=0)]:
            with self.assertRaises(ValidationError):
                PlanInput(**{**TARGET, **changes})
        for changes in [dict(rpe=11), dict(load_kg=-1), dict(reps=-1), dict(rest_seconds=-1)]:
            with self.assertRaises(ValidationError):
                SetInput(**{**SETS[0], **changes})
        with self.assertRaises(ValidationError):
            RunInput(target=TARGET, sets=[])

    def test_single_set_does_not_require_rest_before_it(self):
        self.assertEqual(suggest_next({**TARGET, 'target_sets': 1}, [SETS[0]])['action'], 'increase_load')

class PlanPersistenceTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        override = patch.object(database, 'DB_PATH', str(Path(folder.name) / 'plans.db'))
        override.start()
        self.addCleanup(override.stop)
        database.init_db()
        self.plan = plan_routes.save_plan(PlanInput(**TARGET))

    def test_saved_runs_keep_snapshot_and_never_update_target(self):
        run = plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=SETS))
        self.assertEqual(run['suggestion']['next_load_kg'], 22.5)
        self.assertEqual(plan_routes.list_plans()[0]['load_kg'], 20)
        changed = plan_routes.save_plan(PlanInput(**{**TARGET, 'load_kg': 25}))
        self.assertEqual(changed['id'], self.plan['id'])
        history = plan_routes.list_runs(self.plan['id'])
        self.assertEqual(history[0]['target']['load_kg'], 20)
        self.assertEqual(plan_routes.list_plans()[0]['latest_run']['id'], run['id'])

    def tracked_set(self, source='webcam', exercise='Barbell Squat'):
        return main.save_workout(main.WorkoutSessionCreate(exercise=exercise, source=source,
            reps_completed=12, avg_form_score=80, duration_seconds=30))['session_id']

    def test_linked_sets_are_validated_and_cannot_be_reused(self):
        session = self.tracked_set()
        self.tracked_set('simulation')
        self.assertEqual([s['id'] for s in plan_routes.available_sets()], [session])
        sets = [{**SETS[0], 'workout_session_id': session}, SETS[1]]
        plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=sets))
        self.assertEqual(plan_routes.available_sets(), [])
        with self.assertRaises(HTTPException) as caught:
            plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=sets))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(len(plan_routes.list_runs(self.plan['id'])), 1)

    def test_rejects_simulation_wrong_exercise_count_and_duplicate_links(self):
        for session, reps in [(self.tracked_set('simulation'), 12),
                              (self.tracked_set(exercise='Bicep Curl'), 12),
                              (self.tracked_set(), 11), (99999, 12)]:
            with self.assertRaises(HTTPException):
                plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=[{**SETS[0], 'reps': reps, 'workout_session_id': session}]))
        session = self.tracked_set()
        with self.assertRaises(HTTPException):
            plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=[{**s, 'workout_session_id': session} for s in SETS]))
        self.assertEqual(plan_routes.list_runs(self.plan['id']), [])

    def test_stale_target_is_rejected(self):
        plan_routes.save_plan(PlanInput(**{**TARGET, 'load_kg': 25}))
        with self.assertRaises(HTTPException) as caught:
            plan_routes.log_run(self.plan['id'], RunInput(target=TARGET, sets=SETS))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(plan_routes.list_runs(self.plan['id']), [])

    def test_missing_plan(self):
        with self.assertRaises(HTTPException) as caught:
            plan_routes.log_run(999, RunInput(target=TARGET, sets=SETS))
        self.assertEqual(caught.exception.status_code, 404)
