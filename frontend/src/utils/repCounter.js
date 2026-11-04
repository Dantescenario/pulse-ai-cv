import CONFIG from './repConfig.json';
const angle = (a,b,c) => {
  const ux=a.x-b.x, uy=a.y-b.y, vx=c.x-b.x, vy=c.y-b.y;
  const norm=Math.hypot(ux,uy)*Math.hypot(vx,vy);
  return norm<1e-8 ? null : Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/norm)))*180/Math.PI;
};
export class RepCounter {
  constructor(exercise) {
    if (!CONFIG[exercise]) throw new Error('Unsupported exercise');
    this.exercise=exercise; this.config=CONFIG[exercise]; this.reps=0;
    this.lastTime=null; this.lastValid=null; this.clear();
  }
  clear() {
    this.phase='WAIT_READY'; this.side=null; this.smooth={}; this.baselineSince={}; this.baselines={}; this.armed=new Set();
    this.endpointSince=null; this.started=null; this.peakTime=null; this.extreme=null; this.origin=null;
  }
  interrupt() { this.clear(); this.lastValid=null; }
  measurement(lm,side,aspect) {
    const left=side==='left', cfg=this.config;
    const ids=new Set([...cfg[side],...(left?[11,23]:[12,24])]);
    if(this.exercise==='pushups') ids.add(left?27:28);
    if(!lm || lm.length<29) return null;
    if([...ids].some(i=>!lm[i] || !Number.isFinite(lm[i].x) || !Number.isFinite(lm[i].y) || (lm[i].visibility??0)<.55 || (lm[i].presence??1)<.5)) return null;
    const points=lm.map(p=>p?{...p,x:p.x*aspect}:null);
    const [s,e,w,h]=(left?[11,13,15,23]:[12,14,16,24]).map(i=>points[i]);
    const torso=Math.hypot(s.x-h.x,s.y-h.y);
    if(torso<.04) return null;
    const upright=(h.y-s.y)/torso>.45;
    if(this.exercise==='curls') {
      const upper=angle(h,s,e);
      if(!upright || upper===null || upper>45 || e.y<s.y+.15*torso) return null;
    } else if(this.exercise==='pullups') {
      if(!upright || w.y>s.y+.65*torso) return null;
    } else if(this.exercise==='lateral_raises') {
      if(!upright) return null;
    } else if(this.exercise==='pushups') {
      const ankle=points[left?27:28], body=Math.hypot(s.x-ankle.x,s.y-ankle.y), spine=angle(s,h,ankle);
      if(body<.1 || Math.abs(s.y-ankle.y)/body>.7 || spine===null || spine<130) return null;
    } else if(h.y<=s.y) return null;
    const value=angle(...cfg[side].map(i=>points[i]));
    if(value===null) return null;
    return {angle:value,lift:this.exercise==='pullups'?(s.y-w.y)/torso:0,shoulderY:s.y,wristY:w.y,torso,confidence:Math.min(...[...ids].map(i=>lm[i].visibility??0))};
  }
  update(lm,timestamp,aspect=1) {
    if(!Number.isFinite(timestamp) || !Number.isFinite(aspect) || aspect<=0) return this.snapshot('Waiting for a valid camera frame');
    if(this.lastTime!==null && timestamp<=this.lastTime) return this.snapshot('Waiting for a new camera frame');
    const dt=this.lastTime===null ? .05 : timestamp-this.lastTime;
    if(dt>.35) this.clear();
    this.lastTime=timestamp;
    let valid=Object.fromEntries(['left','right'].map(s=>[s,this.measurement(lm,s,aspect)]).filter(([,m])=>m!==null));
    if(this.side && ['OUTBOUND','RETURN'].includes(this.phase)) valid=valid[this.side]?{[this.side]:valid[this.side]}:{};
    if(!Object.keys(valid).length) {
      this.endpointSince=null; this.baselineSince={};
      if(this.lastValid===null || timestamp-this.lastValid>.25) this.clear();
      return this.snapshot('Keep the working joints visible and take the exercise starting position');
    }
    this.lastValid=timestamp;
    const cfg=this.config;
    for(const [side,m] of Object.entries(valid)) {
      const old=this.smooth[side]??m.angle;
      m.angle=old+(1-Math.exp(-dt/.065))*(m.angle-old); this.smooth[side]=m.angle;
      const base=this.exercise==='pullups'?m.angle>=100 && m.lift>=.45:cfg.increasing?m.angle<=cfg.base:m.angle>=cfg.base;
      if(base) {
        this.baselineSince[side]??=timestamp;
        if(this.exercise!=='pullups' || !this.baselines[side] || m.lift>this.baselines[side].lift) this.baselines[side]={...m};
        if(timestamp-this.baselineSince[side]>=.12) this.armed.add(side);
      } else delete this.baselineSince[side];
    }
    if(['WAIT_READY','READY'].includes(this.phase)) {
      const candidates=Object.keys(valid).filter(s=>this.armed.has(s));
      if(!candidates.length) return this.snapshot('Hold the starting position briefly before the first rep');
      this.phase='READY';
      this.side=this.exercise==='pullups'?candidates.reduce((a,b)=>valid[b].confidence>valid[a].confidence?b:a):candidates.reduce((a,b)=>valid[b].angle*(cfg.increasing?1:-1)>valid[a].angle*(cfg.increasing?1:-1)?b:a);
    }
    const m=valid[this.side], value=m.angle;
    const margin=this.phase==='RETURN'?5:0;
    const base=this.exercise==='pullups'?value>=100 && m.lift>=.45:cfg.increasing?value<=cfg.base+margin:value>=cfg.base-margin;
    const peak=this.exercise==='pullups'?(value<=cfg.peak || m.lift<=.2):cfg.increasing?value>=cfg.peak:value<=cfg.peak;
    this.currentAngle=value;
    if(this.phase==='READY') {
      if(!base && Math.abs(value-cfg.base)>=8) {
        this.phase='OUTBOUND'; this.started=timestamp; this.origin=this.baselines[this.side]??m; this.extreme=value; this.endpointSince=null;
      }
    } else if(['OUTBOUND','RETURN'].includes(this.phase)) {
      if(timestamp-this.started>15) { this.clear(); return this.snapshot('Rep timed out; return to the starting position'); }
      this.extreme=cfg.increasing?Math.max(this.extreme,value):Math.min(this.extreme,value);
      if(this.phase==='OUTBOUND') {
        if(peak) {
          this.endpointSince??=timestamp;
          const enoughLift=this.exercise!=='pullups' || (this.origin.lift-m.lift>=.25 && this.origin.shoulderY-m.shoulderY>=.12*this.origin.torso && Math.abs(this.origin.wristY-m.wristY)<=.35*this.origin.torso);
          if(timestamp-this.endpointSince>=.08 && timestamp-this.started>=.18 && enoughLift) {
            this.phase='RETURN'; this.peakTime=timestamp; this.endpointSince=null;
          }
        } else {
          this.endpointSince=null;
          if(base) this.clear();
        }
      } else if(base) {
        this.endpointSince??=timestamp;
        if(timestamp-this.endpointSince>=.1) {
          const duration=timestamp-this.started, excursion=Math.abs(this.extreme-cfg.base);
          let rep=null;
          if(duration>=.65 && duration<=15 && timestamp-this.peakTime>=.18 && excursion>=cfg.min_range) {
            this.reps++;
            const first=this.peakTime-this.started, second=timestamp-this.peakTime;
            const inverted=['curls','pullups','lateral_raises'].includes(this.exercise);
            rep={rep_number:this.reps,depth_angle:this.extreme,eccentric_seconds:inverted?second:first,concentric_seconds:inverted?first:second,time:timestamp,side:this.side,
              start_time:this.started,peak_time:this.peakTime,end_time:timestamp,
              counting_evidence:{duration_seconds:duration,excursion_degrees:excursion,min_range_degrees:cfg.min_range,return_seconds:second,full_cycle:true}};
          }
          const finishedSide=this.side;
          this.clear();
          if(rep) { this.phase='READY'; this.side=finishedSide; this.armed.add(finishedSide); this.smooth[finishedSide]=value; this.baselineSince[finishedSide]=timestamp-.12; }
          return {...this.snapshot('Rep completed; return to a stable starting position'),rep};
        }
      } else this.endpointSince=null;
    }
    const feedback={READY:'Ready: perform a full controlled rep',OUTBOUND:'Continue to the full working position',RETURN:'Return to the starting position to finish the rep'};
    return this.snapshot(feedback[this.phase]||'Take your starting position');
  }
  snapshot(feedback) { return {reps:this.reps,stage:this.phase,currentAngle:Math.round(this.currentAngle??180),feedback,rep:null}; }
}
