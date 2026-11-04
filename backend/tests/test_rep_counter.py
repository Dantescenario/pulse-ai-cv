import math
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.rep_counter import RepCounter


def pose(exercise, degrees=180, visibility=1, right_degrees=None):
    lm=[dict(x=.5,y=.5,visibility=0) for _ in range(33)]
    for side,offset in [("left",0),("right",1)]:
        deg=right_degrees if side=="right" and right_degrees is not None else degrees
        rad=math.radians(deg)
        x=.45+offset*.08
        points={11:(x,.2),23:(x,.55),13:(x,.37),15:(x+.17*math.sin(rad),.37-.17*math.cos(rad)),25:(x,.73),27:(x,.91)}
        if exercise in ("squats","lunges"):
            points[27]=(x+.18*math.sin(rad),.73-.18*math.cos(rad))
        if exercise=="pushups":
            points.update({11:(.2,.4),23:(.5,.4),27:(.85,.4),13:(.2,.55),15:(.2+.15*math.sin(rad),.55-.15*math.cos(rad))})
        if exercise=="lateral_raises":
            points[13]=(x+.17*math.sin(rad),.2+.17*math.cos(rad))
            points[15]=(x+.3*math.sin(rad),.2+.3*math.cos(rad))
        for i,(px,py) in points.items():
            lm[i+offset]=dict(x=px,y=py,visibility=visibility)
    return lm


def angles(start, end):
    return [start]*9+[start+(end-start)*i/20 for i in range(1,21)]+[end]*6+[end+(start-end)*i/20 for i in range(1,21)]+[start]*9


def cases():
    result=[]
    for exercise in ("curls","squats","lunges","pushups","lateral_raises"):
        start,end=(10,90) if exercise=="lateral_raises" else (175,45 if exercise=="curls" else 85)
        values=angles(start,end)*2
        result.append(dict(name=exercise+" two full reps",exercise=exercise,aspect=1,expected=2,frames=[dict(time=i*.05,landmarks=pose(exercise,v)) for i,v in enumerate(values)]))
    for name,values,vis in [("small gestures",angles(175,120)*2,1),("single frame spike",[175]*12+[20]+[175]*20,1),("invisible joints",angles(175,45),0),("partial at start",[45]*10+list(range(45,176,5))+[175]*10,1)]:
        result.append(dict(name=name,exercise="curls",aspect=1,expected=0,frames=[dict(time=i*.05,landmarks=pose("curls",v,vis)) for i,v in enumerate(values)]))
    frames=[dict(time=i*.05,landmarks=pose("curls",v)) for i,v in enumerate(angles(175,45))]
    for frame in frames[30:40]:frame["landmarks"]=None
    result.append(dict(name="tracking loss mid rep",exercise="curls",aspect=1,expected=0,frames=frames))
    frames=[dict(time=i*.05,landmarks=pose("curls",v)) for i,v in enumerate(angles(175,45))]
    for frame in frames:
        for i in [13,14]:frame["landmarks"][i]["y"]=.1
    result.append(dict(name="raised arm gestures",exercise="curls",aspect=1,expected=0,frames=frames))
    frames=[]
    for i,v in enumerate(angles(175,45)):frames.append(dict(time=i*.05,landmarks=pose("curls",v,right_degrees=175)))
    n=len(frames)
    for i,v in enumerate(angles(175,45)):frames.append(dict(time=(n+i)*.05,landmarks=pose("curls",175,right_degrees=v)))
    result.append(dict(name="alternating arms",exercise="curls",aspect=1,expected=2,frames=frames))
    # Continuous curls need no extra pause once a full return has been confirmed.
    values=[175]*9
    for _ in range(3):
        values += [175-130*i/20 for i in range(1,21)]+[45]*4+[45+130*i/20 for i in range(1,21)]+[175]*4
    result.append(dict(name="continuous curls",exercise="curls",aspect=1,expected=3,frames=[dict(time=i*.05,landmarks=pose("curls",v)) for i,v in enumerate(values)]))
    # Arm flexion while torso and hands stay fixed is not a pull-up.
    frames=[]
    for i,deg in enumerate(angles(170,35)):
        lm=pose("curls",175)
        offset=.15*math.cos(math.radians(deg)/2)
        for side in [0,1]:
            x=.45+side*.08
            lm[11+side].update(x=x,y=.45)
            lm[23+side].update(x=x,y=.75)
            lm[15+side].update(x=x,y=.1)
            lm[13+side].update(x=x+offset,y=.275)
        frames.append(dict(time=i*.05,landmarks=lm))
    result.append(dict(name="stationary hand fake pullup",exercise="pullups",aspect=1,expected=0,frames=frames))
    # Real pull-ups keep the hands fixed while the shoulder rises.
    def pullup(deg):
        lm=pose("curls",175)
        length=.22
        distance=2*length*math.sin(math.radians(deg)/2)
        offset=length*math.cos(math.radians(deg)/2)
        for side in [0,1]:
            x=.45+side*.08
            lm[15+side].update(x=x,y=.12)
            lm[11+side].update(x=x,y=.12+distance)
            lm[13+side].update(x=x+offset,y=.12+distance/2)
            lm[23+side].update(x=x,y=.47+distance)
        return lm
    for fps in [12,20,30,60]:
        for exercise in ("pullups","curls","squats","lunges","pushups","lateral_raises"):
            start,end=(10,90) if exercise=="lateral_raises" else (170,60 if exercise in ("pullups","curls") else 85)
            values=angles(start,end)*3
            # Resample the same motion duration to each input frame rate.
            values=[values[min(len(values)-1,int(i*20/fps))] for i in range(round(len(values)*fps/20))]
            frames=[dict(time=i/fps,landmarks=pullup(v) if exercise=="pullups" else pose(exercise,v)) for i,v in enumerate(values)]
            result.append(dict(name=f"{exercise} three reps at {fps} fps",exercise=exercise,aspect=1,expected=3,frames=frames))
    for name,values in [("partial pullups",angles(170,110)),("pullup starts contracted",[60]*10+list(range(60,171,5))+[170]*10)]:
        result.append(dict(name=name,exercise="pullups",aspect=1,expected=0,frames=[dict(time=i*.05,landmarks=pullup(v)) for i,v in enumerate(values)]))
    # Independent portrait geometry; no recorded coordinates or motion samples.
    aspect=9/16
    frames=[]
    for i,deg in enumerate(angles(170,60)*2):
        lm=pullup(deg)
        for point in lm:
            point['x']=.5+(point['x']-.5)/aspect
        frames.append(dict(time=i*.05,landmarks=lm))
    result.append(dict(name="synthetic portrait two pullups",exercise="pullups",aspect=aspect,expected=2,frames=frames))
    # Independent analytic geometry, not sampled or fitted to a recorded clip.
    # Mirror the pose and use a wide image to exercise aspect correction while
    # preserving physical segment lengths, stationary hands and shoulder rise.
    aspect=16/9
    frames=[]
    for i,deg in enumerate(angles(170,60)*4):
        lm=pullup(deg)
        for point in lm:
            point['x']=1-(.5+(point['x']-.5)/aspect)
        frames.append(dict(time=i*.05,landmarks=lm))
    result.append(dict(name="synthetic mirrored wide-frame four pullups",exercise="pullups",aspect=aspect,expected=4,frames=frames))
    # Moving the hands alone must not mimic body rise toward a fixed bar.
    frames=[]
    for i,deg in enumerate(angles(170,60)):
        lm=pullup(deg)
        shift=.6-lm[11]["y"]
        for point in lm:
            point["y"]+=shift
        frames.append(dict(time=i*.05,landmarks=lm))
    result.append(dict(name="moving grip without body rise",exercise="pullups",aspect=1,expected=0,frames=frames))
    return result

class RepTests(unittest.TestCase):
    def test_cases_do_not_read_local_rear_video_fixture(self):
        from unittest.mock import patch
        original_read=Path.read_text
        def guarded_read(path,*args,**kwargs):
            if path.name in ('rear_pullup_landmarks.json','pullup_sample_landmarks.json'):
                raise AssertionError('Local research fixture must not enter tests')
            return original_read(path,*args,**kwargs)
        with patch.object(Path,'read_text',guarded_read):
            generated=cases()
        synthetic=next(c for c in generated if c['name']=='synthetic mirrored wide-frame four pullups')
        self.assertEqual(synthetic['expected'],4)
        self.assertEqual(synthetic['aspect'],16/9)

    def test_sequences(self):
        for case in cases():
            with self.subTest(case=case["name"]):
                tracker=RepCounter(case["exercise"])
                for frame in case["frames"]:
                    state = tracker.update(frame["landmarks"],frame["time"],case["aspect"])
                    if state["rep"]:
                        rep = state["rep"]
                        self.assertLess(rep["start_time"], rep["peak_time"])
                        self.assertLess(rep["peak_time"], rep["end_time"])
                        evidence = rep["counting_evidence"]
                        self.assertTrue(evidence["full_cycle"])
                        self.assertGreaterEqual(evidence["duration_seconds"], .65)
                        self.assertGreaterEqual(evidence["excursion_degrees"], evidence["min_range_degrees"])
                        self.assertGreaterEqual(evidence["return_seconds"], .18)
                self.assertEqual(tracker.reps,case["expected"])

    def test_pause_cancels_incomplete_rep(self):
        tracker=RepCounter("curls")
        values=angles(175,45)
        for i,v in enumerate(values):
            if i==35:tracker.interrupt()
            tracker.update(pose("curls",v),i*.05)
        self.assertEqual(tracker.reps,0)

    def test_missing_and_degenerate_landmarks(self):
        tracker=RepCounter("curls")
        for i in range(30):tracker.update([dict(x=.5,y=.5,visibility=1)]*33,i*.05)
        self.assertEqual(tracker.reps,0)

if __name__=="__main__":unittest.main()
