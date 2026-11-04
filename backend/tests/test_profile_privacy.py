"""Synthetic profile initialization and private API regression tests."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
import main
from fastapi.testclient import TestClient


class ProfilePrivacyTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        guard = patch.object(database, 'DB_PATH', str(Path(folder.name) / 'profile.db'))
        guard.start()
        self.addCleanup(guard.stop)

    def profile(self):
        conn = database.get_connection()
        try:
            return dict(conn.execute('SELECT * FROM user_profile WHERE id=1').fetchone())
        finally:
            conn.close()

    def assert_synthetic(self, row):
        self.assertEqual({k: row[k] for k in (
            'id', 'name', 'age', 'weight_kg', 'height_cm', 'fitness_goal', 'injury_notes')},
            dict(id=1, name='Synthetic Demo User', age=30, weight_kg=70.0,
                 height_cm=170, fitness_goal='Sample general fitness goal', injury_notes=''))

    def test_empty_database_gets_synthetic_seed(self):
        database.init_db()
        self.assert_synthetic(self.profile())
        conn = database.get_connection()
        try:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM user_profile').fetchone()[0], 1)
        finally:
            conn.close()

    def test_schema_defaults_are_synthetic_with_empty_health_notes(self):
        database.init_db()
        conn = database.get_connection()
        try:
            conn.execute('DELETE FROM user_profile')
            conn.execute('INSERT INTO user_profile DEFAULT VALUES')
            conn.commit()
        finally:
            conn.close()
        self.assert_synthetic(self.profile())

    def test_existing_profile_is_not_overwritten(self):
        database.init_db()
        conn = database.get_connection()
        try:
            # All values here are independently invented test data.
            conn.execute("UPDATE user_profile SET name='Synthetic Saved User', age=40, "
                         "weight_kg=80, height_cm=180, fitness_goal='Synthetic saved goal', "
                         "injury_notes='Synthetic preservation marker'")
            conn.commit()
        finally:
            conn.close()
        before = self.profile()
        database.init_db()
        self.assertEqual(self.profile(), before)

    def test_private_startup_and_profile_update_keep_id_one(self):
        with patch.object(main.app.state, 'demo_mode', False):
            with TestClient(main.app) as client:
                response = client.get('/api/profile')
                self.assertEqual(response.status_code, 200)
                self.assert_synthetic(response.json())
                payload = dict(name='Synthetic Updated User', age=35, weight_kg=75,
                               height_cm=175, fitness_goal='Synthetic updated goal', injury_notes='')
                self.assertEqual(client.post('/api/profile', json=payload).status_code, 200)
                row = client.get('/api/profile').json()
                self.assertEqual(row['id'], 1)
                for key, value in payload.items():
                    self.assertEqual(row[key], value)


if __name__ == '__main__':
    unittest.main()
