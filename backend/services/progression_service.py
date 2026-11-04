"""Transparent progression rules for user-configured exercise targets."""
from pydantic import BaseModel, Field, model_validator
from typing import Optional, Literal

EXERCISES = {
    'pullups': 'Pull-up / Chin-up', 'squats': 'Barbell Squat',
    'pushups': 'Chest Push-up', 'curls': 'Bicep Curl',
    'lateral_raises': 'Lateral Raise', 'lunges': 'Lunge',
}

class PlanInput(BaseModel):
    exercise: Literal['pullups', 'squats', 'pushups', 'curls', 'lateral_raises', 'lunges']
    target_sets: int = Field(ge=1, le=12)
    reps_min: int = Field(ge=1, le=100)
    reps_max: int = Field(ge=1, le=100)
    load_kg: float = Field(ge=0, le=1000, allow_inf_nan=False)
    increment_kg: float = Field(gt=0, le=50, allow_inf_nan=False)
    rest_seconds: int = Field(ge=0, le=1800)
    max_rpe: float = Field(ge=1, le=10, allow_inf_nan=False)

    @model_validator(mode='after')
    def ordered_reps(self):
        if self.reps_min > self.reps_max:
            raise ValueError('Minimum reps cannot exceed maximum reps')
        return self

class SetInput(BaseModel):
    reps: int = Field(ge=0, le=1000)
    load_kg: float = Field(ge=0, le=1000, allow_inf_nan=False)
    rpe: Optional[float] = Field(default=None, ge=1, le=10, allow_inf_nan=False)
    rest_seconds: Optional[int] = Field(default=None, ge=0, le=1800)
    workout_session_id: Optional[int] = Field(default=None, gt=0)

class RunInput(BaseModel):
    target: PlanInput
    sets: list[SetInput] = Field(min_length=1, max_length=12)

def suggest_next(target, sets):
    reasons = []
    if len(sets) != target['target_sets']:
        reasons.append('The number of logged sets differs from the target.')
    if any(abs(s['load_kg'] - target['load_kg']) > .001 for s in sets):
        reasons.append('One or more sets used a different external load.')
    if any(s['reps'] < target['reps_max'] for s in sets):
        reasons.append('Not every set reached the top of the rep range.')
    if any(s.get('rpe') is None for s in sets):
        reasons.append('Perceived difficulty is missing for one or more sets.')
    elif any(s['rpe'] > target['max_rpe'] for s in sets):
        reasons.append('Perceived difficulty exceeded your configured limit.')
    if any(s.get('rest_seconds') is None for s in sets[1:]):
        reasons.append('Rest before a later set was not recorded.')
    elif any(s['rest_seconds'] < target['rest_seconds'] for s in sets[1:]):
        reasons.append('Rest before a later set was shorter than your target.')
    next_load = round(target['load_kg'] + target['increment_kg'], 3)
    if next_load > 1000:
        reasons.append('The proposed load exceeds the supported input range.')
    increase = not reasons
    return {
        'action': 'increase_load' if increase else 'repeat_target',
        'next_load_kg': next_load if increase else target['load_kg'],
        'reasons': reasons or ['Every target set reached the top rep count at the target load, within your difficulty limit and with the recorded rest.'],
        'rule_version': 1,
    }
