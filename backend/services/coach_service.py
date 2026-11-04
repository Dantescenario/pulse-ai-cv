import os
import json
from database import get_connection


def get_user_context() -> dict:
    """Retrieves grounded user profile and recent workout/nutrition stats."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM user_profile LIMIT 1")
    profile_row = cursor.fetchone()
    profile = dict(profile_row) if profile_row else {}

    cursor.execute("SELECT * FROM workout_sessions ORDER BY created_at DESC LIMIT 5")
    workouts = [dict(w) for w in cursor.fetchall()]

    cursor.execute("SELECT * FROM nutrition_logs ORDER BY created_at DESC LIMIT 5")
    meals = [dict(m) for m in cursor.fetchall()]

    conn.close()
    return {
        "profile": profile,
        "recent_workouts": workouts,
        "recent_meals": meals
    }

def chat_with_coach(user_message: str) -> dict:
    from services.local_coach import retrieve
    context = get_user_context()
    profile = context["profile"]
    injuries = profile.get("injury_notes") or "None recorded"
    reps = sum(w.get("reps_completed", 0) or 0 for w in context["recent_workouts"])
    answer, topic = retrieve(user_message)
    reply = answer + f"\n\nSaved goal: {profile.get('fitness_goal') or 'Not recorded'}. Recent volume: {reps} reps across up to five saved sessions."
    if injuries.casefold() not in ("none", "none recorded", "none reported", ""):
        reply += f"\nProfile injury notes: {injuries}. This guide cannot determine which exercises are safe for an injury; review modifications with a qualified professional."
    return {"reply": reply, "grounded_context": {"injuries_considered": injuries, "recent_volume": f"{reps} reps", "engine": "Local knowledge retrieval", "topic": topic}}
