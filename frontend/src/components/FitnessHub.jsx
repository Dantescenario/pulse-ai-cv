import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, Check, Target, CalendarDays, Timer, Dumbbell } from 'lucide-react';
import './FitnessHub.css';

const API = '/api';
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shift = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate()+n); return localDay(d); };
const blank = day => ({day, exercise:'', sets:3, reps:10, duration_minutes:20, weight_kg:0, notes:''});
async function request(path, method = 'GET', body) {
  const response = await fetch(`${API}${path}`, {method, ...(body ? {headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(response.status === 422 ? 'Please check your values and try again.' : 'Could not connect or save. Check the backend and retry.');
  return response.json();
}

export function Profile() {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = () => { setError(''); request('/profile').then(setProfile).catch(e=>setError(e.message)); };
  useEffect(load, []);
  const submit = async e => { e.preventDefault(); setBusy(true); setSaved(false); setError(''); try { await request('/profile','POST',profile); setSaved(true); } catch(e) {setError(e.message);} finally {setBusy(false);} };
  return <div className="fitness-hub"><header className="hub-heading"><span className="eyebrow">MAKE IT PERSONAL</span><h2>Your profile</h2><p>A little about you. A clearer direction for your training.</p></header>
    {error && <div className="hub-alert" role="alert">{error} <button onClick={load}>Retry loading</button></div>}
    {!profile ? <p role="status">{error ? 'Profile unavailable.' : 'Loading profile…'}</p> : <div className="profile-grid">
      <aside className="glass-card profile-summary"><div className="profile-avatar">{profile.name.trim().slice(0,1).toUpperCase()}</div><h3>{profile.name}</h3><span className="tag tag-emerald">Your training space</span><div className="profile-goal"><Target size={22}/><p>{profile.fitness_goal || 'Set your next fitness goal'}</p></div><p className="hub-muted">Keep your goals and injury notes up to date to make this training space your own.</p></aside>
      <form className="glass-card hub-form" onSubmit={submit}><h3>Personal details</h3><div className="hub-fields">
        {[['name','Name','text',null,null],['age','Age','number',1,120],['weight_kg','Weight (kg)','number',0.1,600],['height_cm','Height (cm)','number',0.1,300]].map(([key,label,type,min,max])=><label key={key}>{label}<input required type={type} min={min??undefined} max={max??undefined} step={type==='number' ? key==='age'?'1':'0.1':undefined} maxLength={key==='name'?100:undefined} value={profile[key]} onChange={e=>{setSaved(false);setProfile({...profile,[key]:type==='number'?e.target.value===''?'':Number(e.target.value):e.target.value});}}/></label>)}
      </div><label>Fitness goal<textarea maxLength={500} value={profile.fitness_goal} onChange={e=>{setSaved(false);setProfile({...profile,fitness_goal:e.target.value});}} placeholder="What are you working toward?"/></label><label>Injury notes & training considerations<textarea maxLength={2000} value={profile.injury_notes} onChange={e=>{setSaved(false);setProfile({...profile,injury_notes:e.target.value});}}/></label><div className="hub-actions"><button className="btn-primary" disabled={busy}>{busy?'Saving…':'Save profile'}</button>{saved && <span className="hub-success" role="status"><Check size={16}/> Profile saved</span>}</div></form>
    </div>}
  </div>;
}

export default function FitnessHub({onDataUpdated}) {
  const [day,setDay] = useState(localDay());
  const [entries,setEntries] = useState([]);
  const [week,setWeek] = useState(null);
  const [form,setForm] = useState(blank(day));
  const [editing,setEditing] = useState(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [version,setVersion] = useState(0);
  const [metric,setMetric] = useState('minutes');
  const [deleting,setDeleting] = useState(null);
  useEffect(()=>{
    let alive=true; setLoading(true); setError(''); setWeek(null); setEntries([]); setForm(blank(day)); setEditing(null); setDeleting(null);
    Promise.all([request(`/diary?day=${day}`),request(`/diary/progress/weekly?start=${day}&tz_offset=${-new Date(`${day}T12:00:00`).getTimezoneOffset()}`)])
      .then(([logs,progress])=>{if(alive){setEntries(logs);setWeek(progress);}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[day,version]);
  const refresh=()=>{setVersion(v=>v+1);onDataUpdated?.();};
  const save=async e=>{e.preventDefault();setBusy(true);setError('');try{await request(`/diary${editing?`/${editing}`:''}`,editing?'PUT':'POST',form);refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const remove=async id=>{setBusy(true);setError('');try{await request(`/diary/${id}`,'DELETE');refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const totals=week?.days.reduce((a,d)=>({minutes:a.minutes+d.minutes,reps:a.reps+d.reps,active:a.active+(d.entries>0?1:0)}),{minutes:0,reps:0,active:0});
  const peak=Math.max(1,...(week?.days.map(d=>d[metric])||[]));
  return <div className="fitness-hub"><header className="hub-heading"><span className="eyebrow">ONE DAY AT A TIME</span><h2>Build your momentum<span>.</span></h2><p>Log the work. See the progress. Make your next week count.</p></header>
    <div className="hub-toolbar"><div className="hub-date"><CalendarDays size={18}/><label htmlFor="diary-day">Your training day</label><input id="diary-day" type="date" required value={day} disabled={busy} onChange={e=>e.target.value&&setDay(e.target.value)}/></div><button className="btn-secondary" disabled={busy} onClick={()=>setDay(localDay())}>Today</button></div>
    {error && <div className="hub-alert" role="alert">{error} <button onClick={()=>setVersion(v=>v+1)}>Reload</button></div>}
    <div className="hub-stats">{[[Timer,'Training time',totals?`${Math.round(totals.minutes)} min`:'—'],[Dumbbell,'Total repetitions',totals?.reps??'—'],[CalendarDays,'Active days',totals?`${totals.active} / 7`:'—']].map(([Icon,title,value])=><div className="glass-card hub-stat" key={title}><Icon size={21}/><span>{title}<small>Selected week</small></span><strong>{value}</strong></div>)}</div>
    <section className="glass-card weekly-chart" aria-busy={loading}><div className="chart-heading"><div><span className="eyebrow">YOUR CONSISTENCY, VISUALIZED</span><h3>Weekly activity</h3><p className="hub-muted">{week?`${week.start} — ${shift(week.start,6)}`:'Loading week…'}</p></div><div className="hub-actions"><button className="chart-arrow" aria-label="Previous week" disabled={busy} onClick={()=>setDay(shift(day,-7))}><ArrowLeft size={18}/></button><button className="chart-arrow" aria-label="Next week" disabled={busy} onClick={()=>setDay(shift(day,7))}><ArrowRight size={18}/></button><select aria-label="Chart measurement" value={metric} onChange={e=>setMetric(e.target.value)}><option value="minutes">Minutes</option><option value="reps">Repetitions</option></select></div></div>
      {week && <div className="week-bars" role="img" aria-label={`Daily ${metric}: ${week.days.map(d=>`${d.day}: ${Math.round(d[metric]*10)/10}`).join(', ')}`}>{week.days.map(d=><div className={`week-column ${d.day===day?'selected':''}`} key={d.day}><span className="bar-value">{Math.round(d[metric]*10)/10}</span><div className="bar-track"><div className="activity-bar" style={{height:`${d[metric]/peak*100}%`}}/></div><button disabled={busy} onClick={()=>setDay(d.day)} aria-label={`View ${d.day}`}><strong>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined,{weekday:'short'})}</strong><small>{d.day.slice(8)}</small></button></div>)}</div>}
      {week && !totals.active && <p className="chart-empty">A fresh week. Add your first exercise below to start your graph.</p>}<p className="chart-caption">Manual diary + saved camera/video sessions. Simulations excluded. Log a workout once to avoid counting it twice.</p>
    </section>
    <div className="diary-grid"><form className="glass-card hub-form" onSubmit={save}><div><span className="eyebrow">SHOW UP FOR YOURSELF</span><h3>{editing?'Edit exercise':'Log an exercise'}</h3><p className="hub-muted">For {day} · reps are per set</p></div><label>Exercise<input required maxLength={100} value={form.exercise} placeholder="e.g. Squats, running, yoga" onChange={e=>setForm({...form,exercise:e.target.value})}/></label><div className="hub-fields">{[['sets','Sets',1,100,1],['reps','Reps per set',0,10000,1],['duration_minutes','Duration (min)',0.1,1440,0.1],['weight_kg','External weight (kg)',0,1000,0.1]].map(([key,label,min,max,step])=><label key={key}>{label}<input required type="number" min={min} max={max} step={step} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value===''?'':Number(e.target.value)})}/></label>)}</div><label>Notes <span className="hub-muted">(optional)</span><textarea value={form.notes} maxLength={2000} placeholder="How did it feel?" onChange={e=>setForm({...form,notes:e.target.value})}/></label><div className="hub-actions"><button className="btn-primary" disabled={busy||loading||!week}><Plus size={17}/>{busy?'Saving…':editing?'Save changes':'Add exercise'}</button>{editing&&<button type="button" className="btn-secondary" onClick={()=>{setEditing(null);setForm(blank(day));}}>Cancel</button>}</div></form>
      <section className="glass-card diary-list"><h3>Your daily diary</h3><p className="hub-muted">{day} · {entries.length} manual {entries.length===1?'entry':'entries'}</p>{loading?<p role="status">Loading your diary…</p>:!entries.length?<div className="diary-empty"><Dumbbell size={32}/><h4>Your next workout starts here</h4><p>Add strength work, a run or a stretch.<br/>Every bit of movement counts.</p></div>:entries.map(entry=><article className="diary-entry" key={entry.id}><div className="entry-icon"><Dumbbell size={20}/></div><div className="entry-content"><h4>{entry.exercise}</h4><p>{entry.sets} sets × {entry.reps} reps · {entry.duration_minutes} min{entry.weight_kg>0?` · ${entry.weight_kg} kg`:''}</p>{entry.notes&&<small>{entry.notes}</small>}</div><div className="entry-actions"><button disabled={busy} aria-label={`Edit ${entry.exercise}`} onClick={()=>{setEditing(entry.id);setForm(entry);}}><Pencil size={16}/></button><button disabled={busy} aria-label={`Delete ${entry.exercise}`} onClick={()=>setDeleting(entry.id)}><Trash2 size={16}/></button></div>{deleting===entry.id&&<div className="delete-confirm">Delete this entry? <button disabled={busy} onClick={()=>remove(entry.id)}>Delete</button><button disabled={busy} onClick={()=>setDeleting(null)}>Keep</button></div>}</article>)}</section></div>
  </div>;
}
