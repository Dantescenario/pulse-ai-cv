export function parseRepDetails(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(rep => rep && typeof rep === 'object' && !Array.isArray(rep)) : [];
  } catch { return []; }
}

export function normalizeRep(rep, index = 0) {
  const eccentric = rep.eccentric_seconds ?? rep.eccentricSeconds;
  const concentric = rep.concentric_seconds ?? rep.concentricSeconds;
  const start = rep.start_time;
  const end = rep.end_time;
  return {
    number: rep.rep_number ?? rep.repNumber ?? index + 1,
    angle: rep.depth_angle ?? rep.depthAngle,
    eccentric, concentric,
    duration: Number.isFinite(eccentric) && Number.isFinite(concentric) ? eccentric + concentric : null,
    side: ['left', 'right'].includes(rep.side) ? rep.side : 'Not recorded',
    evidence: rep.counting_evidence?.full_cycle === true ? rep.counting_evidence : null,
    flaws: Array.isArray(rep.flaws) ? rep.flaws.filter(cue => typeof cue === 'string') : [],
    start, end,
    canReplay: Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start,
  };
}
