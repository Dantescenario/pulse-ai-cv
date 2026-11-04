import { RepCounter } from './repCounter';
/**
 * PulseAI Biomechanical Pose Engine & Hypertrophy Evaluation Core
 * Real-time joint kinematics, Time-Under-Tension (TUT), eccentric tempo tracking,
 * and Hypertrophy Stimulus Index (HSI) for resistance training.
 */

// Calculate 2D angle between three joints (A - B - C) where B is vertex
export function calculateAngle(pointA, pointB, pointC) {
  if (!pointA || !pointB || !pointC) return 0;
  const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                  Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return Math.round(angle);
}

// MediaPipe 33 Landmark indices
export const LANDMARKS = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

export const EXERCISE_METRICS = {
  squats: {
    name: 'Barbell/Goblet Squat',
    primaryMuscle: 'Quadriceps & Gluteus Maximus',
    targetDepth: 90,
    idealEccentricTempo: 2.5, // seconds
    muscles: ['Quads (Vastus Lateralis)', 'Gluteus Maximus', 'Adductor Magnus', 'Spinal Stability']
  },
  pushups: {
    name: 'Chest Push-up',
    primaryMuscle: 'Pectoralis Major & Triceps',
    targetDepth: 85,
    idealEccentricTempo: 2.2,
    muscles: ['Pectoralis Major', 'Anterior Deltoids', 'Triceps Brachii', 'Core Plank Integrity']
  },
  curls: {
    name: 'Strict Bicep Curl',
    primaryMuscle: 'Biceps Brachii',
    targetDepth: 45,
    idealEccentricTempo: 2.5,
    muscles: ['Biceps Brachii', 'Brachialis', 'Brachioradialis', 'Torso Anti-Swing']
  },
  lateral_raises: {
    name: 'Dumbbell Lateral Raise',
    primaryMuscle: 'Lateral Deltoids',
    targetDepth: 90,
    idealEccentricTempo: 2.0,
    muscles: ['Lateral Deltoid', 'Supraspinatus', 'Upper Trap Isolation', 'Shoulder Alignment']
  },
  lunges: {
    name: 'Walking/Reverse Lunge',
    primaryMuscle: 'Quadriceps & Glutes',
    targetDepth: 90,
    idealEccentricTempo: 2.2,
    muscles: ['Quads', 'Gluteal Complex', 'Hamstrings', 'Knee Joint Stability']
  },
  pullups: {
    name: 'Strict Pull-up / Chin-up',
    primaryMuscle: 'Latissimus Dorsi & Biceps',
    targetDepth: 55,
    idealEccentricTempo: 2.5,
    muscles: ['Latissimus Dorsi (Lats)', 'Teres Major & Rhomboids', 'Biceps Brachii', 'Core Anti-Kip Stability']
  }
};

export class ExerciseTracker {
  constructor(exerciseType='squats',onRepComplete=null,onVoiceAlert=null) {
    this.exerciseType=exerciseType; this.onRepComplete=onRepComplete; this.onVoiceAlert=onVoiceAlert; this.audioEnabled=true; this.reset();
  }
  setExercise(type) { this.exerciseType=type; this.reset(); }
  reset() {
    this.counter=new RepCounter(this.exerciseType); this.reps=0; this.stage='WAIT_READY'; this.repScores=[]; this.repTelemetry=[];
    this.repFlaws=new Set(); this.totalTUTSeconds=0; this.lastRepHypertrophyScore=0; this.lastRepTier='Awaiting full rep'; this.lastVoiceTime=0;
  }
  interrupt() { this.counter.interrupt(); this.repFlaws.clear(); this.stage='WAIT_READY'; }
  getAverageScore() { return this.repScores.length?Math.round(this.repScores.reduce((a,b)=>a+b,0)/this.repScores.length):0; }
  processLandmarks(landmarks,timestamp=performance.now()/1000,aspect=1) {
    const state=this.counter.update(landmarks,timestamp,aspect); this.reps=state.reps; this.stage=state.stage;
    const rep=state.rep;
    const flaws=[];
    const side=(rep?.side??this.counter.side)==='right'?1:0;
    const s=landmarks?.[11+side], e=landmarks?.[13+side], h=landmarks?.[23+side], a=landmarks?.[27+side];
    const visible=p=>p && (p.visibility??0)>=.55;
    if(visible(s)&&visible(h)) {
      const torso=Math.max(.04,Math.hypot((s.x-h.x)*aspect,s.y-h.y));
      if(this.exerciseType==='curls' && visible(e) && calculateAngle(h,s,e)>25) flaws.push('Keep your upper arm close to your torso');
      if(this.exerciseType==='pullups' && Math.abs((h.x-s.x)*aspect)>torso*.65) flaws.push('Reduce torso swing');
      if(this.exerciseType==='pushups' && visible(a) && calculateAngle(s,h,a)<155) flaws.push('Keep shoulders, hips and ankles aligned');
      if(['squats','lunges'].includes(this.exerciseType)) {
        const [lk,rk,la,ra,rs]=[25,26,27,28,12].map(i=>landmarks[i]);
        if([lk,rk,la,ra,rs].every(visible) && Math.abs((rs.x-s.x)*aspect)>torso*.3 && state.currentAngle<130 && Math.abs(lk.x-rk.x)<Math.abs(la.x-ra.x)*.72) flaws.push('Keep knees tracking over your feet');
      }
    }
    if(state.stage==='WAIT_READY' && !rep) this.repFlaws.clear();
    if(['OUTBOUND','RETURN'].includes(state.stage)||rep) flaws.forEach(f=>this.repFlaws.add(f));
    if(rep) {
      const target=EXERCISE_METRICS[this.exerciseType].targetDepth;
      const depthError=this.exerciseType==='lateral_raises'?Math.max(0,target-rep.depth_angle):Math.max(0,rep.depth_angle-target);
      const score=Math.round(Math.max(12,40-depthError*1.2)+(rep.eccentric_seconds<1.3?15:rep.eccentric_seconds<2?26:35)+Math.max(5,25-this.repFlaws.size*8));
      this.lastRepHypertrophyScore=score; this.lastRepTier=score>=92?'Tier S':score>=82?'Tier A':score>=70?'Tier B':'Tier C';
      this.repScores.push(score); this.totalTUTSeconds+=rep.eccentric_seconds+rep.concentric_seconds;
      const info={repNumber:rep.rep_number,depthAngle:Math.round(rep.depth_angle),eccentricSeconds:Number(rep.eccentric_seconds.toFixed(2)),concentricSeconds:Number(rep.concentric_seconds.toFixed(2)),hypertrophyScore:score,tier:this.lastRepTier,flaws:[...this.repFlaws],side:rep.side};
      Object.assign(info, {start_time:rep.start_time,peak_time:rep.peak_time,end_time:rep.end_time,counting_evidence:rep.counting_evidence});
      this.repTelemetry.push(info); this.onRepComplete?.(info); this.repFlaws.clear();
      if(this.audioEnabled && typeof window!=='undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(this.reps)));
      }
    }
    return {...state,targetAngle:EXERCISE_METRICS[this.exerciseType].targetDepth,avgFormScore:this.getAverageScore(),hypertrophyScore:this.lastRepHypertrophyScore,tier:this.lastRepTier,eccentricTime:this.repTelemetry.at(-1)?.eccentricSeconds??0,tutTotal:Number(this.totalTUTSeconds.toFixed(1)),muscleActivation:state.stage==='WAIT_READY'?{}:Object.fromEntries(EXERCISE_METRICS[this.exerciseType].muscles.map((m,i)=>[m,Math.round(Math.max(20,Math.min(95,45+(180-state.currentAngle)*.25-i*7)))])),postureWarning:flaws.length>0,flaws};
  }
}
