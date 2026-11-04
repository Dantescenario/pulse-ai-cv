import { normalizeRep, parseRepDetails } from './repReview.js';

const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function sessionMeasurements(session) {
  const reps = parseRepDetails(session.rep_details_json).map(normalizeRep);
  const summarize = key => {
    const values = reps.map(rep => rep[key]).filter(value => Number.isFinite(value) && value >= 0);
    return { value: average(values), count: values.length };
  };
  return {
    reps: { value: Number.isFinite(session.reps_completed) ? session.reps_completed : null },
    angle: summarize('angle'),
    eccentric: summarize('eccentric'),
    concentric: summarize('concentric'),
    duration: summarize('duration'),
  };
}

export function comparisonGroups(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const source = session.source || 'unknown';
    const key = JSON.stringify([session.exercise, source]);
    if (!groups.has(key)) groups.set(key, { key, exercise: session.exercise, source, sessions: [] });
    groups.get(key).sessions.push(session);
  }
  return [...groups.values()].map(group => ({ ...group, sessions: [...group.sessions].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id).slice(0, 2) }));
}

export function measurementDelta(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}
