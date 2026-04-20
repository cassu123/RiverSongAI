import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './RoutinesPage.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TRIGGER_TYPES = [
  { value: 'daily',   label: 'Daily at time' },
  { value: 'weekly',  label: 'Weekly on days' },
  { value: 'startup', label: 'On server start' },
  { value: 'manual',  label: 'Manual only' },
]

function fmtSchedule(r) {
  if (r.trigger === 'daily')   return `Daily at ${r.time || '—'}`
  if (r.trigger === 'weekly')  return (r.days?.length ? r.days.join(' / ') : '—') + (r.time ? ` at ${r.time}` : '')
  if (r.trigger === 'startup') return 'On startup'
  return 'Manual'
}

const BLANK = { name: '', trigger: 'daily', time: '07:00', days: [], prompt: '', enabled: true }

export default function RoutinesPage() {
  const { token } = useAuth()
  const [routines, setRoutines] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(BLANK)
  const [confirm,  setConfirm]  = useState(null)
  const [running,  setRunning]  = useState(null)   // id of routine being run
  const [output,   setOutput]   = useState(null)   // { name, text } for output modal

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {}

  const fetchRoutines = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/routines`, { headers: authHeaders })
      if (res.ok) setRoutines(await res.json())
    } catch {}
    setLoading(false)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRoutines() }, [fetchRoutines])

  // Mirror to localStorage so Dashboard widget still works
  useEffect(() => {
    try { localStorage.setItem('rs-routines', JSON.stringify(routines)) } catch {}
  }, [routines])

  const openAdd = () => { setForm(BLANK); setEditing(null); setAdding(true) }

  const openEdit = (r) => {
    setForm({ name: r.name, trigger: r.trigger, time: r.time || '07:00', days: r.days || [], prompt: r.prompt || '', enabled: r.enabled })
    setEditing(r.id)
    setAdding(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editing) {
      const res = await fetch(`${API_BASE}/api/routines/${editing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRoutines(prev => prev.map(r => r.id === editing ? updated : r))
      }
    } else {
      const res = await fetch(`${API_BASE}/api/routines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...form, name: form.name.trim() }),
      })
      if (res.ok) {
        const newData = await res.json()
        setRoutines(prev => [...prev, newData])
      }
    }
    setAdding(false)
    setEditing(null)
  }

  const toggleEnabled = async (r) => {
    const res = await fetch(`${API_BASE}/api/routines/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ enabled: !r.enabled }),
    })
    if (res.ok) {
      const updated = await res.json()
      setRoutines(prev => prev.map(x => x.id === r.id ? updated : x))
    }
  }

  const handleDelete = async (id) => {
    const res = await fetch(`${API_BASE}/api/routines/${id}`, { method: 'DELETE', headers: authHeaders })
    if (res.ok) setRoutines(prev => prev.filter(r => r.id !== id))
    setConfirm(null)
  }

  const handleRun = async (r) => {
    setRunning(r.id)
    try {
      const res = await fetch(`${API_BASE}/api/routines/${r.id}/run`, { method: 'POST', headers: authHeaders })
      const data = await res.json()
      setOutput({ name: r.name, text: data.output || '(No response)' })
      // refresh to pick up last_run
      fetchRoutines()
    } catch (e) {
      setOutput({ name: r.name, text: `Error: ${e.message}` })
    }
    setRunning(null)
  }

  const toggleDay = (day) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }))
  }

  const enabledCount = routines.filter(r => r.enabled).length

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
            {loading ? 'Loading…' : `${enabledCount} active · ${routines.length} total`}
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
      {!loading && routines.length === 0 ? (
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
                  {r.last_run && (
                    <div className="routines-card-last-run">
                      Last run: {new Date(r.last_run).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="routines-card-actions">
                  <button
                    className="btn routines-run-btn"
                    onClick={() => handleRun(r)}
                    disabled={running === r.id || !r.prompt}
                    title={r.prompt ? 'Run now' : 'No prompt set'}
                  >
                    {running === r.id ? '…' : '▸ RUN'}
                  </button>
                  <button
                    className={`btn routines-toggle-btn ${r.enabled ? 'routines-toggle-btn--on' : ''}`}
                    onClick={() => toggleEnabled(r)}
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

      {/* Output modal */}
      {output && (
        <div className="routines-modal-overlay" onClick={() => setOutput(null)}>
          <div className="routines-modal" onClick={e => e.stopPropagation()}>
            <div className="routines-modal-header">
              <span className="routines-modal-title">{output.name} — OUTPUT</span>
              <button className="routines-modal-close" onClick={() => setOutput(null)}>✕</button>
            </div>
            <div className="routines-modal-body">{output.text}</div>
          </div>
        </div>
      )}
    </div>
  )
}
