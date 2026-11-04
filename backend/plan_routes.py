import json
from fastapi import APIRouter, HTTPException
from database import get_connection
from services.progression_service import PlanInput, RunInput, EXERCISES, suggest_next

router = APIRouter(prefix='/api/plans')

@router.get('/available-sets')
def available_sets():
    conn = get_connection()
    try:
        return [dict(row) for row in conn.execute('''
            SELECT * FROM workout_sessions AS session
            WHERE source IN ('webcam', 'video_upload') AND NOT EXISTS (
                SELECT 1 FROM workout_plan_runs, json_each(sets_json)
                WHERE json_extract(value, '$.workout_session_id') = session.id
            ) ORDER BY created_at DESC, id DESC LIMIT 20
        ''')]
    finally:
        conn.close()

@router.get('')
def list_plans():
    conn = get_connection()
    try:
        plans = [dict(row) for row in conn.execute('SELECT * FROM workout_plans ORDER BY id')]
        for plan in plans:
            row = conn.execute('SELECT * FROM workout_plan_runs WHERE plan_id=? ORDER BY id DESC LIMIT 1', (plan['id'],)).fetchone()
            plan['latest_run'] = decode_run(row) if row else None
        return plans
    finally:
        conn.close()

def decode_run(row):
    run = dict(row)
    for key in ('target', 'sets', 'suggestion'):
        run[key] = json.loads(run.pop(key + '_json'))
    return run

@router.post('')
def save_plan(data: PlanInput):
    values = data.model_dump()
    conn = get_connection()
    try:
        with conn:
            conn.execute('''INSERT INTO workout_plans
                (exercise,target_sets,reps_min,reps_max,load_kg,increment_kg,rest_seconds,max_rpe)
                VALUES (:exercise,:target_sets,:reps_min,:reps_max,:load_kg,:increment_kg,:rest_seconds,:max_rpe)
                ON CONFLICT(exercise) DO UPDATE SET target_sets=excluded.target_sets,
                reps_min=excluded.reps_min,reps_max=excluded.reps_max,load_kg=excluded.load_kg,
                increment_kg=excluded.increment_kg,rest_seconds=excluded.rest_seconds,
                max_rpe=excluded.max_rpe,updated_at=CURRENT_TIMESTAMP''', values)
        return dict(conn.execute('SELECT * FROM workout_plans WHERE exercise=?', (data.exercise,)).fetchone())
    finally:
        conn.close()

@router.get('/{plan_id}/runs')
def list_runs(plan_id: int):
    conn = get_connection()
    try:
        return [decode_run(row) for row in conn.execute('SELECT * FROM workout_plan_runs WHERE plan_id=? ORDER BY id DESC LIMIT 20', (plan_id,))]
    finally:
        conn.close()

@router.post('/{plan_id}/runs')
def log_run(plan_id: int, data: RunInput):
    conn = get_connection()
    try:
        with conn:
            row = conn.execute('SELECT * FROM workout_plans WHERE id=?', (plan_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail='Target not found')
            target = dict(row)
            if any(target[key] != value for key, value in data.target.model_dump().items()):
                raise HTTPException(status_code=409, detail='This target changed. Reload Workout Targets and review it before logging.')
            sets = [s.model_dump() for s in data.sets]
            linked = set()
            for item in sets:
                session_id = item['workout_session_id']
                if session_id is None:
                    continue
                session = conn.execute('SELECT * FROM workout_sessions WHERE id=?', (session_id,)).fetchone()
                if session_id in linked or not session or session['source'] not in ('webcam', 'video_upload') or session['exercise'] != EXERCISES[target['exercise']] or session['reps_completed'] != item['reps']:
                    raise HTTPException(status_code=422, detail='Each linked set must be a distinct matching camera/video session with the same rep count')
                if conn.execute('SELECT 1 FROM workout_plan_runs WHERE EXISTS (SELECT 1 FROM json_each(sets_json) WHERE json_extract(value, \'$.workout_session_id\') = ?) LIMIT 1', (session_id,)).fetchone():
                    raise HTTPException(status_code=422, detail='This tracked set is already linked to a workout')
                linked.add(session_id)
            suggestion = suggest_next(target, sets)
            cursor = conn.execute('INSERT INTO workout_plan_runs (plan_id,target_json,sets_json,suggestion_json) VALUES (?,?,?,?)',
                                 (plan_id, json.dumps(target), json.dumps(sets), json.dumps(suggestion)))
            result = decode_run(conn.execute('SELECT * FROM workout_plan_runs WHERE id=?', (cursor.lastrowid,)).fetchone())
        return result
    finally:
        conn.close()
