import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

export default function Sessions() {
  const { token } = useAuth()
  const [sessions, setSessions] = useState([])
  const [units, setUnits] = useState([])
  const [programs, setPrograms] = useState([])
  
  const [filterUnit, setFilterUnit] = useState('')
  const [filterProgram, setFilterProgram] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionDetails, setSessionDetails] = useState(null)

  useEffect(() => {
    fetchSessions()
    fetchUnits()
    fetchPrograms()
  }, [])

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/vector/sessions', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setSessions(await res.json())
    } catch (err) { console.error(err) }
  }
  const fetchUnits = async () => {
    try {
      const res = await fetch('/api/vector/units', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setUnits(await res.json())
    } catch (err) { console.error(err) }
  }
  const fetchPrograms = async () => {
    try {
      const res = await fetch('/api/vector/programs', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setPrograms(await res.json())
    } catch (err) { console.error(err) }
  }

  const openSessionDetail = async (session) => {
    setSelectedSession(session)
    try {
      const res = await fetch(`/api/vector/sessions/${session.session_id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        setSessionDetails(await res.json())
      }
    } catch (err) { console.error(err) }
  }

  const filtered = sessions.filter(s => {
    if (filterUnit && s.unit_id !== filterUnit) return false
    if (filterProgram && s.program_id !== filterProgram) return false
    if (filterStatus && s.status !== filterStatus) return false
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Session History</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <select className="rs-input" value={filterUnit} onChange={e => setFilterUnit(e.target.value)}>
            <option value="">All Units</option>
            {units.map(u => <option key={u.unit_id} value={u.unit_id}>{u.name || u.unit_id}</option>)}
          </select>
          <select className="rs-input" value={filterProgram} onChange={e => setFilterProgram(e.target.value)}>
            <option value="">All Programs</option>
            {programs.map(p => <option key={p.program_id} value={p.program_id}>{p.name}</option>)}
          </select>
          <select className="rs-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="aborted">Aborted</option>
          </select>
        </div>
      </div>

      <div className="rs-card">
        <div className="rs-table-wrap">
          <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: 10 }}>Started At</th>
                <th style={{ padding: 10 }}>Unit</th>
                <th style={{ padding: 10 }}>Program</th>
                <th style={{ padding: 10 }}>Duration (min)</th>
                <th style={{ padding: 10 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const u = units.find(x => x.unit_id === s.unit_id)
                const p = programs.find(x => x.program_id === s.program_id)
                
                let duration = '--'
                if (s.started_at && s.ended_at) {
                  const ms = new Date(s.ended_at + 'Z') - new Date(s.started_at + 'Z')
                  duration = Math.round(ms / 60000)
                } else if (s.started_at) {
                  const ms = new Date() - new Date(s.started_at + 'Z')
                  duration = Math.round(ms / 60000) + ' (ongoing)'
                }

                return (
                  <tr key={s.session_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }} onClick={() => openSessionDetail(s)}>
                    <td style={{ padding: 10 }}>{new Date(s.started_at + 'Z').toLocaleString()}</td>
                    <td style={{ padding: 10 }}>{u ? u.name : s.unit_id}</td>
                    <td style={{ padding: 10 }}>{p ? p.name : s.program_id}</td>
                    <td style={{ padding: 10 }}>{duration}</td>
                    <td style={{ padding: 10 }}>
                      <span style={{ 
                        padding: '2px 8px', borderRadius: 4, fontSize: '0.8em',
                        background: s.status === 'completed' ? 'rgba(0,255,0,0.2)' : 
                                    s.status === 'aborted' ? 'rgba(255,0,0,0.2)' : 'rgba(255,255,255,0.2)'
                      }}>{s.status}</span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr><td colSpan="5" style={{ padding: 10, textAlign: 'center' }}>No sessions found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSession && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="rs-card" style={{ width: 'min(95vw, 1000px)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3>Session Details: {selectedSession.session_id.substring(0,8)}...</h3>
              <button className="rs-btn-ghost" onClick={() => setSelectedSession(null)}>Close</button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" style={{ margin: '20px 0', padding: 15, background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
              <div><strong>Status:</strong> {selectedSession.status}</div>
              <div><strong>Area Mowed:</strong> {selectedSession.area_mowed_sqm ?? '--'} m&sup2;</div>
              <div><strong>Battery Used:</strong> {selectedSession.battery_used_pct ?? '--'} %</div>
              {selectedSession.abort_reason && <div style={{ gridColumn: '1 / span 3', color: 'var(--danger)' }}><strong>Abort Reason:</strong> {selectedSession.abort_reason}</div>}
            </div>

            {sessionDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {sessionDetails.telemetry && sessionDetails.telemetry.length > 0 && (
                  <div>
                    <h4>Telemetry Over Time (Battery %)</h4>
                    <div style={{ height: 300, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={sessionDetails.telemetry}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                          <XAxis dataKey="timestamp" tickFormatter={(v) => new Date(v+'Z').toLocaleTimeString()} stroke="rgba(255,255,255,0.5)" />
                          <YAxis stroke="rgba(255,255,255,0.5)" domain={[0, 100]} />
                          <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }} labelFormatter={(v) => new Date(v+'Z').toLocaleString()} />
                          <Legend />
                          <Line type="monotone" dataKey="battery_pct" stroke="#00d4b2" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                
                {sessionDetails.events && sessionDetails.events.length > 0 && (
                  <div>
                    <h4>Event Timeline</h4>
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
                      {sessionDetails.events.map((e, idx) => (
                        <div key={idx} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9em' }}>
                          <span style={{ color: 'grey', marginRight: 10 }}>{new Date(e.timestamp + 'Z').toLocaleTimeString()}</span>
                          <strong>{e.event}</strong>
                          <span style={{ color: 'grey', marginLeft: 10 }}>{e.data}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 20 }}>Loading details...</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
