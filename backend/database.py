import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "pulse_fitness.db"))

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    # User Profile table: defaults are synthetic demonstration data, not a real person.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY,
        name TEXT DEFAULT 'Synthetic Demo User',
        age INTEGER DEFAULT 30,
        weight_kg REAL DEFAULT 70.0,
        height_cm REAL DEFAULT 170,
        fitness_goal TEXT DEFAULT 'Sample general fitness goal',
        injury_notes TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Workout Sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS workout_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise TEXT NOT NULL,
        reps_completed INTEGER NOT NULL,
        avg_form_score REAL NOT NULL,
        hypertrophy_score REAL DEFAULT NULL,
        avg_tut_seconds REAL DEFAULT NULL,
        eccentric_tempo_avg REAL DEFAULT NULL,
        muscle_activation_json TEXT DEFAULT '{}',
        duration_seconds INTEGER NOT NULL,
        feedback_summary TEXT,
        rep_details_json TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Check and add columns dynamically if existing table lacks them
    cursor.execute("PRAGMA table_info(workout_sessions)")
    existing_cols = [c[1] for c in cursor.fetchall()]
    new_cols = {
        "hypertrophy_score": "REAL DEFAULT NULL",
        "avg_tut_seconds": "REAL DEFAULT NULL",
        "eccentric_tempo_avg": "REAL DEFAULT NULL",
        "muscle_activation_json": "TEXT DEFAULT '{}'",
        "source": "TEXT DEFAULT 'unknown'"
    }
    for col_name, col_type in new_cols.items():
        if col_name not in existing_cols:
            cursor.execute(f"ALTER TABLE workout_sessions ADD COLUMN {col_name} {col_type}")

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS exercise_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        exercise TEXT NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        duration_minutes REAL NOT NULL,
        weight_kg REAL NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS workout_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise TEXT NOT NULL UNIQUE,
        target_sets INTEGER NOT NULL,
        reps_min INTEGER NOT NULL,
        reps_max INTEGER NOT NULL,
        load_kg REAL NOT NULL,
        increment_kg REAL NOT NULL,
        rest_seconds INTEGER NOT NULL,
        max_rpe REAL NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workout_plan_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL,
        target_json TEXT NOT NULL,
        sets_json TEXT NOT NULL,
        suggestion_json TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Nutrition Logs table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS nutrition_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_name TEXT NOT NULL,
        calories INTEGER NOT NULL,
        protein_g REAL NOT NULL,
        carbs_g REAL NOT NULL,
        fat_g REAL NOT NULL,
        fiber_g REAL DEFAULT 0,
        notes TEXT,
        image_preview TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Seed synthetic demonstration data only if empty; never overwrite a saved profile.
    # The first INTEGER PRIMARY KEY remains id=1 for private profile updates.
    cursor.execute("SELECT COUNT(*) FROM user_profile")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT INTO user_profile (name, age, weight_kg, height_cm, fitness_goal, injury_notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """, ('Synthetic Demo User', 30, 70.0, 170, 'Sample general fitness goal', ''))

    conn.commit()
    conn.close()

# Initialization is performed explicitly by application startup in private mode.
# Importing this module must not open or modify an existing database.
