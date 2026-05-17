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
    } catch {} finally { setLoading(false) }
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
    } catch {}
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
              <div className="rs-card-value">{r.name}</div>
              <div className="rs-card-meta">
                {r.trigger_type === 'cron' ? `SCHEDULED: ${r.trigger_val}` : `EVENT: ${r.trigger_val}`}
              </div>
              {r.last_run && (
                <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
                  LAST EXECUTION: {new Date(r.last_run).toLocaleString()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
