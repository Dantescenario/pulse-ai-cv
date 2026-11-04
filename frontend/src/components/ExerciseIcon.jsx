import React from 'react';

const poses = {
  pullups: { head: [12, 8], body: 'M12 11v6m0-5L6 8V4m6 8 6-4V4m-6 13-4 4m4-4 4 4', extra: 'M3 3h18' },
  squats: { head: [10, 4], body: 'M10 7l3 6-6 2 4 6m2-8 5 3-2 5M11 9l7-1' },
  pushups: { head: [5, 10], body: 'M8 11l6 2 7 5M9 12l-2 6h4', extra: 'M3 21h18' },
  curls: { head: [12, 4], body: 'M12 7v8m0-6-5 3-3-4m8 1 5 3 3-4M12 15l-4 6m4-6 4 6', extra: 'M2 6l4 2m12 0 4-2' },
  lateral_raises: { head: [12, 4], body: 'M12 7v8M3 9h18m-9 6-4 6m4-6 4 6', extra: 'M2 7v4m20-4v4' },
  lunges: { head: [12, 4], body: 'M12 7v7m0-5-5 3m5-3 5 3m-5 2-6 2v5m6-7 5 6h4' },
};

export default function ExerciseIcon({ exercise }) {
  const pose = poses[exercise] || poses.squats;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx={pose.head[0]} cy={pose.head[1]} r="1.8" />
    <path d={pose.body} />{pose.extra && <path d={pose.extra} />}
  </svg>;
}
