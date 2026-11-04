from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from database import get_connection

router = APIRouter(prefix='/api/diary', tags=['Exercise diary'])


class ExerciseLog(BaseModel):
    day: date
    exercise: str = Field(min_length=1, max_length=100, pattern=r'\S')
    sets: int = Field(ge=1, le=100)
    reps: int = Field(ge=0, le=10000)
    duration_minutes: float = Field(gt=0, le=1440, allow_inf_nan=False)
    weight_kg: float = Field(default=0, ge=0, le=1000, allow_inf_nan=False)
    notes: str = Field(default='', max_length=2000)


@router.get('')
def diary(day: date):
    conn = get_connection()
    try:
        return [dict(r) for r in conn.execute(
            'SELECT * FROM exercise_logs WHERE day=? ORDER BY id DESC', (day.isoformat(),))]
    finally:
        conn.close()


def write_log(data, log_id=None):
    values = (data.day.isoformat(), data.exercise.strip(), data.sets, data.reps,
              data.duration_minutes, data.weight_kg, data.notes)
    conn = get_connection()
    try:
        if log_id is None:
            cursor = conn.execute('INSERT INTO exercise_logs (day,exercise,sets,reps,duration_minutes,weight_kg,notes) VALUES (?,?,?,?,?,?,?)', values)
            log_id = cursor.lastrowid
        else:
            cursor = conn.execute('UPDATE exercise_logs SET day=?,exercise=?,sets=?,reps=?,duration_minutes=?,weight_kg=?,notes=? WHERE id=?', (*values, log_id))
            if not cursor.rowcount:
                raise HTTPException(404, 'Entry not found')
        conn.commit()
        return {'id': log_id}
    finally:
        conn.close()


@router.post('')
def create_log(data: ExerciseLog):
    return write_log(data)


@router.put('/{log_id}')
def update_log(log_id: int, data: ExerciseLog):
    return write_log(data, log_id)


@router.delete('/{log_id}')
def delete_log(log_id: int):
    conn = get_connection()
    try:
        if not conn.execute('DELETE FROM exercise_logs WHERE id=?', (log_id,)).rowcount:
            raise HTTPException(404, 'Entry not found')
        conn.commit()
        return {'status': 'deleted'}
    finally:
        conn.close()


@router.get('/progress/weekly')
def weekly(start: date, tz_offset: int = Query(default=330, ge=-840, le=840)):
    start = start - timedelta(days=start.weekday())
    end = start + timedelta(days=6)
    conn = get_connection()
    try:
        rows = conn.execute('''
            SELECT day, SUM(minutes) minutes, SUM(reps) reps, SUM(entries) entries FROM (
                SELECT day, duration_minutes minutes, sets * reps reps, 1 entries
                FROM exercise_logs WHERE day BETWEEN ? AND ?
                UNION ALL
                SELECT date(created_at, ?), duration_seconds / 60.0, reps_completed, 1
                FROM workout_sessions WHERE date(created_at, ?) BETWEEN ? AND ?
                AND source != 'simulation'
            ) GROUP BY day
        ''', (start.isoformat(), end.isoformat(), f'{tz_offset:+d} minutes',
              f'{tz_offset:+d} minutes', start.isoformat(), end.isoformat())).fetchall()
        grouped = {r['day']: dict(r) for r in rows}
        days = []
        for i in range(7):
            day = (start + timedelta(days=i)).isoformat()
            days.append(grouped.get(day, {'day': day, 'minutes': 0, 'reps': 0, 'entries': 0}))
        return {'start': start.isoformat(), 'days': days}
    finally:
        conn.close()
