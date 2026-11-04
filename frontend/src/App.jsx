import React, { useState, useEffect } from 'react';
import { StatisticsGuide } from './components/StatInfo';
import Navbar from './components/Navbar';
import VisionTrainer from './components/VisionTrainer';
import NutritionScanner from './components/NutritionScanner';
import Analytics from './components/Analytics';
import WorkoutPlanner from './components/WorkoutPlanner';
import FitnessHub, { Profile } from './components/FitnessHub';
import { ArrowUpRight } from 'lucide-react';
import './design-system.css';

const pages = {
  guide: ['Understand your numbers', 'Statistics guide', 'What each metric means, how to read it and what it can tell you.'],
  diary: ['Training log', 'Daily effort. Long-term progress.', 'Record your training and review your week.'],
  trainer: ['Movement analysis', 'Vision Trainer', 'Capture your movement. Understand every repetition.'],
  workouts: ['Training plan', 'Build your next session', 'Set a target, log your sets and review what comes next.'],
  nutrition: ['Fuel & recovery', 'Nutrition', 'Build your meals and keep your daily intake in view.'],
  analytics: ['Performance overview', 'Your work, in perspective.', 'Compare recorded sessions and explore your training history.'],
  profile: ['Athlete settings', 'Your profile', 'Keep your measurements, goals and training context up to date.'],
};

export default function App() {
  const [selectedTab, setActiveTab] = useState('trainer');
  // Fail closed until the backend explicitly reports that private mode is on.
  const [demoMode, setDemoMode] = useState(true);
  const activeTab = demoMode && !['trainer', 'guide'].includes(selectedTab) ? 'trainer' : selectedTab;
  const [backendOnline, setBackendOnline] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let alive = true;
    const checkBackend = async () => {
      try {
        const api = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
        const resp = await fetch(`${api}/api/health`);
        if (!resp.ok) throw new Error('Health check failed');
        const health = await resp.json();
        if (alive) {
          setBackendOnline(health.status === 'healthy');
          setDemoMode(health.demo_mode !== false);
        }
      } catch {
        if (alive) {
          setBackendOnline(false);
          setDemoMode(true);
        }
      }
    };
    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  const handleDataUpdated = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="app-layout">

      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        backendOnline={backendOnline}
        demoMode={demoMode}
      />

      {/* Main Viewport */}
      <main className={`main-viewport page-${activeTab}`}>
        {demoMode && <p className="portfolio-demo-notice" role="note">
          Public computer vision demo · Personal workout records are not persisted.
          Uploaded videos are processed temporarily on the server; live camera tracking runs in your browser.
          Results are cleared when you leave the trainer.
        </p>}
        <header className="page-heading">
          <div><span className="eyebrow">{pages[activeTab][0]}</span><h2>{pages[activeTab][1]}</h2><p>{pages[activeTab][2]}</p></div>
          <span className="page-context"><ArrowUpRight size={15} /> PulseAI / {activeTab === 'trainer' ? 'Studio' : pages[activeTab][0]}</span>
        </header>
        {!demoMode && activeTab === 'diary' && <FitnessHub onDataUpdated={handleDataUpdated} />}
        {activeTab === 'guide' && <StatisticsGuide />}
        {!demoMode && activeTab === 'profile' && <Profile />}
        {!demoMode && activeTab === 'workouts' && <WorkoutPlanner />}
        {activeTab === 'trainer' && (
          <VisionTrainer demoMode={demoMode} onWorkoutSaved={handleDataUpdated} />
        )}

        {!demoMode && activeTab === 'nutrition' && (
          <NutritionScanner onMealLogged={handleDataUpdated} />
        )}


        {!demoMode && activeTab === 'analytics' && (
          <Analytics key={refreshTrigger} />
        )}
      </main>
    </div>
  );
}
