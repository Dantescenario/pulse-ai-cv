import os
import json
import tempfile
from fastapi import FastAPI, HTTPException, Body, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from database import get_connection, init_db
from services.nutrition_service import analyze_food_image, search_foods, calculate_meal, Calculation, CatalogueUnavailable
from services.coach_service import chat_with_coach
from plan_routes import router as plan_router
from diary_routes import router as diary_router
from demo_mode import demo_mode_enabled, PortfolioDemoMiddleware
from video_limits import (VideoLimits, VideoUploadMiddleware, VideoRejected, copy_upload,
                          cleanup_stale, prepare_temp_dir, remove_temp, log_failure)

app = FastAPI(title="PulseAI Fitness API", version="1.0.0")
app.state.demo_mode = demo_mode_enabled()
app.state.video_limits = VideoLimits.from_env()
app.add_middleware(VideoUploadMiddleware, limits=app.state.video_limits)
app.add_middleware(PortfolioDemoMiddleware, settings=app.state)
app.include_router(plan_router)
app.include_router(diary_router)

# Enable CORS for React frontend (Vite default is 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class UserProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100, pattern=r'\S')
    age: int = Field(ge=1, le=120)
    weight_kg: float = Field(gt=0, le=600, allow_inf_nan=False)
    height_cm: float = Field(gt=0, le=300, allow_inf_nan=False)
    fitness_goal: str = Field(max_length=500)
    injury_notes: str = Field(max_length=2000)

class WorkoutSessionCreate(BaseModel):
    exercise: str
    source: Literal['webcam', 'video_upload', 'simulation', 'unknown'] = 'unknown'
    reps_completed: int
    avg_form_score: float
    hypertrophy_score: Optional[float] = None
    avg_tut_seconds: Optional[float] = None
    eccentric_tempo_avg: Optional[float] = None
    muscle_activation_json: Optional[str] = "{}"
    duration_seconds: int
    feedback_summary: Optional[str] = ""
    rep_details_json: Optional[str] = "[]"

class MealAnalysisRequest(BaseModel):
    image_base64: str = Field(min_length=1, max_length=11500000)

class NutritionLogCreate(BaseModel):
    meal_name: str = Field(min_length=1, max_length=200)
    calories: int = Field(ge=0, le=100000)
    protein_g: float = Field(ge=0, le=100000)
    carbs_g: float = Field(ge=0, le=100000)
    fat_g: float = Field(ge=0, le=100000)
    fiber_g: float = Field(default=0, ge=0, le=10000, allow_inf_nan=False)
    notes: Optional[str] = ""

class CoachChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

@app.on_event("startup")
def startup():
    cleanup_stale(app.state.video_limits)
    if not app.state.demo_mode:
        init_db()

@app.get("/api/health")
def health():
    return {"status": "healthy", "service": "PulseAI Biomechanics & Nutrition Engine",
            "demo_mode": app.state.demo_mode,
            "video_limits": {"upload_bytes": app.state.video_limits.upload_bytes,
                             "duration_seconds": app.state.video_limits.duration_seconds,
                             "width": app.state.video_limits.width, "height": app.state.video_limits.height}}

@app.get("/api/profile")
def get_profile():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_profile LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    return dict(row)

@app.post("/api/profile")
def update_profile(data: UserProfileUpdate):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE user_profile
    SET name=?, age=?, weight_kg=?, height_cm=?, fitness_goal=?, injury_notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=1
    """, (data.name, data.age, data.weight_kg, data.height_cm, data.fitness_goal, data.injury_notes))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Profile updated"}

@app.get("/api/workouts")
def get_workouts():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM workout_sessions ORDER BY created_at DESC, id DESC LIMIT 20")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.get("/api/workout-comparisons")
def get_workout_comparisons():
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY exercise, source ORDER BY created_at DESC, id DESC
                ) AS session_rank FROM workout_sessions
            ) WHERE session_rank <= 2 ORDER BY created_at DESC, id DESC
        """).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

@app.post("/api/workouts")
def save_workout(data: WorkoutSessionCreate):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO workout_sessions (
        exercise, reps_completed, avg_form_score, hypertrophy_score,
        avg_tut_seconds, eccentric_tempo_avg, muscle_activation_json,
        duration_seconds, feedback_summary, rep_details_json, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.exercise, data.reps_completed, data.avg_form_score, data.hypertrophy_score,
        data.avg_tut_seconds, data.eccentric_tempo_avg, data.muscle_activation_json,
        data.duration_seconds, data.feedback_summary, data.rep_details_json, data.source
    ))
    session_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"status": "success", "session_id": session_id}

@app.get("/api/nutrition")
def get_nutrition_logs(day: Optional[str] = None, tz_offset: int = 330):
    conn = get_connection()
    cursor = conn.cursor()
    if day:
        from datetime import date
        try:
            date.fromisoformat(day)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date; use YYYY-MM-DD")
        if not -840 <= tz_offset <= 840:
            raise HTTPException(status_code=422, detail="Invalid timezone offset")
        cursor.execute("SELECT * FROM nutrition_logs WHERE date(created_at, ?) = ? ORDER BY created_at DESC", (f"{tz_offset:+d} minutes", day))
    else:
        cursor.execute("SELECT * FROM nutrition_logs ORDER BY created_at DESC LIMIT 100")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.post("/api/nutrition/analyze")
def analyze_meal(req: MealAnalysisRequest):
    try:
        return analyze_food_image(req.image_base64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@app.get("/api/nutrition/foods")
def foods(q: str = "", limit: int = 30):
    try:
        return search_foods(q[:200], max(1, min(limit, 100)))
    except CatalogueUnavailable as exc:
        raise HTTPException(status_code=503, detail={'code': exc.code, 'message': exc.message}) from None

@app.get("/api/nutrition/status")
def nutrition_status():
    from services.food_model import model_ready
    try:
        return {"photo_enabled": model_ready(), "engine": "Local Food-101 classifier", **search_foods("", 1)}
    except CatalogueUnavailable as exc:
        raise HTTPException(status_code=503, detail={'code': exc.code, 'message': exc.message}) from None

@app.post("/api/nutrition/calculate")
def calculate(req: Calculation):
    try:
        return calculate_meal(req)
    except CatalogueUnavailable as exc:
        raise HTTPException(status_code=503, detail={'code': exc.code, 'message': exc.message}) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

@app.post("/api/nutrition")
def log_nutrition(data: NutritionLogCreate):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO nutrition_logs (meal_name, calories, protein_g, carbs_g, fat_g, fiber_g, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (data.meal_name, data.calories, data.protein_g, data.carbs_g, data.fat_g, data.fiber_g, data.notes))
    meal_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"status": "success", "meal_id": meal_id}

@app.post("/api/coach/chat")
def coach_chat(req: CoachChatRequest):
    response = chat_with_coach(req.message)
    return response


@app.post("/api/workouts/analyze-video")
def analyze_workout_video(
    file: UploadFile = File(...),
    exercise: str = Form('auto')
):
    """
    Accepts an uploaded workout video + exercise type.
    Runs server-side MediaPipe pose analysis and returns a full biomechanical report.
    """
    limits = app.state.video_limits
    temporary_path = None
    try:
        try:
            from services.video_analysis_service import analyze_video, EXERCISE_CONFIG
        except Exception as error:
            log_failure("Video service import failed", error)
            raise VideoRejected('VIDEO_SERVICE_UNAVAILABLE', 'Video analysis is temporarily unavailable. Please retry later.', 503) from None
        if exercise != 'auto' and exercise not in EXERCISE_CONFIG:
            raise VideoRejected('UNSUPPORTED_EXERCISE', 'Choose one of the six supported exercises.')
        cleanup_stale(limits)
        with tempfile.NamedTemporaryFile(prefix='pulseai-upload-', suffix='.video',
                                         dir=prepare_temp_dir(limits), delete=False) as temporary:
            temporary_path = temporary.name
            copy_upload(file.file, temporary, limits)
        return analyze_video(temporary_path, exercise, fps_skip=2, limits=limits)
    except VideoRejected as error:
        raise HTTPException(status_code=error.status, detail=error.detail) from None
    except Exception as error:
        log_failure("Video analysis failed", error)
        raise HTTPException(status_code=500, detail={
            'code': 'ANALYSIS_FAILED',
            'message': 'Video analysis could not finish. Try a shorter supported video or retry later.',
        }) from None
    finally:
        remove_temp(temporary_path)
        try:
            file.file.close()
        except OSError as error:
            log_failure("Upload spool cleanup failed", error)


@app.get("/api/analytics")
def get_analytics(tz_offset: int = 330):
    if not -840 <= tz_offset <= 840:
        raise HTTPException(status_code=422, detail="Invalid timezone offset")
    conn = get_connection()
    cursor = conn.cursor()

    # Workout stats
    cursor.execute("SELECT COUNT(*), SUM(reps_completed), AVG(avg_form_score), AVG(hypertrophy_score) FROM workout_sessions")
    total_sessions, total_reps, avg_form, avg_hyp = cursor.fetchone()

    from datetime import datetime, timezone, timedelta
    today = (datetime.now(timezone.utc) + timedelta(minutes=tz_offset)).date()
    monday = today - timedelta(days=today.weekday())
    modifier = f"{tz_offset:+d} minutes"
    cursor.execute(
        "SELECT COUNT(DISTINCT date(created_at, ?)) FROM workout_sessions "
        "WHERE date(created_at, ?) BETWEEN ? AND ?",
        (modifier, modifier, monday.isoformat(), today.isoformat()),
    )
    weekly_active_days = cursor.fetchone()[0]

    # Nutrition stats
    cursor.execute("SELECT SUM(calories), SUM(protein_g), SUM(carbs_g), SUM(fat_g) FROM nutrition_logs")
    tot_cal, tot_protein, tot_carbs, tot_fat = cursor.fetchone()

    conn.close()
    return {
        "total_sessions": total_sessions or 0,
        "total_reps": total_reps or 0,
        "avg_form_score": round(avg_form, 1) if avg_form is not None else None,
        "avg_hypertrophy_score": round(avg_hyp, 1) if avg_hyp is not None else None,
        "calories_tracked": tot_cal or 0,
        "protein_tracked_g": round(tot_protein, 1) if tot_protein else 0,
        "carbs_tracked_g": round(tot_carbs, 1) if tot_carbs else 0,
        "fat_tracked_g": round(tot_fat, 1) if tot_fat else 0,
        "weekly_active_days": weekly_active_days
    }

# Register static hosting after API routes so API paths retain their behavior.
from pathlib import Path
from fastapi.staticfiles import StaticFiles
FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
