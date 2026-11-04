export const muscles = {
  chest: 'Pectorals', deltoids: 'Deltoids', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Forearms', abs: 'Abdominals', obliques: 'Obliques', quads: 'Quadriceps',
  adductors: 'Adductors', traps: 'Trapezius / upper back', lats: 'Latissimus dorsi',
  back: 'Spinal erectors', glutes: 'Gluteals', hamstrings: 'Hamstrings', calves: 'Calves',
};
export const exerciseMuscles = {
  pullups: { primary: ['lats', 'biceps'], supporting: ['traps', 'deltoids', 'forearms', 'abs'] },
  squats: { primary: ['quads', 'glutes'], supporting: ['adductors', 'back', 'abs', 'calves'] },
  pushups: { primary: ['chest', 'triceps'], supporting: ['deltoids', 'abs', 'obliques'] },
  curls: { primary: ['biceps'], supporting: ['forearms'] },
  lateral_raises: { primary: ['deltoids'], supporting: ['traps'] },
  lunges: { primary: ['quads', 'glutes'], supporting: ['hamstrings', 'adductors', 'calves', 'abs', 'obliques'] },
};
export function validMuscleMap(value) {
  return value && ['primary', 'supporting'].every(key => Array.isArray(value[key]) && value[key].every(id => Object.hasOwn(muscles, id))) && !value.primary.some(id => value.supporting.includes(id));
}
