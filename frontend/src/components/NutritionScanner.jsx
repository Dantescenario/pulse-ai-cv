import { useEffect, useRef, useState } from 'react';
import { Camera, Search, Plus, Trash2, Utensils } from 'lucide-react';
import './NutritionScanner.css';

const API = import.meta.env.VITE_API_URL || '';
const keys = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'];
const round = n => Math.round(n * 100) / 100;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function request(path, data, signal) {
  const res = await fetch(`${API}/api/nutrition${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal } : { signal });
  const body = await res.json();
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Please check your entries and try again.');
  return body;
}

export default function NutritionScanner({ onMealLogged }) {
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [mealName, setMealName] = useState('My meal');
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(false);
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState([]);
  const [day, setDay] = useState(today);
  const generation = useRef(0);
  const dirty = useRef(0);
  const photoInput = useRef(null);
  const cameraInput = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      request('/status', null, controller.signal).then(setStatus).catch(e => {
        if (e.name !== 'AbortError') setStatus(null);
      });
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => request(`/foods?q=${encodeURIComponent(query)}`, null, controller.signal)
      .then(data => { setFoods(data.foods); setCount(data.catalogue_size); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    request(`?day=${day}&tz_offset=${-new Date().getTimezoneOffset()}`, null, controller.signal)
      .then(setLogs).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [day]);

  function addFood(food) {
    dirty.current++;
    const grams = food.serving_g || 100;
    setItems(rows => [...rows, { ...food, item: food.name, grams,
      base: Object.fromEntries(keys.map(k => [k, food[k]])), uid: crypto.randomUUID() }]);
    setMessage('');
  }
  function changeGrams(uid, value) {
    dirty.current++;
    setItems(rows => rows.map(row => row.uid === uid ? { ...row, grams: value === '' ? '' : Number(value) } : row));
    setMessage('');
  }
  const valid = items.length > 0 && items.every(i => Number(i.grams) > 0 && Number(i.grams) <= 10000);
  const totals = Object.fromEntries(keys.map(k => [k, round(items.reduce((s, i) => s + i.base[k] * (Number(i.grams) || 0) / 100, 0))]));
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError('Choose a JPEG, PNG or WebP image up to 8 MB.'); return;
    }
    const token = ++generation.current;
    const version = dirty.current;
    setBusy(true); setMessage('');
    try {
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read this photo.')); reader.readAsDataURL(file);
      });
      const meal = await request('/analyze', { image_base64: encoded });
      if (token !== generation.current || version !== dirty.current) return;
      setPreview(encoded); setMealName(meal.meal_name); setNotice(meal.estimate_notice);
      if (meal.predictions?.length) setQuery(meal.predictions[0].label);
      setItems(meal.ingredients.map(i => ({ ...i, uid: crypto.randomUUID(), base: Object.fromEntries(keys.map(k => [k, i[k] / i.grams * 100])) })));
    } catch (e) { if (token === generation.current) setError(e.message); }
    finally { if (token === generation.current) setBusy(false); }
  }
  async function logMeal() {
    if (!valid || !mealName.trim()) return;
    setLogging(true); setError('');
    try {
      const ingredients = items.map(i => ({ item: i.item, grams: Number(i.grams), source: i.source, source_url: i.source_url,
        estimated: i.estimated, ...Object.fromEntries(keys.map(k => [k, round(i.base[k] * i.grams / 100)])) }));
      await request('', { meal_name: mealName.trim(), ...totals, calories: Math.round(totals.calories), notes: JSON.stringify({ ingredients, estimate_notice: notice }) });
      setItems([]); setPreview(''); setNotice(''); setMessage('Meal added to your diary.');
      setLogs(await request(`?day=${day}&tz_offset=${-new Date().getTimezoneOffset()}`));
      onMealLogged?.();
    } catch (e) { setError(e.message); }
    finally { setLogging(false); }
  }

  return <div className="nutrition-layout">
    <main className="nutrition-main">
      <section className="glass-card nutrition-card">
        <h2><Utensils size={22} /> Food catalogue</h2>
        <p className="nutrition-muted">Search {count || 'your'} foods, including Indian meals. All catalogue values are per 100 g.</p>
        {error && <div role="alert" className="nutrition-error">{error}</div>}
        {message && <p role="status" className="nutrition-success">{message}</p>}
        <label className="nutrition-search"><Search size={18} /><input aria-label="Search foods" value={query} onChange={e => setQuery(e.target.value)} placeholder="Try roti, dal, dosa, biryani, rice..." /></label>
        <div className="nutrition-foods">
          {foods.map(food => <div className="nutrition-food" key={food.id}>
            <div><strong>{food.name}</strong><p>{Math.round(food.calories)} kcal / 100 g · {food.serving_label} ({food.serving_g} g)</p>
              <small>{food.estimated ? 'Recipe estimate · varies with oil and preparation' : 'USDA FoodData Central'}</small>
              {!food.estimated && food.source_url && <> · <a href={food.source_url} target="_blank" rel="noreferrer">Source</a></>}
            </div>
            <button className="btn-secondary" disabled={busy || logging} onClick={() => addFood(food)} aria-label={`Add ${food.name}`}><Plus size={16} /></button>
          </div>)}
          {!foods.length && <p className="nutrition-muted">No matching foods. Try another spelling or ingredient.</p>}
        </div>
      </section>
      <section className="glass-card nutrition-card">
        <h3><Camera size={21} /> Estimate a meal from a photo</h3>
        {error && <div role="alert" className="nutrition-error">{error}</div>}
        <p className="nutrition-muted">Upload a clear meal photo or use your phone camera. The local classifier suggests food names. Choose a catalogue match and enter grams.</p>
        <p className="nutrition-muted">{status ? status.photo_enabled ? 'Photo analysis is configured.' : 'Install the local food model using the setup command in README.md.' : 'Photo service status is unavailable. You can still choose a photo to retry.'}</p>
        <div className="nutrition-actions">
          <button type="button" className="btn-secondary" disabled={busy || logging} onClick={() => photoInput.current?.click()}><Camera size={17} /> {busy ? 'Analyzing photo...' : 'Choose photo'}</button>
          <input ref={photoInput} type="file" aria-label="Choose meal photo" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={busy || logging} hidden />
          <button type="button" className="btn-secondary" disabled={busy || logging} onClick={() => cameraInput.current?.click()}>Take photo</button>
          <input ref={cameraInput} type="file" aria-label="Take meal photo" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={upload} disabled={busy || logging} hidden />
        </div>
        {busy && <p role="status">Identifying dishes and estimating portions...</p>}
        {preview && <img className="nutrition-preview" src={preview} alt="Meal being reviewed" />}
        <p className="nutrition-muted">Photos are analyzed on the app backend using the local food classifier. Review suggestions and enter your own portions.</p>
      </section>
      <section className="glass-card nutrition-card">
        <h3>Review your meal</h3>
        <label>Meal name<input className="nutrition-input" maxLength={200} value={mealName} disabled={busy || logging} onChange={e => { dirty.current++; setMealName(e.target.value); }} /></label>
        {notice && <p className="nutrition-notice">{notice}</p>}
        {!items.length && <p className="nutrition-muted">Add a food or analyze a photo to start.</p>}
        {items.map(row => <div className="nutrition-portion" key={row.uid}>
          <div><strong>{row.item}</strong><p className="nutrition-muted">{Math.round(row.base.calories * (Number(row.grams) || 0) / 100)} kcal · {row.estimated ? 'Estimate' : 'USDA'}</p></div>
          <label>Grams<input type="number" min="1" max="10000" step="any" value={row.grams} disabled={busy || logging} onChange={e => changeGrams(row.uid, e.target.value)} /></label>
          <button className="btn-secondary" disabled={busy || logging} aria-label={`Remove ${row.item}`} onClick={() => { dirty.current++; setItems(rows => rows.filter(i => i.uid !== row.uid)); }}><Trash2 size={16} /></button>
        </div>)}
        <div className="nutrition-macros">{keys.map(k => <div key={k}><strong>{totals[k]}{k === 'calories' ? '' : ' g'}</strong><small>{k === 'calories' ? 'kcal' : k.replace('_g', '')}</small></div>)}</div>
        <button className="btn-primary" disabled={!valid || !mealName.trim() || busy || logging} onClick={logMeal}>{logging ? 'Saving...' : 'Confirm & add to diary'}</button>
      </section>
    </main>
    <aside className="glass-card nutrition-card">
      <h3>Daily food diary</h3>
      <label>Date<input className="nutrition-input" type="date" required value={day} onChange={e => { if (e.target.value) { setLogs([]); setDay(e.target.value); } }} /></label>
      <p className="nutrition-muted">Meals grouped in your local timezone. New meals are logged for today.</p>
      <div className="nutrition-daily"><strong>{logs.reduce((s, i) => s + i.calories, 0)} kcal</strong><span>{round(logs.reduce((s, i) => s + i.protein_g, 0))} g protein</span></div>
      {logs.map(log => <div className="nutrition-food" key={log.id}><div><strong>{log.meal_name}</strong><p>{log.calories} kcal · {log.protein_g} g protein</p></div></div>)}
      {!logs.length && <p className="nutrition-muted">No meals logged for this date.</p>}
      <p className="nutrition-muted">Indian dish entries are recipe estimates, not laboratory measurements from IFCT. Adjust grams to your serving; oil and recipe changes can substantially change calories.</p>
    </aside>
  </div>;
}
