import React, { useState } from 'react'
import './RoutinesPage.css'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TRIGGER_TYPES = [
  { value: 'daily',   label: 'Daily at time' },
  { value: 'weekly',  label: 'Weekly on days' },
  { value: 'startup', label: 'On server start' },
  { value: 'manual',  label: 'Manual only' },
]

function loadRoutines() {
  try {
    const v = localStorage.getItem('rs-routines')
    return v ? JSON.parse(v) : []
  } catch { return [] }
}

function saveRoutines(r) {
  try { localStorage.setItem('rs-routines', JSON.stringify(r)) } catch {}
}

function fmtSchedule(r) {
  if (r.trigger === 'daily')   return `Daily at ${r.time || '—'}`
  if (r.trigger === 'weekly')  return (r.days?.length ? r.days.join(' / ') : '—') + (r.time ? ` at ${r.time}` : '')
  if (r.trigger === 'startup') return 'On startup'
  return 'Manual'
}

const BLANK = { name: '', trigger: 'daily', time: '07:00', days: [], prompt: '', enabled: true }

export default function RoutinesPage() {
  const [routines, setRoutines] = useState(loadRoutines)
  const [adding,   setAdding]   = useState(false)
  const [editing,  setEditing]  = useState(null)   // routine id being edited
  const [form,     setForm]     = useState(BLANK)
  const [confirm,  setConfirm]  = useState(null)   // id to confirm delete

  const persist = (next) => { setRoutines(next); saveRoutines(next) }

  const openAdd = () => { setForm(BLANK); setEditing(null); setAdding(true) }

  const openEdit = (r) => {
    setForm({ name: r.name, trigger: r.trigger, time: r.time || '07:00', days: r.days || [], prompt: r.prompt || '', enabled: r.enabled })
    setEditing(r.id)
    setAdding(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editing) {
      persist(routines.map(r => r.id === editing ? { ...r, ...form, name: form.name.trim() } : r))
    } else {
      persist([...routines, { id: crypto.randomUUID(), ...form, name: form.name.trim(), createdAt: new Date().toISOString() }])
    }
    setAdding(false)
    setEditing(null)
  }

  const toggleEnabled = (id) => {
    persist(routines.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
  }

  const handleDelete = (id) => {
    persist(routines.filter(r => r.id !== id))
    setConfirm(null)
  }

  const toggleDay = (day) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }))
  }

  const enabledCount  = routines.filter(r => r.enabled).length

  return (
    <div className="page-wrap routines-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>AUTOMATION</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>ROUTINES</span>
          </div>
          <h1 className="page-title">Routines</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            {enabledCount} active · {routines.length} total
          </div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn--cta" onClick={openAdd}>+ NEW ROUTINE</button>
        </div>
      </div>

      {/* Form panel */}
      {adding && (
        <div className="card routines-form-card">
          <div className="card-title">{editing ? 'EDIT ROUTINE' : 'NEW ROUTINE'}</div>
          <form className="routines-form" onSubmit={handleSubmit}>

            <div className="rf-row">
              <label className="rf-label">NAME</label>
              <input
                className="rf-input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Morning Brief"
                autoFocus required
              />
            </div>

            <div className="rf-row">
              <label className="rf-label">TRIGGER</label>
              <div className="rf-btn-group">
                {TRIGGER_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className={`rf-trigger-btn ${form.trigger === t.value ? 'rf-trigger-btn--on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, trigger: t.value }))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.trigger === 'daily' || form.trigger === 'weekly') && (
              <div className="rf-row">
                <label className="rf-label">TIME</label>
                <input
                  className="rf-input rf-input--time"
                  type="time"
                  value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                />
              </div>
            )}

            {form.trigger === 'weekly' && (
              <div className="rf-row">
                <label className="rf-label">DAYS</label>
                <div className="rf-day-group">
                  {DAYS.map(d => (
                    <button
                      key={d}
                      type="button"
                      className={`rf-day-btn ${form.days.includes(d) ? 'rf-day-btn--on' : ''}`}
                      onClick={() => toggleDay(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rf-row">
              <label className="rf-label">PROMPT <span className="rf-optional">(what River should do)</span></label>
              <textarea
                className="rf-textarea"
                value={form.prompt}
                onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                placeholder="e.g. Give me a morning brief: today's calendar, weather, and any important reminders."
                rows={3}
              />
            </div>

            <div className="rf-actions">
              <button className="btn btn--primary" type="submit">
                {editing ? 'SAVE CHANGES' : 'CREATE ROUTINE'}
              </button>
              <button className="btn" type="button" onClick={() => { setAdding(false); setEditing(null) }}>
                CANCEL
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Routine list */}
      {routines.length === 0 ? (
        <div className="card routines-empty">
          <div className="routines-empty-text">
            No routines yet. Create one to automate your day.
          </div>
        </div>
      ) : (
        <div className="routines-list">
          {routines.map(r => (
            <div key={r.id} className={`card routines-card ${!r.enabled ? 'routines-card--off' : ''}`}>
              <div className="routines-card-top">
                <span className={`dot ${r.enabled ? 'dot--on' : 'dot--off'}`} />
                <div className="routines-card-info">
                  <div className="routines-card-name">{r.name}</div>
                  <div className="routines-card-sched">{fmtSchedule(r)}</div>
                  {r.prompt && <div className="routines-card-prompt">{r.prompt}</div>}
                </div>
                <div className="routines-card-actions">
                  <button
                    className={`btn routines-toggle-btn ${r.enabled ? 'routines-toggle-btn--on' : ''}`}
                    onClick={() => toggleEnabled(r.id)}
                  >
                    {r.enabled ? '● ON' : '○ OFF'}
                  </button>
                  <button className="btn routines-edit-btn" onClick={() => openEdit(r)}>EDIT</button>
                  {confirm === r.id ? (
                    <>
                      <button className="btn routines-confirm-yes" onClick={() => handleDelete(r.id)}>DELETE</button>
                      <button className="btn" onClick={() => setConfirm(null)}>CANCEL</button>
                    </>
                  ) : (
                    <button className="btn routines-del-btn" onClick={() => setConfirm(r.id)}>✕</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="routines-footer-note">
        Routines are stored locally. Automated execution engine coming in a future phase —
        for now, run any routine manually by speaking its prompt to River.
      </div>
    </div>
  )
}
