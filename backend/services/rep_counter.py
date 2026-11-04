"""Time-based full-cycle rep counter. Timestamps are seconds in source media."""
import json
import math
from pathlib import Path
CONFIG = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/utils/repConfig.json").read_text())

def angle(a, b, c):
    u = (a["x"]-b["x"], a["y"]-b["y"])
    v = (c["x"]-b["x"], c["y"]-b["y"])
    norm = math.hypot(*u)*math.hypot(*v)
    if norm < 1e-8:
        return None
    return math.degrees(math.acos(max(-1, min(1, (u[0]*v[0]+u[1]*v[1])/norm))))

class RepCounter:
    def __init__(self, exercise):
        if exercise not in CONFIG:
            raise ValueError("Unsupported exercise")
        self.exercise = exercise
        self.config = CONFIG[exercise]
        self.reps = 0
        self.last_time = None
        self.last_valid = None
        self.clear()

    def clear(self):
        self.phase = "WAIT_READY"
        self.side = None
        self.smooth = {}
        self.baseline_since = {}
        self.baselines = {}
        self.armed = set()
        self.endpoint_since = None
        self.started = None
        self.peak_time = None
        self.extreme = None
        self.origin = None

    def interrupt(self):
        self.clear()
        self.last_valid = None

    def measurement(self, lm, side, aspect):
        cfg = self.config
        ids = set(cfg[side]) | ({11,23} if side == "left" else {12,24})
        if self.exercise == "pushups":
            ids.add(27 if side == "left" else 28)
        if not lm or len(lm) < 29:
            return None
        if any(not lm[i] or not all(math.isfinite(lm[i].get(k, float("nan"))) for k in ("x","y")) or lm[i].get("visibility",0) < .55 or lm[i].get("presence",1) < .5 for i in ids):
            return None
        points = [{**p, "x":p["x"]*aspect} if p else None for p in lm]
        s,e,w,h = [points[i] for i in ([11,13,15,23] if side == "left" else [12,14,16,24])]
        torso = math.hypot(s["x"]-h["x"],s["y"]-h["y"])
        if torso < .04:
            return None
        upright = (h["y"]-s["y"])/torso > .45
        if self.exercise == "curls":
            upper = angle(h,s,e)
            if not upright or upper is None or upper > 45 or e["y"] < s["y"]+.15*torso:
                return None
        elif self.exercise == "pullups":
            if not upright or w["y"] > s["y"]+.65*torso:
                return None
        elif self.exercise == "lateral_raises":
            if not upright:
                return None
        elif self.exercise == "pushups":
            ankle = points[27 if side == "left" else 28]
            body = math.hypot(s["x"]-ankle["x"],s["y"]-ankle["y"])
            spine = angle(s,h,ankle)
            if body < .1 or abs(s["y"]-ankle["y"])/body > .7 or spine is None or spine < 130:
                return None
        elif h["y"] <= s["y"]:
            return None
        a,b,c = [points[i] for i in cfg[side]]
        value = angle(a,b,c)
        if value is None:
            return None
        return {"angle":value, "lift":(s["y"]-w["y"])/torso if self.exercise == "pullups" else 0,
                "shoulderY":s["y"], "wristY":w["y"], "torso":torso,
                "confidence":min(lm[i].get("visibility",0) for i in ids)}

    def update(self, lm, timestamp, aspect=1):
        if not math.isfinite(timestamp) or not math.isfinite(aspect) or aspect <= 0:
            return self.snapshot("Waiting for a valid camera frame")
        if self.last_time is not None and timestamp <= self.last_time:
            return self.snapshot("Waiting for a new camera frame")
        dt = timestamp-self.last_time if self.last_time is not None else .05
        if dt > .35:
            self.clear()
        self.last_time = timestamp
        measures = {side:self.measurement(lm,side,aspect) for side in ("left","right")}
        valid = {s:m for s,m in measures.items() if m is not None}
        if self.side and self.phase in ("OUTBOUND","RETURN"):
            valid = {self.side:valid[self.side]} if self.side in valid else {}
        if not valid:
            self.endpoint_since = None
            self.baseline_since = {}
            if self.last_valid is None or timestamp-self.last_valid > .25:
                self.clear()
            return self.snapshot("Keep the working joints visible and take the exercise starting position")
        self.last_valid = timestamp
        cfg = self.config
        for side,m in valid.items():
            old = self.smooth.get(side,m["angle"])
            m["angle"] = old + (1-math.exp(-dt/.065))*(m["angle"]-old)
            self.smooth[side] = m["angle"]
            base = (m["angle"] >= 100 and m["lift"] >= .45) if self.exercise == "pullups" else (m["angle"] <= cfg["base"] if cfg["increasing"] else m["angle"] >= cfg["base"])
            if base:
                self.baseline_since.setdefault(side,timestamp)
                if self.exercise != "pullups" or side not in self.baselines or m["lift"] > self.baselines[side]["lift"]:
                    self.baselines[side] = dict(m)
                if timestamp-self.baseline_since[side] >= .12:
                    self.armed.add(side)
            else:
                self.baseline_since.pop(side,None)
        def progress(side):
            return valid[side]["angle"]*(1 if cfg["increasing"] else -1)
        if self.phase in ("WAIT_READY","READY"):
            candidates = [s for s in valid if s in self.armed]
            if not candidates:
                return self.snapshot("Hold the starting position briefly before the first rep")
            self.phase = "READY"
            self.side = max(candidates,key=lambda side: valid[side]["confidence"]) if self.exercise == "pullups" else max(candidates,key=progress)
        m = valid[self.side]
        value = m["angle"]
        base = value <= cfg["base"] if cfg["increasing"] else value >= cfg["base"]
        if self.phase == "RETURN":
            base = value <= cfg["base"]+5 if cfg["increasing"] else value >= cfg["base"]-5
        if self.exercise == "pullups":
            base = value >= 100 and m["lift"] >= .45
        peak = (value <= cfg["peak"] or m["lift"] <= .2) if self.exercise == "pullups" else (value >= cfg["peak"] if cfg["increasing"] else value <= cfg["peak"])
        self.current_angle = value
        if self.phase == "READY":
            if not base and abs(value-cfg["base"]) >= 8:
                self.phase = "OUTBOUND"
                self.started = timestamp
                self.origin = self.baselines.get(self.side, m)
                self.extreme = value
                self.endpoint_since = None
        elif self.phase in ("OUTBOUND","RETURN"):
            if timestamp-self.started > 15:
                self.clear()
                return self.snapshot("Rep timed out; return to the starting position")
            self.extreme = max(self.extreme,value) if cfg["increasing"] else min(self.extreme,value)
            if self.phase == "OUTBOUND":
                if peak:
                    self.endpoint_since = self.endpoint_since if self.endpoint_since is not None else timestamp
                    enough_lift = self.exercise != "pullups" or (self.origin["lift"]-m["lift"] >= .25 and self.origin["shoulderY"]-m["shoulderY"] >= .12*self.origin["torso"] and abs(self.origin["wristY"]-m["wristY"]) <= .35*self.origin["torso"])
                    if timestamp-self.endpoint_since >= .08 and timestamp-self.started >= .18 and enough_lift:
                        self.phase = "RETURN"
                        self.peak_time = timestamp
                        self.endpoint_since = None
                else:
                    self.endpoint_since = None
                    if base:
                        self.clear()
            elif base:
                self.endpoint_since = self.endpoint_since if self.endpoint_since is not None else timestamp
                if timestamp-self.endpoint_since >= .1:
                    duration = timestamp-self.started
                    excursion = abs(self.extreme-cfg["base"])
                    rep = None
                    if .65 <= duration <= 15 and timestamp-self.peak_time >= .18 and excursion >= cfg["min_range"]:
                        self.reps += 1
                        first,second = self.peak_time-self.started,timestamp-self.peak_time
                        eccentric,concentric = (second,first) if self.exercise in ("curls","pullups","lateral_raises") else (first,second)
                        rep = dict(rep_number=self.reps,depth_angle=round(self.extreme,1),eccentric_seconds=round(eccentric,2),concentric_seconds=round(concentric,2),time=round(timestamp,3),side=self.side)
                        rep.update(start_time=self.started, peak_time=self.peak_time, end_time=timestamp,
                                   counting_evidence=dict(duration_seconds=duration, excursion_degrees=excursion,
                                                          min_range_degrees=cfg["min_range"], return_seconds=second,
                                                          full_cycle=True))
                    finished_side = self.side
                    self.clear()
                    if rep:
                        self.phase = "READY"
                        self.side = finished_side
                        self.armed.add(finished_side)
                        self.smooth[finished_side] = value
                        self.baseline_since[finished_side] = timestamp-.12
                    result = self.snapshot("Rep completed; return to a stable starting position")
                    result["rep"] = rep
                    return result
            else:
                self.endpoint_since = None
        return self.snapshot({"READY":"Ready: perform a full controlled rep", "OUTBOUND":"Continue to the full working position", "RETURN":"Return to the starting position to finish the rep"}.get(self.phase,"Take your starting position"))

    def snapshot(self, feedback):
        return {"reps":self.reps,"stage":self.phase,"currentAngle":round(getattr(self,"current_angle",180)),"feedback":feedback,"rep":None}
