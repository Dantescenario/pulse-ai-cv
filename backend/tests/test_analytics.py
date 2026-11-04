import sqlite3
import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
import database
import tempfile


class AnalyticsTests(unittest.TestCase):
    def analytics(self, rows=(), offset=330):
        conn = sqlite3.connect(':memory:')
        conn.executescript('''
            CREATE TABLE workout_sessions (reps_completed INTEGER, avg_form_score REAL,
                hypertrophy_score REAL, created_at TEXT);
            CREATE TABLE nutrition_logs (calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL);
        ''')
        conn.executemany('INSERT INTO workout_sessions VALUES (?, ?, ?, ?)', rows)
        with patch.object(main, 'get_connection', return_value=conn):
            return main.get_analytics(tz_offset=offset)

    def test_empty_history_has_no_invented_scores(self):
        result = self.analytics()
        self.assertEqual(result['total_reps'], 0)
        self.assertEqual(result['weekly_active_days'], 0)
        self.assertIsNone(result['avg_form_score'])
        self.assertIsNone(result['avg_hypertrophy_score'])

    def test_zero_scores_are_preserved_and_dates_are_deduplicated(self):
        now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        result = self.analytics([(2, 0, 0, now), (3, 0, 0, now)])
        self.assertEqual(result['total_reps'], 5)
        self.assertEqual(result['avg_form_score'], 0)
        self.assertEqual(result['avg_hypertrophy_score'], 0)
        self.assertEqual(result['weekly_active_days'], 1)

    def test_old_and_future_sessions_do_not_count_as_active_days(self):
        now = datetime.now(timezone.utc)
        dates = [(now - timedelta(days=8)), (now + timedelta(days=8))]
        result = self.analytics([(1, 80, None, d.strftime('%Y-%m-%d %H:%M:%S')) for d in dates])
        self.assertEqual(result['weekly_active_days'], 0)

    def test_optional_measurements_have_no_defaults(self):
        session = main.WorkoutSessionCreate(exercise='squat', reps_completed=2,
                                           avg_form_score=0, duration_seconds=10)
        self.assertIsNone(session.hypertrophy_score)
        self.assertIsNone(session.avg_tut_seconds)
        self.assertIsNone(session.eccentric_tempo_avg)

    def test_invalid_timezone(self):
        with self.assertRaises(main.HTTPException):
            main.get_analytics(tz_offset=841)

    def test_comparison_lookup_uses_full_history_and_separates_sources(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE workout_sessions (id INTEGER PRIMARY KEY, exercise TEXT, source TEXT, created_at TEXT)')
        conn.executemany('INSERT INTO workout_sessions VALUES (?, ?, ?, ?)', [
            (1, 'Squat', 'webcam', '2026-01-01'),
            (2, 'Squat', 'webcam', '2026-01-02'),
            (3, 'Squat', 'webcam', '2026-01-02'),
            (4, 'Squat', 'simulation', '2026-01-03'),
            (5, 'Squat', 'unknown', '2026-01-03'),
            *[(i, 'Curl', 'webcam', '2026-02-01') for i in range(6, 30)],
        ])
        with patch.object(main, 'get_connection', return_value=conn):
            result = main.get_workout_comparisons()
        self.assertEqual({r['id'] for r in result}, {2, 3, 4, 5, 28, 29})
        self.assertEqual([r['id'] for r in result if r['source'] == 'webcam' and r['exercise'] == 'Squat'], [3, 2])

    def test_source_migration_preserves_old_history(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'test.db')
            with sqlite3.connect(path) as conn:
                conn.execute('''CREATE TABLE workout_sessions (
                    id INTEGER PRIMARY KEY, exercise TEXT, reps_completed INTEGER,
                    avg_form_score REAL, duration_seconds INTEGER, created_at TEXT)''')
                conn.execute("INSERT INTO workout_sessions VALUES (1, 'Squat', 2, 80, 10, '2026-01-01')")
            conn.close()
            with patch.object(database, 'DB_PATH', path):
                database.init_db()
                database.init_db()
            with sqlite3.connect(path) as conn:
                self.assertEqual(conn.execute('SELECT source, reps_completed FROM workout_sessions').fetchall(), [('unknown', 2)])
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM nutrition_logs').fetchone()[0], 0)
            conn.close()
