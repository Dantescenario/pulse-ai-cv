import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Sparkles, ShieldAlert, Cpu, Settings2, Check } from 'lucide-react';

const SUGGESTED_QUERIES = [
  "Can I squat heavy today with my lower back tightness?",
  "Calculate my optimal daily protein and calorie targets",
  "Design a 3-day hypertrophy split that protects my lumbar spine",
  "How can I prevent knee caving during deep squats?"
];

export default function AICoach() {
  const [messages, setMessages] = useState([
    {
      sender: 'coach',
      text: "Hello! I am your local fitness guide. I retrieve guidance from a bundled knowledge base and include your saved profile and workout totals. Ask about technique, training plans, or meal logging.",
      context: { engine: "Pulse Grounded Biomechanics Coach" }
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  // Synthetic demonstration defaults; no personal or health-history seed data.
  const [editForm, setEditForm] = useState({
    name: 'Synthetic Demo User',
    weight_kg: 70.0,
    fitness_goal: 'Sample general fitness goal',
    injury_notes: ''
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchProfile = async () => {
    try {
      const resp = await fetch('/api/profile');
      if (resp.ok) {
        const data = await resp.json();
        setProfile(data);
        setEditForm({
          name: data.name,
          weight_kg: data.weight_kg,
          fitness_goal: data.fitness_goal,
          injury_notes: data.injury_notes ?? ''
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSend = async (queryToSend = null) => {
    const text = queryToSend || inputText;
    if (!text.trim() || loading) return;

    const userMsg = { sender: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    try {
      const resp = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (resp.ok) {
        const data = await resp.json();
        setMessages(prev => [
          ...prev,
          { sender: 'coach', text: data.reply, context: data.grounded_context }
        ]);
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { sender: 'coach', text: "Unable to reach the training guide. Please try again." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      const resp = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          ...editForm
        })
      });
      if (resp.ok) {
        setEditingProfile(false);
        fetchProfile();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="coach-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', height: 'calc(100vh - 140px)' }}>

      {/* LEFT: Chat Conversation Viewport */}
      <div className="glass-card coach-conversation" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1.25rem' }}>

        {/* Chat Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={22} color="#19c995" />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Pulse AI Coach</h3>
              <span style={{ fontSize: '0.75rem', color: '#19c995', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Cpu size={12} /> Technique & training guidance
              </span>
            </div>
          </div>

          <button
            onClick={() => setEditingProfile(!editingProfile)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.4rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.03)',
              color: '#94a3b8',
              fontSize: '0.78rem',
              cursor: 'pointer'
            }}
          >
            <Settings2 size={14} /> Edit Memory Context
          </button>
        </div>

        {/* Message Feed */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%'
              }}
            >
              {m.sender === 'coach' && (
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={18} color="#19c995" />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{
                  padding: '0.9rem 1.15rem',
                  borderRadius: '14px',
                  background: m.sender === 'user'
                    ? 'linear-gradient(135deg, #19c995, #059669)'
                    : 'rgba(255,255,255,0.04)',
                  color: m.sender === 'user' ? '#021a10' : '#f8fafc',
                  border: m.sender === 'user' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  fontSize: '0.88rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap'
                }}>
                  {m.text}
                </div>

                {m.context && (
                  <div style={{
                    fontSize: '0.72rem',
                    color: '#64748b',
                    display: 'flex',
                    gap: '0.5rem',
                    paddingLeft: '0.25rem'
                  }}>
                    <span>Profile context: {m.context.injuries_considered || "Profile data"}</span>
                  </div>
                )}
              </div>

              {m.sender === 'user' && (
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User size={18} color="#65ddb8" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', color: '#19c995', fontSize: '0.85rem' }}>
              <Bot size={20} />
              <span>Analyzing movement logs & retrieving biomechanics protocols...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Quick Prompts */}
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.75rem' }}>
          {SUGGESTED_QUERIES.map((q, i) => (
            <button
              key={i}
              onClick={() => handleSend(q)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '9999px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
                color: '#cbd5e1',
                fontSize: '0.75rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s'
              }}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
          <input
            type="text"
            placeholder="Ask about exercises, form issues, recovery, or nutrition..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            style={{
              flex: 1,
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              padding: '0.75rem 1.1rem',
              color: '#fff',
              fontSize: '0.9rem',
              outline: 'none'
            }}
          />
          <button
            className="btn-primary"
            onClick={() => handleSend()}
            disabled={loading || !inputText.trim()}
            style={{ padding: '0.75rem 1.25rem' }}
          >
            <Send size={18} /><span className="sr-only">Send message</span>
          </button>
        </div>

      </div>

      {/* RIGHT: Grounded Memory Profile Drawer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={18} color="#e9b86d" /> Training context
            </h3>
            <span className="tag tag-emerald">Profile context</span>
          </div>

          {editingProfile ? (
            <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Athlete Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.45rem', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Weight (kg)</label>
                <input
                  type="number"
                  step="0.5"
                  value={editForm.weight_kg}
                  onChange={(e) => setEditForm({ ...editForm, weight_kg: parseFloat(e.target.value) })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.45rem', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Fitness Goal</label>
                <input
                  type="text"
                  value={editForm.fitness_goal}
                  onChange={(e) => setEditForm({ ...editForm, fitness_goal: e.target.value })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', padding: '0.45rem', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: '#f43f5e', fontWeight: 600 }}>Injury / Limitation Notes</label>
                <textarea
                  rows="3"
                  value={editForm.injury_notes}
                  onChange={(e) => setEditForm({ ...editForm, injury_notes: e.target.value })}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(244,63,94,0.3)', padding: '0.45rem', borderRadius: '8px', color: '#fff', fontSize: '0.82rem' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '0.5rem' }}>
                  <Check size={16} /> Save Memory
                </button>
                <button type="button" className="btn-secondary" onClick={() => setEditingProfile(false)} style={{ padding: '0.5rem' }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ padding: '0.75rem', borderRadius: '10px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase' }}>Athlete</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{profile?.name || 'Synthetic Demo User'} • {profile?.weight_kg || 70.0} kg</div>
                <div style={{ fontSize: '0.78rem', color: '#19c995', marginTop: '0.2rem' }}>{profile?.fitness_goal || 'Sample general fitness goal'}</div>
              </div>

              <div style={{ padding: '0.75rem', borderRadius: '10px', background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
                <span style={{ fontSize: '0.72rem', color: '#f43f5e', textTransform: 'uppercase', fontWeight: 700 }}>Active Injury Guard</span>
                <p style={{ fontSize: '0.82rem', color: '#fca5a5', marginTop: '0.25rem' }}>
                  "{profile?.injury_notes || ''}"
                </p>
              </div>

              <p style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.5 }}>
                Guidance uses your saved measurements, training goals and workout history.
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
