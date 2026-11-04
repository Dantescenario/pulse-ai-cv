import React from 'react';
import { Activity, Camera, Utensils, BarChart3, Dumbbell, CalendarDays, UserRound, Info } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, backendOnline, demoMode = true }) {
  const tabs = [
    { id: 'trainer', label: 'Vision Trainer', icon: Camera },
    { id: 'diary', label: 'Daily Log', icon: CalendarDays },
    { id: 'workouts', label: 'Targets', icon: Dumbbell },
    { id: 'nutrition', label: 'Nutrition', icon: Utensils },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'guide', label: 'Stats Guide', icon: Info },
    { id: 'profile', label: 'Profile', icon: UserRound },
  ];

  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="brand">
        <div className="brand-icon">
          <Activity size={24} />
        </div>
        <div className="brand-text">
          <h1>PulseAI</h1>
        </div>
        <span className="brand-badge">{demoMode ? 'Computer vision portfolio' : 'Performance platform'}</span>
      </div>

      <div className="nav-links">
        {tabs.filter(tab => !demoMode || ['trainer', 'guide'].includes(tab.id)).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <Icon size={16} strokeWidth={1.7} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className={`connection-status ${backendOnline ? 'is-online' : ''}`} role="status">
        <span className="connection-dot" />
        {backendOnline ? 'System online' : 'Connecting to server'}
      </div>

    </nav>
  );
}
