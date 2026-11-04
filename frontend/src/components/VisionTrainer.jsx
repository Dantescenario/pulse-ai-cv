import MuscleAnatomy from './MuscleAnatomy';
import StatInfo from './StatInfo';
import { displayText } from '../utils/displayText';
import RepReview from './RepReview';
import ExerciseIcon from './ExerciseIcon';
import { loadPose } from '../utils/loadPose';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, RotateCcw, Volume2, VolumeX, CheckCircle, AlertTriangle,
  Sparkles, Award, Zap, Timer,
  Upload, Video, Film, ThumbsUp, ThumbsDown,
  Loader, X, Camera, Bot, Target
} from 'lucide-react';
import './VisionTrainer.css';
import { ExerciseTracker } from '../utils/poseEngine';
import { analyzeWorkoutVideo } from '../utils/videoAnalysisApi';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/* ── EXERCISE INFO ─────────────────────────────────────────────────────────── */
const EXERCISE_INFO = {
  pullups:       { name: 'Pull-up / Chin-up',       color: '#19c995' },
  squats:        { name: 'Barbell Squat',            color: '#65ddb8' },
  pushups:       { name: 'Chest Push-up',            color: '#e9b86d' },
  curls:         { name: 'Bicep Curl',               color: '#a78bfa' },
  lateral_raises:{ name: 'Lateral Raise',            color: '#fb923c' },
  lunges:        { name: 'Lunge',                    color: '#34d399' },
};

/* ── CANVAS SKELETON OVERLAY ───────────────────────────────────────────────── */
const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28]
];

function drawLandmarks(canvas, landmarks, warning = false, stage = 'START', exerciseType = 'pullups', activeAngle = null) {
  if (!canvas || !landmarks || landmarks.length < 29) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // ── Torso fill ──
  const ls = landmarks[11], rs = landmarks[12], lh = landmarks[23], rh = landmarks[24];
  if (ls && rs && lh && rh && (ls.visibility ?? 1) > 0.3) {
    ctx.beginPath();
    ctx.moveTo(ls.x*w, ls.y*h); ctx.lineTo(rs.x*w, rs.y*h);
    ctx.lineTo(rh.x*w, rh.y*h); ctx.lineTo(lh.x*w, lh.y*h);
    ctx.closePath();
    ctx.fillStyle = warning ? 'rgba(244,63,94,0.18)' : (stage==='BOTTOM'?'rgba(56,189,248,0.22)':'rgba(16,185,129,0.16)');
    ctx.fill();
    ctx.strokeStyle = warning ? 'rgba(244,63,94,0.6)' : 'rgba(16,185,129,0.45)';
    ctx.lineWidth = 1.5; ctx.stroke();
    // cross brace
    ctx.beginPath();
    ctx.moveTo(ls.x*w,ls.y*h); ctx.lineTo(rh.x*w,rh.y*h);
    ctx.moveTo(rs.x*w,rs.y*h); ctx.lineTo(lh.x*w,lh.y*h);
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.stroke();
  }

  // ── Exercise guides ──
  if (exerciseType === 'pullups') {
    const lw = landmarks[15], rw = landmarks[16];
    if (lw && rw) {
      const barY = ((lw.y+rw.y)/2)*h;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(w*0.1,barY); ctx.lineTo(w*0.9,barY);
      ctx.lineWidth=3; ctx.strokeStyle='rgba(56,189,248,0.85)';
      ctx.shadowColor='#38bdf8'; ctx.shadowBlur=10; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w*0.25,barY-18); ctx.lineTo(w*0.75,barY-18);
      ctx.lineWidth=1.5; ctx.setLineDash([5,5]); ctx.strokeStyle='rgba(16,185,129,0.7)'; ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#38bdf8'; ctx.font='bold 11px monospace'; ctx.fillText('BAR LEVEL',w*0.12,barY-6);
      ctx.restore();
    }
  }
  if (['squats','lunges'].includes(exerciseType)) {
    const knee = landmarks[25]||landmarks[26];
    if (knee) {
      const ky = knee.y*h;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(w*0.2,ky); ctx.lineTo(w*0.8,ky);
      ctx.lineWidth=1.5; ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(16,185,129,0.55)'; ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#10b981'; ctx.font='bold 10px monospace'; ctx.fillText('PARALLEL DEPTH',w*0.22,ky-4);
      ctx.restore();
    }
  }

  // ── Skeleton lines ──
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.strokeStyle = warning ? 'rgba(244,63,94,0.9)' : (stage==='BOTTOM'?'rgba(56,189,248,0.95)':'rgba(16,185,129,0.88)');
  ctx.shadowColor = warning ? '#f43f5e' : (stage==='BOTTOM'?'#38bdf8':'#10b981');
  ctx.shadowBlur = 12;
  POSE_CONNECTIONS.forEach(([si, ei]) => {
    const s = landmarks[si], e = landmarks[ei];
    if (s && e && (s.visibility??0)>0.25 && (e.visibility??0)>0.25) {
      ctx.beginPath(); ctx.moveTo(s.x*w,s.y*h); ctx.lineTo(e.x*w,e.y*h); ctx.stroke();
    }
  });

  // ── Joints ──
  landmarks.forEach((pt, idx) => {
    if (!pt || (pt.visibility??0)<0.25) return;
    const x = pt.x*w, y = pt.y*h;
    const big = [11,12,13,14,23,24,25,26,15,16].includes(idx);
    const r = big ? 7 : 3.5;
    ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI);
    ctx.fillStyle = warning?'#f43f5e':(stage==='BOTTOM'?'#38bdf8':'#00f59b');
    ctx.shadowBlur=8; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,r+3,0,2*Math.PI);
    ctx.lineWidth=1.5; ctx.strokeStyle=warning?'rgba(244,63,94,0.4)':'rgba(56,189,248,0.5)'; ctx.stroke();
  });

  // ── Angle badge ──
  if (activeAngle != null) {
    let fj = null;
    if (['squats','lunges'].includes(exerciseType)) fj = landmarks[25]||landmarks[26];
    else if (['pushups','curls','pullups'].includes(exerciseType)) fj = landmarks[14]||landmarks[13];
    else if (exerciseType==='lateral_raises') fj = landmarks[12]||landmarks[11];
    else fj = landmarks[25]||landmarks[14];
    if (fj) {
      const fx = fj.x*w, fy = fj.y*h;
      ctx.save();
      ctx.beginPath(); ctx.arc(fx,fy,26,0,(activeAngle/180)*Math.PI);
      ctx.lineWidth=2.5; ctx.strokeStyle=warning?'#f43f5e':'#38bdf8'; ctx.shadowBlur=0; ctx.stroke();
      ctx.fillStyle='rgba(9,14,26,0.92)'; ctx.strokeStyle=warning?'#f43f5e':'#10b981'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.roundRect(fx+12,fy-13,76,26,7); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#fff'; ctx.font='bold 12px monospace';
      ctx.fillText(`${activeAngle}° ROM`, fx+18, fy+5);
      ctx.restore();
    }
  }

  // ── Ground plane ──
  const la = landmarks[27], ra = landmarks[28];
  if (la && ra) {
    const gy = Math.max(la.y,ra.y)*h+8;
    ctx.save(); ctx.beginPath(); ctx.moveTo(w*0.15,gy); ctx.lineTo(w*0.85,gy);
    ctx.strokeStyle='rgba(16,185,129,0.22)'; ctx.lineWidth=2; ctx.setLineDash([6,6]); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
  }
  ctx.shadowBlur=0;
}

/* ── ANGLE CHART ───────────────────────────────────────────────────────────── */
function AngleChart({ angleTimeline }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !angleTimeline?.length) return;
    const c = canvasRef.current, ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0,0,w,h);
    const data = angleTimeline.slice(0, 300);
    const mn = Math.min(...data)-5, mx = Math.max(...data)+5;
    const xScale = w/(data.length-1), yScale = h/(mx-mn);

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(16,185,129,0.15)';
    ctx.lineWidth = 1;
    for(let i=0;i<5;i++){
      const y = (i/4)*h;
      ctx.moveTo(0,y); ctx.lineTo(w,y);
    }
    ctx.stroke();

    const grad = ctx.createLinearGradient(0,0,w,0);
    grad.addColorStop(0,'#19c995'); grad.addColorStop(0.5,'#65ddb8'); grad.addColorStop(1,'#19c995');
    ctx.beginPath();
    data.forEach((v,i) => {
      const x = i*xScale, y = h-(v-mn)*yScale;
      if (i === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.lineJoin='round'; ctx.stroke();

    // Fill under
    ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath();
    ctx.fillStyle = 'rgba(16,185,129,0.07)'; ctx.fill();
  }, [angleTimeline]);

  if (!angleTimeline?.length) return null;
  return (
    <div style={{marginTop:'0.75rem'}}>
      <div style={{fontSize:'0.72rem',color:'#64748b',marginBottom:'0.35rem',display:'flex',justifyContent:'space-between'}}>
        <span>Joint Angle Timeline<StatInfo stat="Joint Angle Timeline" /></span>
        <span style={{color:'#19c995'}}>{angleTimeline.length} frames analyzed</span>
      </div>
      <canvas ref={canvasRef} width={340} height={70}
        style={{width:'100%',height:'70px',borderRadius:'8px',background:'rgba(0,0,0,0.3)'}}/>
    </div>
  );
}

/* ── MAIN COMPONENT ────────────────────────────────────────────────────────── */
export default function VisionTrainer({ onWorkoutSaved, demoMode = true }) {
  const [exercise, setExercise] = useState('pullups');
  const [autoDetect, setAutoDetect] = useState(true);
  const [mode, setMode] = useState('video_upload'); // 'video_upload' | 'webcam' | 'simulation'
  const [isActive, setIsActive] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [cameraError, setCameraError] = useState(null);

  // Video upload state
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState('');

  // Server analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('idle');
  const [uploadLimits, setUploadLimits] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [recognitionDiagnostics, setRecognitionDiagnostics] = useState(null);
  const [analysisErrorCode, setAnalysisErrorCode] = useState(null);

  // Live / simulation telemetry
  const [telemetry, setTelemetry] = useState({
    reps: 0, currentAngle: 180, feedback: 'Upload a video or use Live Camera to begin.',
    stage: 'WAIT_READY', postureWarning: false, avgFormScore: 0, hypertrophyScore: 0,
    tier: 'Awaiting full rep', eccentricTime: 0, tutTotal: 0, muscleActivation: {}, flaws: []
  });
  const [repHistory, setRepHistory] = useState([]);

  // Video playback state (for visualization after analysis)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Overlay replay state (landmark samples from server)
  const [, setCurrentLandmarks] = useState(null);
  const [, setCurrentOverlayAngle] = useState(null);

  // Save state
  const [savingSession, setSavingSession] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showReportCard, setShowReportCard] = useState(false);
  const [savedSessionSummary, setSavedSessionSummary] = useState(null);

  const replayEndRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const trackerRef = useRef(null);
  const animFrameRef = useRef(null);
  const simulationStepRef = useRef(0);
  const poseInstanceRef = useRef(null);
  const webcamRunRef = useRef(0);
  const fileInputRef = useRef(null);
  const analysisRequestRef = useRef(null);
  const overlayFrameRef = useRef(null);

  const stopAllStreams = useCallback(() => {
    replayEndRef.current = null;
    webcamRunRef.current += 1;
    trackerRef.current?.interrupt();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    overlayFrameRef.current = null;
    const pose = poseInstanceRef.current;
    poseInstanceRef.current = null;
    if (pose) Promise.resolve().then(() => pose.close()).catch(console.error);
    if (videoRef.current) {
      if (videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      videoRef.current.pause();
    }
    setVideoPlaying(false);
  }, []);

  useEffect(() => {
    trackerRef.current = new ExerciseTracker(
      exercise,
      (repInfo) => {
        setRepHistory(prev => [...prev, repInfo]);
        if (repInfo.repNumber % 3 === 0 || repInfo.hypertrophyScore >= 95) {

        }
      },
      () => {}
    );
  }, [exercise]);

  useEffect(() => () => {
    analysisRequestRef.current?.abort();
    stopAllStreams();
  }, [stopAllStreams]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/health`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(data => { if (!controller.signal.aborted) setUploadLimits(data?.video_limits || null); }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => () => { if (uploadedVideoUrl) URL.revokeObjectURL(uploadedVideoUrl); }, [uploadedVideoUrl]);

  useEffect(() => {
    if (trackerRef.current) trackerRef.current.audioEnabled = audioEnabled;
  }, [audioEnabled, exercise]);

  const handleVideoMetadata = () => {
    if (videoRef.current && canvasRef.current) {
      const vw = videoRef.current.videoWidth || 640;
      const vh = videoRef.current.videoHeight || 480;
      setVideoAspect(vw / vh);
      canvasRef.current.width = vw;
      canvasRef.current.height = vh;
      setVideoDuration(videoRef.current.duration || 0);
    }
  };

  const handleExerciseChange = (ex) => {
    stopAllStreams();
    setIsActive(false);
    setExercise(ex);
    if (trackerRef.current) trackerRef.current.setExercise(ex);
    resetTelemetry();
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    setAnalysisResult(null);
    setAnalysisError(null);
    setRepHistory([]);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const resetTelemetry = () => {
    setTelemetry({
      reps: 0, currentAngle: 180, feedback: 'Ready for analysis.',
      stage: 'WAIT_READY', postureWarning: false, avgFormScore: 0, hypertrophyScore: 0,
      tier: 'Awaiting full rep', eccentricTime: 0, tutTotal: 0, muscleActivation: {}, flaws: []
    });
  };

  /* ── VIDEO FILE UPLOAD ───────────────────────────────────────────────────── */
  const handleVideoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || analysisRequestRef.current) return;
    e.target.value = '';
    if (uploadLimits && file.size > uploadLimits.upload_bytes) {
      setAnalysisError(`Video exceeds the ${(uploadLimits.upload_bytes / 1048576).toFixed(1)} MiB upload limit. Choose a smaller clip.`);
      return;
    }
    stopAllStreams();
    const url = URL.createObjectURL(file);
    setUploadedFile(file);
    setUploadedVideoUrl(url);
    setUploadedFileName(file.name);
    setMode('video_upload');
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    setAnalysisResult(null);
    setAnalysisError(null);
    setIsActive(false);
    resetTelemetry();
    setRepHistory([]);
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
    }
  };

  /* ── SERVER-SIDE ANALYSIS ────────────────────────────────────────────────── */
  const runServerAnalysis = async () => {
    if (!uploadedFile || analysisRequestRef.current) return;
    const controller = new AbortController();
    analysisRequestRef.current = controller;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisStatus('uploading');
    setRecognitionDiagnostics(null);
    setAnalysisErrorCode(null);
    replayEndRef.current = null;

    try {
      const fd = new FormData();
      fd.append('file', uploadedFile);
      fd.append('exercise', autoDetect ? 'auto' : exercise);

      const result = await analyzeWorkoutVideo(API, fd, {
        signal: controller.signal, onStatus: setAnalysisStatus,
      });
      if (controller.signal.aborted) return;

      if (result.exercise && result.exercise !== exercise) setExercise(result.exercise);
      setAnalysisResult(result);

      // Populate telemetry from result
      setTelemetry({
        reps: result.reps_completed,
        currentAngle: result.avg_depth_angle || 90,
        feedback: result.coaching_verdict || 'Analysis complete.',
        stage: 'COMPLETE',
        postureWarning: result.flaws?.length > 0,
        avgFormScore: result.avg_form_score,
        hypertrophyScore: result.hypertrophy_score,
        tier: result.tier,
        eccentricTime: result.avg_eccentric_tempo,
        tutTotal: result.total_tut_seconds,
        muscleActivation: result.muscle_activation || {},
        flaws: result.flaws || []
      });

      setRepHistory(result.rep_details || []);


      // Start overlay replay if landmark samples available
      if (result.landmark_samples?.length > 0 && videoRef.current) {
        startOverlayReplay(result.landmark_samples, result.exercise || exercise);
      }

    } catch (err) {
      if (controller.signal.aborted) return;
      setAnalysisStatus('failed');
      setAnalysisError(err.message || 'Video analysis failed. Please try again.');
      setRecognitionDiagnostics(err.recognitionDiagnostics ?? null);
      setAnalysisErrorCode(err.code ?? null);
    } finally {
      if (analysisRequestRef.current === controller) analysisRequestRef.current = null;
      if (!controller.signal.aborted) setIsAnalyzing(false);
    }
  };

  /* ── LANDMARK OVERLAY REPLAY (synced to video playback) ─────────────────── */
  const startOverlayReplay = (samples, replayExercise = exercise) => {
    if (!videoRef.current || !canvasRef.current || !samples.length) return;

    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    const runOverlay = () => {
      if (!videoRef.current || !canvasRef.current) return;
      const vt = videoRef.current.currentTime;

      // Binary search keeps scrubbing and long clips fast. Interpolate only
      // adjacent detections, never across a tracking loss.
      let low = 0, high = samples.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (samples[mid].time < vt) low = mid + 1;
        else high = mid;
      }
      const before = samples[Math.max(0, low - 1)];
      const after = samples[Math.min(samples.length - 1, low)];
      const gap = after.time - before.time;
      const nearest = Math.abs(before.time - vt) <= Math.abs(after.time - vt) ? before : after;
      let lm = null;
      if (gap > 0 && gap <= 0.2 && vt >= before.time && vt <= after.time) {
        const t = (vt - before.time) / gap;
        lm = before.landmarks.map((point, i) => {
          const next = after.landmarks[i];
          return { ...point, x: point.x + (next.x - point.x) * t,
            y: point.y + (next.y - point.y) * t,
            visibility: Math.min(point.visibility ?? 1, next.visibility ?? 1) };
        });
      } else if (Math.abs(nearest.time - vt) <= 0.1) {
        lm = nearest.landmarks;
      }
      if (!lm) {
        const canvas = canvasRef.current;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        setCurrentLandmarks(null);
        setCurrentOverlayAngle(null);
      }
      if (lm) {
        const ang = nearest.angle ?? null;
        setCurrentLandmarks(lm);
        setCurrentOverlayAngle(ang);
        drawLandmarks(canvasRef.current, lm, false, nearest.stage ?? 'WAIT_READY', replayExercise, ang);
      }

      overlayFrameRef.current = requestAnimationFrame(runOverlay);
    };

    overlayFrameRef.current = requestAnimationFrame(runOverlay);
  };

  /* ── WEBCAM LIVE TRACKING ────────────────────────────────────────────────── */
  const startWebcam = async () => {
    stopAllStreams();
    const run = webcamRunRef.current;
    const isCurrent = () => webcamRunRef.current === run;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (!isCurrent()) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      if (!isCurrent()) return;

      try {
        const Pose = await loadPose();
        if (!isCurrent()) return;
        const pose = new Pose({ locateFile: f => `${import.meta.env.BASE_URL}mediapipe/pose/${f}` });
        poseInstanceRef.current = pose;
        pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        pose.onResults(({ poseLandmarks }) => {
          if (!isCurrent()) return;
          if (!poseLandmarks) {
            handlePoseFrame(null);
            const canvas = canvasRef.current;
            if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            return;
          }
          handlePoseFrame(poseLandmarks);
        });
        await pose.initialize();
        let lastVideoTime = -1;
        const trackFrame = async () => {
          if (!isCurrent()) return;
          try {
            if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
              lastVideoTime = video.currentTime;
              await pose.send({ image: video });
            }
            if (isCurrent()) animFrameRef.current = requestAnimationFrame(trackFrame);
          } catch (error) {
            failTracking(error);
          }
        };
        function failTracking(error) {
          if (!isCurrent()) return;
          console.error('MediaPipe webcam error:', error);
          stopAllStreams();
          setIsActive(false);
          setCameraError('Pose tracking failed to start. Please retry the camera.');
        }
        if (isCurrent()) animFrameRef.current = requestAnimationFrame(trackFrame);
      } catch (mpErr) {
        if (!isCurrent()) return;
        console.error('MediaPipe webcam error:', mpErr);
        stopAllStreams();
        setIsActive(false);
        setCameraError('Pose tracking failed to start. Please retry the camera.');
      }
    } catch (err) {
      if (!isCurrent()) return;
      stopAllStreams();
      console.error('Camera access failed:', err);
      setCameraError('Camera unavailable. Allow camera access and retry.');
      setIsActive(false);
    }
  };

  const handlePoseFrame = (landmarks) => {
    if (!trackerRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const aspect = mode !== 'simulation' && video?.videoWidth && video?.videoHeight ? video.videoWidth / video.videoHeight : 1;
    const result = trackerRef.current.processLandmarks(landmarks, undefined, aspect);
    setTelemetry({
      reps: result.reps, currentAngle: result.currentAngle, feedback: result.feedback,
      stage: result.stage, postureWarning: result.postureWarning || false,
      avgFormScore: result.avgFormScore ?? 0, hypertrophyScore: result.hypertrophyScore ?? 0,
      tier: result.tier ?? 'Awaiting full rep', eccentricTime: result.eccentricTime ?? 0,
      tutTotal: result.tutTotal || 0, muscleActivation: result.muscleActivation || {},
      flaws: result.flaws || []
    });
    drawLandmarks(canvasRef.current, landmarks, result.postureWarning, result.stage, exercise, result.currentAngle);
  };

  /* ── SIMULATION ──────────────────────────────────────────────────────────── */
  const generateSyntheticLandmarks = (ex, degrees) => {
    const lm=Array.from({length:33},()=>({x:.5,y:.5,visibility:.95}));
    const rad=degrees*Math.PI/180;
    for(const offset of [0,1]) {
      const x=.42+offset*.16, direction=offset?1:-1;
      const p={11:[x,.2],13:[x,.37],15:[x+direction*.17*Math.sin(rad),.37-.17*Math.cos(rad)],23:[x,.55],25:[x,.73],27:[x,.91]};
      if(['squats','lunges'].includes(ex)) p[27]=[x+direction*.18*Math.sin(rad),.73-.18*Math.cos(rad)];
      if(ex==='lateral_raises') { p[13]=[x+direction*.17*Math.sin(rad),.2+.17*Math.cos(rad)]; p[15]=[x+direction*.3*Math.sin(rad),.2+.3*Math.cos(rad)]; }
      if(ex==='pushups') Object.assign(p,{11:[.2,.4+offset*.03],23:[.5,.4+offset*.03],27:[.85,.4+offset*.03],13:[.2,.55+offset*.03],15:[.2+.15*Math.sin(rad),.55-.15*Math.cos(rad)+offset*.03]});
      if(ex==='pullups') {
        const distance=.34*Math.sin(rad/2), sy=.12+distance;
        Object.assign(p,{11:[x,sy],13:[x+direction*.17*Math.cos(rad/2),.12+distance/2],15:[x,.12],23:[x,sy+.3],25:[x,sy+.44],27:[x,sy+.54]});
      }
      for(const [i,[px,py]] of Object.entries(p)) lm[Number(i)+offset]={x:px,y:py,visibility:.95};
    }
    lm[0]={x:.5,y:(lm[11].y+lm[12].y)/2-.09,visibility:.95};
    return lm;
  };

  const startSimulation = () => {
    const tick = () => {
      simulationStepRef.current += 0.038;
      const t = simulationStepRef.current;
      const cycle = (Math.sin(t) + 1) / 2;
      let angle;
      if (exercise === 'pullups') angle = Math.round(52 + cycle * 105);
      else if (exercise === 'squats') angle = Math.round(85 + cycle * 90);
      else if (exercise === 'pushups') angle = Math.round(80 + cycle * 82);
      else if (exercise === 'curls') angle = Math.round(42 + cycle * 115);
      else if (exercise === 'lateral_raises') angle = Math.round(18 + (1-cycle)*74);
      else angle = Math.round(88 + cycle * 80);
      const lm = generateSyntheticLandmarks(exercise, angle);
      handlePoseFrame(lm);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  /* ── TOGGLE ACTIVE ───────────────────────────────────────────────────────── */
  const toggleActive = async () => {
    if (!isActive) {
      setIsActive(true);
      setCameraError(null);
      if (mode === 'webcam') startWebcam();
      else startSimulation();
    } else {
      setIsActive(false);
      stopAllStreams();
    }
  };

  const handleReset = () => {
    if (trackerRef.current) trackerRef.current.reset();
    simulationStepRef.current = 0;
    setRepHistory([]);
    if (overlayFrameRef.current) cancelAnimationFrame(overlayFrameRef.current);
    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisStatus('idle');
    resetTelemetry();
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  /* ── SAVE SESSION ────────────────────────────────────────────────────────── */
  const handleSaveSet = async () => {
    if (demoMode) return;
    if ((analysisResult?.reps_completed ?? telemetry.reps) === 0) return;

    setSavingSession(true);
    const payload = {
      source: mode,
      exercise: EXERCISE_INFO[exercise]?.name || exercise,
      reps_completed: analysisResult?.reps_completed ?? telemetry.reps,
      avg_form_score: analysisResult?.avg_form_score ?? telemetry.avgFormScore,
      hypertrophy_score: analysisResult?.hypertrophy_score ?? telemetry.hypertrophyScore,
      avg_tut_seconds: analysisResult?.avg_tut_seconds ?? Number((telemetry.tutTotal / Math.max(1, telemetry.reps)).toFixed(1)),
      eccentric_tempo_avg: analysisResult?.avg_eccentric_tempo ?? telemetry.eccentricTime,
      muscle_activation_json: JSON.stringify(analysisResult?.muscle_activation ?? telemetry.muscleActivation),
      duration_seconds: Math.max(20, analysisResult?.total_tut_seconds ?? (telemetry.reps * 3)),
      feedback_summary: analysisResult?.coaching_verdict ?? telemetry.feedback,
      rep_details_json: JSON.stringify(analysisResult?.rep_details ?? repHistory)
    };

    try {
      const resp = await fetch(`${API}/api/workouts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (resp.ok) {
        setSaveSuccess(true);
        setSavedSessionSummary(payload);
        setShowReportCard(true);

        if (onWorkoutSaved) onWorkoutSaved();
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSavingSession(false);
    }
  };

  /* ── RATING ANALYSIS ─────────────────────────────────────────────────────── */
  const getRatingAnalysis = () => {
    const reps = analysisResult?.reps_completed ?? telemetry.reps;
    const formScore = analysisResult?.avg_form_score ?? telemetry.avgFormScore;
    const eccentricTime = analysisResult?.avg_eccentric_tempo ?? telemetry.eccentricTime;
    const flaws = analysisResult?.flaws ?? telemetry.flaws ?? [];
    const goods = [], bads = [];
    if (!reps) return { goods: [], bads: ['No complete repetitions were detected. Keep your working joints visible and record the full movement, including the return to the starting position.', ...flaws] };

    if (reps > 0) goods.push(`${reps} verified rep${reps>1?'s':''} detected with tracked joint trajectory.`);
    if (formScore >= 85) goods.push(`High form fidelity (${formScore}%). Full range of motion achieved.`);
    else bads.push(`Form score ${formScore}% — range of motion needs improvement.`);
    if (eccentricTime >= 1.8) goods.push(`Controlled eccentric phase (${eccentricTime}s). Ideal for hypertrophy.`);
    else bads.push(`Eccentric too fast (${eccentricTime}s). Slow down the lowering phase.`);
    if (flaws.length > 0) flaws.forEach(f => bads.push(f));
    else goods.push('No momentum cheating or joint breakdown detected.');
    if (analysisResult?.source === 'mediapipe_server') goods.push('Analyzed with real MediaPipe computer vision — not simulated.');
    return { goods, bads };
  };

  const ratingAnalysis = getRatingAnalysis();
  const activeReps = analysisResult?.reps_completed ?? telemetry.reps;
  const activeHSI = analysisResult?.hypertrophy_score ?? telemetry.hypertrophyScore;
  const activeFormScore = analysisResult?.avg_form_score ?? telemetry.avgFormScore;
  const activeTier = analysisResult?.tier ?? telemetry.tier;
  const activeTUT = analysisResult?.total_tut_seconds ?? telemetry.tutTotal;
  const activeEcc = analysisResult?.avg_eccentric_tempo ?? telemetry.eccentricTime;

  /* ── RENDER ──────────────────────────────────────────────────────────────── */
  return (
    <div className={`vision-trainer-layout${analysisResult || activeReps > 0 ? ' has-report' : ''}`}>
      {(analysisResult || activeReps > 0) && (
        <section className="vision-report" aria-labelledby="vision-report-title">
          <header className="vision-report-header">
            <div>
              <div className="vision-report-status" role="status"><CheckCircle size={18} /> {analysisResult ? 'Analysis complete' : 'Session in progress'}</div>
              <span className="report-label">Movement report</span><h2 id="vision-report-title">{EXERCISE_INFO[exercise]?.name}</h2>
              <p>{analysisResult ? (analysisResult.source === 'mediapipe_server' ? 'Video analysis' : 'Simulated analysis') : mode === 'simulation' ? 'Demo tracking' : 'Live tracking'}</p>
            </div>
            <span className="vision-report-tier">{activeTier}</span>
          </header>
          <div className="vision-report-metrics">
            {[
              ['Completed reps', activeReps],
              ['Form score', activeReps ? `${activeFormScore}%` : '—'],
              ['Hypertrophy stimulus', activeReps ? `${activeHSI}%` : '—'],
              ['Time under tension', `${activeTUT}s`]
            ].map(([label, value]) => <div className="vision-report-metric" key={label}><span>{label}<StatInfo stat={label} /></span><strong>{value}</strong></div>)}
          </div>
          <div className="vision-report-columns">
            <div className="vision-report-points vision-report-strengths">
              <h3><ThumbsUp size={18} /> What went well</h3>
              {ratingAnalysis.goods.length ? <ul>{ratingAnalysis.goods.map((point, i) => <li key={i}>{displayText(point)}</li>)}</ul> : <p>Complete a full repetition to receive feedback on your form and tempo.</p>}
            </div>
            <div className="vision-report-points vision-report-improvements">
              <h3><ThumbsDown size={18} /> What needs improvement</h3>
              <ul>{(ratingAnalysis.bads.length ? [...new Set(ratingAnalysis.bads)] : ['No major flaws detected in the tracked repetitions. Keep your movement controlled in your next set.']).map((point, i) => <li key={i}>{displayText(point)}</li>)}</ul>
            </div>
          </div>
          {analysisResult?.coaching_verdict && (
            <div className="vision-report-verdict">
              <h3><Target size={18} /> Recommended corrections</h3>
              <ul>{analysisResult.coaching_verdict.split(/(?:\r?\n)+|(?<=[.!?])\s+(?=[A-Z])/).filter(point => point.trim()).map((point, i) => <li key={i}>{displayText(point.trim())}</li>)}</ul>
            </div>
          )}
          {!analysisResult?.coaching_verdict && <div className="vision-report-verdict"><h3><Target size={18} /> Recommended corrections</h3><p>{displayText(telemetry.feedback)}</p></div>}
          <p className="report-footnote">Form and stimulus scores are estimates from movement geometry, not clinical measurements.</p>
          {analysisResult?.angle_timeline?.length > 1 && <details className="vision-report-details"><summary>View joint angle timeline</summary><AngleChart angleTimeline={analysisResult.angle_timeline} /></details>}
        </section>
      )}

      {/* ────────────────────── LEFT PANEL ────────────────────── */}
      <div className="glass-card studio-workspace" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Exercise + Mode Selector */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          {/* Exercise pills */}
          <div className="exercise-selector" role="group" aria-label="Exercise" style={{ display: 'flex', gap: '0.3rem', background: 'rgba(0,0,0,0.4)', padding: '0.3rem', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto' }}>
            {Object.entries(EXERCISE_INFO).map(([key, info]) => (
              <button key={key} aria-pressed={exercise === key} disabled={isAnalyzing} onClick={() => { if (mode === 'video_upload') setAutoDetect(false); handleExerciseChange(key); }} style={{
                padding: '0.45rem 0.8rem', borderRadius: '10px', border: 'none',
                background: exercise === key ? `linear-gradient(135deg, ${info.color}, ${info.color}99)` : 'transparent',
                color: exercise === key ? '#020c08' : '#94a3b8',
                fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.2s',
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.3rem'
              }}>
                <ExerciseIcon exercise={key} /> {key === 'lateral_raises' ? 'Lateral raise' : key === 'pullups' ? 'Pull-up' : key === 'pushups' ? 'Push-up' : key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
          {/* Mode + audio */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="capture-modes" role="group" aria-label="Capture mode" style={{ display: 'flex', gap: '0.25rem', background: 'rgba(0,0,0,0.4)', padding: '0.25rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
              {[
                { id: 'video_upload', label: 'Upload video', icon: Upload },
                { id: 'webcam', label: 'Live camera', icon: Camera },
                { id: 'simulation', label: 'Demo', icon: Bot }
              ].map(m => (
                <button key={m.id} aria-pressed={mode === m.id} disabled={isAnalyzing} onClick={() => { if (m.id === mode) return; stopAllStreams(); setMode(m.id); setIsActive(false); setAnalysisResult(null); setRepHistory([]); trackerRef.current?.reset(); resetTelemetry(); }} style={{
                  padding: '0.4rem 0.75rem', borderRadius: '8px', border: mode === m.id ? '1px solid rgba(56,189,248,0.4)' : '1px solid transparent',
                  background: mode === m.id ? 'rgba(56,189,248,0.2)' : 'transparent',
                  color: mode === m.id ? '#65ddb8' : '#94a3b8', fontWeight: 700, fontSize: '0.76rem', cursor: 'pointer'
                }}><m.icon size={15} />{m.label}</button>
              ))}
            </div>
            <button aria-label={audioEnabled ? 'Mute coaching audio' : 'Enable coaching audio'} aria-pressed={audioEnabled} onClick={() => { setAudioEnabled(!audioEnabled); if(trackerRef.current) trackerRef.current.audioEnabled = !audioEnabled; }}
              style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: audioEnabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', color: audioEnabled ? '#19c995' : '#64748b', cursor: 'pointer' }}>
              {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
        </div>

        <p className="studio-instructions" style={{ fontSize: '.78rem', color: '#94a3b8', margin: '0 0 1rem' }}>
          Hold the starting position briefly, complete the movement, then return fully. Keep your working joints visible. Small gestures and incomplete reps are excluded.
          {exercise === 'curls' && ' Alternating curls count once per working arm; simultaneous curls count as one movement.'}
        </p>
        {/* Video Upload Panel */}
        {mode === 'video_upload' && (
          <div className="studio-upload" style={{ padding: '1rem', background: 'rgba(16,185,129,0.06)', borderRadius: '12px', border: '1px dashed rgba(16,185,129,0.35)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <Video size={20} color="#19c995" />
                <div>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc' }}>
                    {uploadedFileName || 'Upload Workout Video'}
                  </span>
                  <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.1rem 0 0' }}>
                    {uploadLimits ? `Up to ${(uploadLimits.upload_bytes / 1048576).toFixed(1)} MiB, ${uploadLimits.duration_seconds}s, ${uploadLimits.width} x ${uploadLimits.height}px. Use a short MP4 clip.` : 'Use a short MP4 clip. The server validates size, duration and frame limits.'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button disabled={isAnalyzing} onClick={() => fileInputRef.current?.click()} className="btn-primary" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}>
                  <Upload size={14} /> Choose Video
                </button>
                <input ref={fileInputRef} type="file" accept="video/*" onChange={handleVideoUpload} style={{ display: 'none' }} />
              </div>
            </div>

            <label style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
              <input type="checkbox" checked={autoDetect} disabled={isAnalyzing} onChange={e => { setAutoDetect(e.target.checked); setAnalysisResult(null); }} /> Automatically identify exercise
              <span style={{ display: 'block', color: '#94a3b8', marginTop: '0.3rem' }}>Upload a single exercise with complete reps. Uncheck to use the exercise selected above.</span>
            </label>
            {analysisResult?.exercise_detection && <p role="status" style={{ color: '#19c995', fontSize: '0.85rem' }}>Identified: {EXERCISE_INFO[analysisResult.exercise]?.name}. Review before saving; select an exercise above to correct and reanalyze.</p>}
            {/* Analyze button */}
            {uploadedFile && !isAnalyzing && (
              <button onClick={runServerAnalysis} className="btn-primary" style={{ alignSelf: 'flex-start', padding: '0.6rem 1.4rem', fontSize: '0.88rem' }}>
                <Sparkles size={16} /> Analyze video
              </button>
            )}

            {isAnalyzing && (
              <div role="status" aria-live="polite" style={{ fontSize: '0.8rem', color: '#19c995' }}>
                <Loader size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
                {analysisStatus === 'uploading' ? 'Uploading video…' : 'Upload sent. Server validating and analyzing video…'}
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                  Waiting for the server result. Any previous report remains available until a new analysis succeeds.
                </p>
              </div>
            )}

            {analysisError && (
              <div style={{ padding: '0.65rem 0.9rem', borderRadius: '8px', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: '#fca5a5', fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Analysis Error:</strong> {analysisError}
                  <div style={{ fontSize: '0.72rem', marginTop: '0.2rem', color: '#f43f5e' }}>
                    {analysisErrorCode === 'EXERCISE_UNCLEAR'
                      ? 'Turn off automatic detection, select your exercise above, and analyze again.'
                      : 'Try a shorter video. If this continues, contact the site administrator with the error above.'}
                  </div>
                  {import.meta.env.DEV && recognitionDiagnostics && (
                    <details>
                      <summary>Recognition diagnostics (development)</summary>
                      <p>Scores rank movement evidence; they are not probabilities or calibrated confidence.</p>
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(recognitionDiagnostics, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </div>
            )}

            {analysisResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.8rem', borderRadius: '8px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <CheckCircle size={16} color="#19c995" />
                <span style={{ fontSize: '0.8rem', color: '#19c995', fontWeight: 700 }}>
                  Latest successful analysis: {analysisResult.reps_completed} reps detected • {analysisResult.source === 'mediapipe_server' ? ' Pose analysis' : ' Synthetic fallback'}
                </span>
              </div>
            )}
          </div>
        )}

        {cameraError && (
          <div style={{ padding: '0.6rem 0.85rem', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#fde68a', fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
            <AlertTriangle size={16} /><span>{cameraError}</span>
          </div>
        )}

        {/* ── VIDEO / CANVAS VIEWPORT ── */}
        <div className="studio-video" style={{
          position: 'relative', width: mode === 'simulation' ? '100%' : `min(100%, ${640 * videoAspect}px)`, aspectRatio: mode === 'simulation' ? '4/3' : String(videoAspect), maxHeight: '640px',
          background: '#030712', borderRadius: '16px', overflow: 'hidden',
          border: `2px solid ${telemetry.postureWarning ? 'rgba(244,63,94,0.7)' : 'rgba(16,185,129,0.35)'}`,
          boxShadow: telemetry.postureWarning ? '0 0 35px rgba(244,63,94,0.25)' : '0 0 35px rgba(16,185,129,0.15)'
        }}>
          {/* Video element */}
          <video
            ref={videoRef}
            onLoadedMetadata={handleVideoMetadata}
            onTimeUpdate={() => {
              const video = videoRef.current;
              if (!video) return;
              if (replayEndRef.current !== null && video.currentTime >= replayEndRef.current) {
                const end = replayEndRef.current;
                replayEndRef.current = null;
                video.pause();
                video.currentTime = end;
              }
              setVideoCurrentTime(video.currentTime);
            }}
            onPlay={() => setVideoPlaying(true)}
            onPause={() => setVideoPlaying(false)}
            onEnded={() => setVideoPlaying(false)}
            playsInline muted
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              objectFit: 'contain',
              transform: mode === 'webcam' ? 'scaleX(-1)' : 'none',
              display: (mode === 'webcam' || uploadedVideoUrl) ? 'block' : 'none'
            }}
          />

          {/* Idle placeholder */}
          {!uploadedVideoUrl && mode !== 'webcam' && mode !== 'simulation' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: '#64748b' }}>
              <Film size={52} color="rgba(16,185,129,0.3)" />
              <p style={{ fontSize: '0.88rem', textAlign: 'center', maxWidth: '280px' }}>
                Upload a workout video or switch to Live Camera to start pose analysis
              </p>
            </div>
          )}

          {/* Skeleton Canvas */}
          <canvas
            ref={canvasRef}
            width={640} height={480}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain', transform: mode === 'webcam' ? 'scaleX(-1)' : 'none', pointerEvents: 'none', zIndex: 10 }}
          />

          {/* Top HUD badges */}
          <div className="studio-hud" style={{ position: 'absolute', top: '0.9rem', left: '0.9rem', right: '0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20, pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.8rem', borderRadius: '9999px', background: 'rgba(9,14,26,0.88)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', fontSize: '0.76rem', fontWeight: 700 }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isActive || isAnalyzing ? '#19c995' : (analysisResult ? '#65ddb8' : '#64748b'), display: 'inline-block', animation: (isActive||isAnalyzing) ? 'pulse 1.2s infinite' : 'none' }} />
              {isAnalyzing ? 'SERVER ANALYSIS RUNNING' : isActive ? (mode === 'webcam' ? 'LIVE CV TRACKING' : 'DEMO SIMULATION') : analysisResult ? 'ANALYSIS COMPLETE' : 'IDLE'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ padding: '0.35rem 0.75rem', borderRadius: '9999px', background: 'rgba(9,14,26,0.88)', border: '1px solid rgba(56,189,248,0.3)', color: '#65ddb8', fontSize: '0.76rem', fontWeight: 700 }}>
                ROM<StatInfo stat="ROM" />: <span style={{ fontFamily: 'monospace' }}>{telemetry.currentAngle}°</span>
              </div>
              {activeReps > 0 && (
                <div style={{ padding: '0.35rem 0.75rem', borderRadius: '9999px', background: 'rgba(9,14,26,0.88)', border: '1px solid rgba(16,185,129,0.3)', color: '#19c995', fontSize: '0.76rem', fontWeight: 700 }}>
                  {activeReps} Reps
                </div>
              )}
            </div>
          </div>

        </div>

          {/* Bottom feedback */}
          <div className={`studio-feedback ${telemetry.postureWarning ? 'has-warning' : ''}`} style={{
            position: 'absolute', bottom: '0.9rem', left: '0.9rem', right: '0.9rem',
            padding: '0.85rem 1.1rem', borderRadius: '12px',
            background: telemetry.postureWarning ? 'rgba(244,63,94,0.9)' : 'rgba(15,23,42,0.9)',
            border: `1px solid ${telemetry.postureWarning ? '#f43f5e' : 'rgba(16,185,129,0.35)'}`,
            backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', gap: '0.7rem', zIndex: 20
          }}>
            {telemetry.postureWarning ? <AlertTriangle size={18} color="#fff" /> : <Sparkles size={18} color="#19c995" />}
            <div>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff' }}>{analysisResult ? 'Analysis complete. Review your detailed movement report.' : displayText(telemetry.feedback)}</span>
              <div style={{ fontSize: '0.7rem', color: telemetry.postureWarning ? '#ffe4e6' : '#94a3b8' }}>
                Exercise: <strong>{EXERCISE_INFO[exercise]?.name}</strong>
                {analysisResult && <span style={{ marginLeft: '0.5rem', color: '#19c995' }}>• {analysisResult.source === 'mediapipe_server' ? ' Pose analysis' : ' Simulated'}</span>}
              </div>
            </div>
          </div>


        {/* Video scrubber for uploaded videos after analysis */}
        {mode === 'video_upload' && videoDuration > 0 && analysisResult && (
          <div className="studio-playback" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.3)', padding: '0.65rem 1rem', borderRadius: '10px' }}>
            <button aria-label={videoPlaying ? 'Pause video' : 'Play video'} onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current.pause()}
              style={{ padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(16,185,129,0.15)', color: '#19c995', cursor: 'pointer' }}>
              {videoPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace', minWidth: '70px' }}>
              {Math.floor(videoCurrentTime)}s / {Math.floor(videoDuration)}s
            </span>
            <input aria-label="Video playback position" type="range" min="0" max={videoDuration||100} step="0.1" value={videoCurrentTime}
              onChange={e => { replayEndRef.current = null; const t = parseFloat(e.target.value); setVideoCurrentTime(t); if(videoRef.current) videoRef.current.currentTime = t; }}
              style={{ flex: 1, accentColor: '#19c995', cursor: 'pointer' }} />
            {[0.5, 1.0, 1.5].map(spd => (
              <button key={spd} aria-label={`Playback speed ${spd} times`} aria-pressed={playbackSpeed === spd} onClick={() => { setPlaybackSpeed(spd); if(videoRef.current) videoRef.current.playbackRate = spd; }}
                style={{ padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: playbackSpeed===spd ? '#19c995' : 'transparent', color: playbackSpeed===spd ? '#020c08' : '#cbd5e1', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                {spd}x
              </button>
            ))}
          </div>
        )}

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            {mode !== 'video_upload' && (
              <button className="btn-primary" onClick={toggleActive} style={{ padding: '0.7rem 1.5rem', fontSize: '0.88rem' }}>
                {isActive ? <><Pause size={17} /> Pause</> : <><Play size={17} /> {mode === 'webcam' ? 'Start Live' : 'Run Demo'}</>}
              </button>
            )}
            <button className="btn-secondary" disabled={isAnalyzing} onClick={handleReset} style={{ padding: '0.7rem 1rem' }} title="Reset">
              <RotateCcw size={17} /><span>Reset</span>
            </button>
          </div>
          {!demoMode && <button
            onClick={handleSaveSet}
            disabled={isAnalyzing || activeReps === 0 || savingSession}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.7rem 1.3rem', borderRadius: '12px',
              border: `1px solid ${activeReps > 0 ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
              background: activeReps > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.04)',
              color: activeReps > 0 ? '#19c995' : '#64748b',
              fontWeight: 700, fontSize: '0.88rem', cursor: activeReps > 0 ? 'pointer' : 'not-allowed', transition: 'all 0.2s'
            }}>
            {saveSuccess ? <><CheckCircle size={17} color="#19c995" /> Saved!</> : <><Award size={17} /> Save session</>}
          </button>}
        </div>


      </div>

      {/* ────────────────────── RIGHT PANEL ────────────────────── */}
      <div className="studio-telemetry" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Reps card */}
        <div className="glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.73rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', fontWeight: 700 }}>Verified Reps<StatInfo stat="Verified Reps" /></span>
            <span style={{ padding: '0.25rem 0.65rem', borderRadius: '6px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#19c995', fontSize: '0.72rem', fontWeight: 700 }}>
              <Zap size={11} style={{ display:'inline',marginRight:'3px' }} />{activeTier}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginTop: '0.3rem' }}>
            <div style={{ fontSize: '4.2rem', lineHeight: 1, fontFamily: 'monospace', fontWeight: 800, color: '#19c995', textShadow: '0 0 25px rgba(16,185,129,0.4)' }}>
              {activeReps}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#65ddb8', fontSize: '0.82rem' }}>
                <Timer size={13} /><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{activeTUT}s</span> TUT
              </div>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Time Under Tension<StatInfo stat="Time under tension" /></span>
            </div>
          </div>
        </div>

        {/* HSI Card */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>Hypertrophy Stimulus Index<StatInfo stat="Hypertrophy Stimulus Index" /></span>
              <p style={{ fontSize: '0.7rem', color: '#94a3b8', margin: '0.1rem 0 0' }}>ROM (40%) + Tempo (35%) + Stability (25%)</p>
            </div>
            <span style={{ fontFamily: 'monospace', fontSize: '1.35rem', color: '#19c995', fontWeight: 800 }}>{activeHSI}%</span>
          </div>
          <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.06)', borderRadius: '9999px', overflow: 'hidden' }}>
            <div style={{ width: `${activeHSI}%`, height: '100%', background: 'linear-gradient(90deg,#19c995,#65ddb8)', borderRadius: '9999px', transition: 'width 0.5s ease' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '0.5rem', marginTop: '0.75rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Eccentric Tempo<StatInfo stat="Eccentric Tempo" /></span>
              <div style={{ fontWeight: 700, color: '#19c995', fontSize: '0.82rem' }}>{activeEcc}s</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '8px' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Form Score<StatInfo stat="Form Score" /></span>
              <div style={{ fontWeight: 700, color: '#65ddb8', fontSize: '0.82rem' }}>{activeFormScore}%</div>
            </div>
          </div>
          {analysisResult?.hsi_breakdown && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.4rem', marginTop: '0.5rem' }}>
              {[['ROM', analysisResult.hsi_breakdown.rom_score, 40], ['Tempo', analysisResult.hsi_breakdown.tempo_score, 35], ['Stability', analysisResult.hsi_breakdown.stability_score, 25]].map(([label, val, max]) => (
                <div key={label} style={{ background: 'rgba(0,0,0,0.3)', padding: '0.4rem', borderRadius: '7px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{label} / {max}<StatInfo stat={label} /></div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 800, color: val/max >= 0.85 ? '#19c995' : val/max >= 0.7 ? '#65ddb8' : '#e9b86d', fontSize: '0.9rem' }}>{val}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <MuscleAnatomy key={exercise} exercise={exercise} exerciseName={EXERCISE_INFO[exercise]?.name} />

        <div className="glass-card">
          <RepReview reps={repHistory} onReplay={mode === 'video_upload' && analysisResult ? (start, end) => {
            const video = videoRef.current;
            if (!video || end > video.duration + 0.1) return;
            video.pause();
            video.currentTime = start;
            setVideoCurrentTime(start);
            replayEndRef.current = end;
            video.play().catch(() => { replayEndRef.current = null; });
          } : undefined} />
        </div>

      </div>

      {/* ── REPORT CARD MODAL ── */}
      {!demoMode && showReportCard && savedSessionSummary && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,18,0.88)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div className="glass-card session-saved-dialog" role="dialog" aria-modal="true" aria-label="Session saved" style={{ maxWidth: '540px', width: '100%', padding: '1.75rem', border: '1px solid rgba(16,185,129,0.45)', boxShadow: '0 0 60px rgba(16,185,129,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Award size={24} color="#19c995" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>{savedSessionSummary.exercise} — Session Saved</h3>
                  <span style={{ fontSize: '0.73rem', color: '#94a3b8' }}>Comprehensive Biomechanical Report</span>
                </div>
              </div>
              <button aria-label="Close saved session" onClick={() => setShowReportCard(false)} style={{ padding: '0.4rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {[
                { label: 'Reps', value: savedSessionSummary.reps_completed, color: '#19c995' },
                { label: 'HSI Score', value: `${savedSessionSummary.hypertrophy_score}%`, color: '#65ddb8' },
                { label: 'Avg TUT', value: `${savedSessionSummary.avg_tut_seconds}s`, color: '#e9b86d' }
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: 'rgba(0,0,0,0.35)', padding: '0.85rem', borderRadius: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{label}<StatInfo stat={label} /></div>
                  <div style={{ fontFamily: 'monospace', fontSize: '1.65rem', fontWeight: 800, color }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '0.85rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: '1.25rem' }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#19c995', marginBottom: '0.4rem' }}> Movement Summary</h4>
              <p style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.55 }}>{displayText(savedSessionSummary.feedback_summary)}</p>
            </div>

            <button className="btn-primary" onClick={() => setShowReportCard(false)} style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}>
              Continue Training
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
