import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
import diary_routes as routes


class DiaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(database, 'DB_PATH', str(Path(self.temp.name) / 'test.db'))
        self.patch.start()
        database.init_db()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def entry(self, **changes):
        return routes.ExerciseLog(**dict(day='2026-10-19', exercise='Squats', sets=3,
                                        reps=10, duration_minutes=20, **changes))

    def test_create_edit_delete_and_day_filter(self):
        result = routes.create_log(self.entry())
        self.assertEqual(len(routes.diary(date(2026, 10, 19))), 1)
        self.assertEqual(routes.diary(date(2026, 10, 20)), [])
        updated = self.entry().model_copy(update={'reps': 12})
        routes.update_log(result['id'], updated)
        self.assertEqual(routes.diary(date(2026, 10, 19))[0]['reps'], 12)
        routes.delete_log(result['id'])
        self.assertEqual(routes.diary(date(2026, 10, 19)), [])

    def test_week_fills_gaps_applies_timezone_and_excludes_simulation(self):
        routes.create_log(self.entry())
        conn = database.get_connection()
        conn.executemany('''INSERT INTO workout_sessions
            (exercise,reps_completed,avg_form_score,duration_seconds,source,created_at)
            VALUES ('Squats',5,80,120,?,?)''', [
            ('webcam', '2026-10-18 20:00:00'),
            ('simulation', '2026-10-19 12:00:00'),
            ('video_upload', '2026-10-25 20:00:00')])
        conn.commit()
        conn.close()
        result = routes.weekly(date(2026, 10, 21), 330)
        self.assertEqual(result['start'], '2026-10-19')
        self.assertEqual(len(result['days']), 7)
        self.assertEqual(result['days'][0]['reps'], 35)
        self.assertEqual(result['days'][0]['minutes'], 22)
        self.assertTrue(all(d['entries'] == 0 for d in result['days'][1:]))

    def test_validation_rejects_invalid_values(self):
        values = self.entry().model_dump()
        for changes in ({'exercise':'   '}, {'sets':0}, {'duration_minutes':-1},
                        {'weight_kg':float('nan')}, {'day':'not-a-date'}):
            with self.assertRaises(ValidationError):
                routes.ExerciseLog(**(values | changes))

    def test_missing_entry_cannot_be_edited(self):
        with self.assertRaises(routes.HTTPException) as context:
            routes.update_log(999, self.entry())
        self.assertEqual(context.exception.status_code, 404)
