/**
 * PulseAI Biomechanical HUD & Skeleton Overlay Canvas Engine
 * Renders glowing neon skeletal mesh, torso core cage, active joint angle callouts,
 * pull-up bar clearance line, and exercise-specific depth markers.
 */

export const POSE_CONNECTIONS = [
  // Torso cage
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28]
];

export function drawSkeleton(ctx, landmarks, width, height, activeAngle = null, warning = false, exerciseType = 'squats', stage = 'START') {
  if (!ctx || !landmarks || landmarks.length === 0) return;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Torso Core Cage (Translucent Biomechanical Mesh fill)
  const ls = landmarks[11];
  const rs = landmarks[12];
  const rh = landmarks[24];
  const lh = landmarks[23];

  if (ls && rs && rh && lh && (ls.visibility || 1) > 0.3 && (rh.visibility || 1) > 0.3) {
    ctx.beginPath();
    ctx.moveTo(ls.x * width, ls.y * height);
    ctx.lineTo(rs.x * width, rs.y * height);
    ctx.lineTo(rh.x * width, rh.y * height);
    ctx.lineTo(lh.x * width, lh.y * height);
    ctx.closePath();
    ctx.fillStyle = warning
      ? 'rgba(244, 63, 94, 0.18)'
      : (stage === 'BOTTOM_STRETCH' ? 'rgba(56, 189, 248, 0.22)' : 'rgba(16, 185, 129, 0.16)');
    ctx.fill();
    ctx.strokeStyle = warning ? 'rgba(244, 63, 94, 0.6)' : 'rgba(16, 185, 129, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Cross-strut for core bracing visual
    ctx.beginPath();
    ctx.moveTo(ls.x * width, ls.y * height);
    ctx.lineTo(rh.x * width, rh.y * height);
    ctx.moveTo(rs.x * width, rs.y * height);
    ctx.lineTo(lh.x * width, lh.y * height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
  }

  // 2. Draw Exercise-Specific Biomechanical Guides
  // A. PULL-UP BAR & CHIN CLEARANCE LINE
  if (exerciseType === 'pullups') {
    const lw = landmarks[15];
    const rw = landmarks[16];
    if (lw && rw) {
      const barY = ((lw.y + rw.y) / 2) * height;
      ctx.beginPath();
      ctx.moveTo(width * 0.1, barY);
      ctx.lineTo(width * 0.9, barY);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      ctx.stroke();

      // Chin clearance threshold line (just above bar)
      ctx.beginPath();
      ctx.moveTo(width * 0.25, barY - 18);
      ctx.lineTo(width * 0.75, barY - 18);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
      ctx.stroke();
      ctx.setLineDash([]);

      // Label on bar
      ctx.fillStyle = '#38bdf8';
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillText('BAR LEVEL', width * 0.12, barY - 6);
    }
  }

  // B. SQUAT PARALLEL DEPTH LINE
  if (exerciseType === 'squats' || exerciseType === 'lunges') {
    const knee = landmarks[25] || landmarks[26];
    if (knee) {
      const kneeY = knee.y * height;
      ctx.beginPath();
      ctx.moveTo(width * 0.2, kneeY);
      ctx.lineTo(width * 0.8, kneeY);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#10b981';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText('PARALLEL DEPTH TARGET', width * 0.22, kneeY - 4);
    }
  }

  // 3. Draw Connecting Skeletal Vectors
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = warning
    ? 'rgba(244, 63, 94, 0.9)'
    : (stage === 'BOTTOM_STRETCH' ? 'rgba(56, 189, 248, 0.95)' : 'rgba(16, 185, 129, 0.85)');
  ctx.shadowColor = warning ? '#f43f5e' : (stage === 'BOTTOM_STRETCH' ? '#38bdf8' : '#10b981');
  ctx.shadowBlur = 14;

  POSE_CONNECTIONS.forEach(([startIdx, endIdx]) => {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];

    if (start && end && (start.visibility || 1) > 0.35 && (end.visibility || 1) > 0.35) {
      ctx.beginPath();
      ctx.moveTo(start.x * width, start.y * height);
      ctx.lineTo(end.x * width, end.y * height);
      ctx.stroke();
    }
  });

  // 4. Draw Keypoint Joints
  landmarks.forEach((pt, index) => {
    if (!pt || (pt.visibility || 1) < 0.35) return;

    const x = pt.x * width;
    const y = pt.y * height;

    const isPrimaryJoint = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28].includes(index);
    const radius = isPrimaryJoint ? 7 : 4;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = warning ? '#f43f5e' : (stage === 'BOTTOM_STRETCH' ? '#38bdf8' : '#00f59b');
    ctx.shadowBlur = 10;
    ctx.fill();

    // Outer glow pulse ring
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.strokeStyle = warning ? 'rgba(244, 63, 94, 0.5)' : 'rgba(56, 189, 248, 0.6)';
    ctx.stroke();
  });

  // 5. Draw Active Joint Angle Badge and Arc
  if (activeAngle !== null) {
    let focusJoint = null;
    if (exerciseType === 'squats' || exerciseType === 'lunges') {
      focusJoint = landmarks[25] || landmarks[26];
    } else if (exerciseType === 'pushups' || exerciseType === 'curls' || exerciseType === 'pullups') {
      focusJoint = landmarks[14] || landmarks[13];
    } else if (exerciseType === 'lateral_raises') {
      focusJoint = landmarks[12] || landmarks[11];
    } else {
      focusJoint = landmarks[25] || landmarks[14];
    }

    if (focusJoint) {
      const fx = focusJoint.x * width;
      const fy = focusJoint.y * height;

      // Draw Arc around joint
      ctx.save();
      ctx.beginPath();
      ctx.arc(fx, fy, 28, 0, (activeAngle / 180) * Math.PI);
      ctx.lineWidth = 3;
      ctx.strokeStyle = warning ? '#f43f5e' : '#38bdf8';
      ctx.stroke();

      // Rounded Badge Card
      const badgeW = 78;
      const badgeH = 28;
      const bx = fx + 15;
      const by = fy - 14;

      ctx.fillStyle = 'rgba(9, 14, 26, 0.9)';
      ctx.strokeStyle = warning ? '#f43f5e' : '#10b981';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.fillText(`${activeAngle}° ROM`, bx + 10, by + 18);
      ctx.restore();
    }
  }

  // 6. Grounding Plane Line at Ankles
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];
  if (leftAnkle && rightAnkle) {
    const groundY = Math.max(leftAnkle.y, rightAnkle.y) * height + 10;
    ctx.beginPath();
    ctx.moveTo(width * 0.15, groundY);
    ctx.lineTo(width * 0.85, groundY);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}
