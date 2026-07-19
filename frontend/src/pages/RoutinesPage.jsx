import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * RoutinesPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Automated system behaviors and briefings.
 */

export default function RoutinesPage({ setAction }) {
  const { token } = useAuth()
  const [routines, setRoutines] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchRoutines = async () => {
    try {
      const res = await fetch('/api/routines', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setRoutines(await res.json())
    } catch (err) {
      console.warn('[RoutinesPage] fetch failed:', err)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchRoutines() }, [token])

  const toggleRoutine = async (id, enabled) => {
    try {
      await fetch(`/api/routines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: !enabled })
      })
      fetchRoutines()
    } catch (err) {
      console.warn('[RoutinesPage] toggle failed:', err)
    }
  }

  const runRoutine = async (id) => {
    try {
      const res = await fetch(`/api/routines/${id}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        alert(`Execution Complete: ${data.response}`)
        fetchRoutines()
      } else {
        alert('Execution Failed.')
      }
    } catch(err) {
      alert('Execution Error: ' + err.message)
    }
  }

  useEffect(() => {
    setAction(
      <button className="rs-btn-primary" onClick={() => alert('New Routine logic planned for Phase 4.')}>
        + CREATE DIRECTIVE
      </button>
    )
  }, [setAction])

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">System Directives</h1>
        <div className="rs-greeting-sub">Configure automated briefings and recurring cognitive tasks.</div>
      </div>

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">PARSING LOGIC CORES...</div>
        ) : routines.length === 0 ? (
          <div className="rs-card-meta">No active directives.</div>
        ) : (
          routines.map(r => (
            <div key={r.id} className="rs-card is-wide">
              <div className="rs-card-head">
                <span className="rs-card-label">{r.type.toUpperCase()}</span>
                <button 
                  className={`rs-pill ${r.enabled ? 'is-active' : ''}`}
                  onClick={() => toggleRoutine(r.id, r.enabled)}
                >
                  {r.enabled ? 'ACTIVE' : 'DORMANT'}
                </button>
              </div>
              <div className="rs-card-value">
                {r.name}
                <span className={`rs-badge ${r.severity === 'critical' ? 'is-danger' : r.severity === 'warning' ? 'is-warning' : 'is-info'}`} style={{ marginLeft: 8, fontSize: '0.6rem' }}>
                  {r.severity || 'info'}
                </span>
              </div>
              <div className="rs-card-meta">
                {r.trigger === 'cron' || r.time ? `SCHEDULED: ${r.time} on ${r.days?.length ? r.days.join(', ') : 'every day'}` : `EVENT: ${r.trigger}`}
              </div>
              {r.last_run && (
                <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
                  LAST EXECUTION: {new Date(r.last_run).toLocaleString()}
                </div>
              )}
              {r.last_output && (
                <div className="rs-card-meta" style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', whiteSpace: 'pre-wrap', color: '#fff' }}>
                  {r.last_output}
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <button className="rs-pill" onClick={() => runRoutine(r.id)}>
                  <span className="material-symbols-rounded">play_arrow</span> EXECUTE
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rs-foyer-head" style={{ marginTop: '2rem' }}>
        <h2 className="rs-greeting" style={{ fontSize: '1.2rem' }}>Execution History</h2>
      </div>
      <RoutineHistory token={token} />
    </div>
  )
}

function RoutineHistory({ token }) {
  const [logs, setLogs] = useState([])
  
  useEffect(() => {
    fetch('/api/proactive/log', { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json())
      .then(d => {
        if(d.log) setLogs(d.log.filter(l => l.kind === 'routine'))
      })
      .catch(console.warn)
  }, [token])

  if(!logs.length) return <div className="rs-card-meta">No routine history found.</div>

  return (
    <div className="rs-card-flow" style={{ marginTop: '1rem' }}>
      {logs.map(l => (
        <div key={l.id} className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">{new Date(l.created_at).toLocaleString()}</span>
            <span className="rs-card-label">{l.delivered ? 'DELIVERED' : 'BLOCKED'}</span>
          </div>
          <div className="rs-card-value">{l.title}</div>
          {l.reason && <div className="rs-card-meta" style={{ color: '#ff6b6b' }}>{l.reason}</div>}
        </div>
      ))}
    </div>
  )
}
