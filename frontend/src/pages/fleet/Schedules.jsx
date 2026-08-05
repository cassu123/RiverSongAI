import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import cronstrue from 'cronstrue'

export default function Schedules() {
  const { token } = useAuth()
  const [schedules, setSchedules] = useState([])
  const [programs, setPrograms] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  
  const [formData, setFormData] = useState({
    name: '', program_id: '', cron_utc: '0 7 * * *',
    timezone_display: Intl.DateTimeFormat().resolvedOptions().timeZone,
    missed_run_policy: 'skip', enabled: 1
  })

  useEffect(() => {
    fetchSchedules()
    fetchPrograms()
  }, [])

  const fetchSchedules = async () => {
    try {
      const res = await fetch('/api/vector/schedules', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setSchedules(await res.json())
    } catch (err) { console.error(err) }
  }

  const fetchPrograms = async () => {
    try {
      const res = await fetch('/api/vector/programs', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setPrograms(await res.json())
    } catch (err) { console.error(err) }
  }

  const handleSave = async () => {
    try {
      const method = editingId ? 'PATCH' : 'POST'
      const url = editingId ? `/api/vector/schedules/${editingId}` : '/api/vector/schedules'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        setShowModal(false)
        fetchSchedules()
      } else {
        const error = await res.json()
        alert("Error saving: " + JSON.stringify(error))
      }
    } catch (err) { console.error(err) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete schedule?')) return
    try {
      const res = await fetch(`/api/vector/schedules/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) fetchSchedules()
    } catch (err) { console.error(err) }
  }

  const toggleEnabled = async (s) => {
    try {
      const res = await fetch(`/api/vector/schedules/${s.schedule_id || s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled: s.enabled ? 0 : 1 })
      })
      if (res.ok) fetchSchedules()
    } catch (e) { console.error(e) }
  }

  const openCreate = () => {
    setEditingId(null)
    setFormData({
      name: '', program_id: '', cron_utc: '0 7 * * *',
      timezone_display: Intl.DateTimeFormat().resolvedOptions().timeZone,
      missed_run_policy: 'skip', enabled: 1
    })
    setShowModal(true)
  }

  const openEdit = (s) => {
    setEditingId(s.schedule_id || s.id)
    setFormData({
      name: s.name || '', program_id: s.program_id || '', cron_utc: s.cron_utc || '0 7 * * *',
      timezone_display: s.timezone_display || Intl.DateTimeFormat().resolvedOptions().timeZone,
      missed_run_policy: s.missed_run_policy || 'skip', enabled: s.enabled !== undefined ? s.enabled : 1
    })
    setShowModal(true)
  }

  const renderCron = (expr) => {
    try { return cronstrue.toString(expr) } 
    catch(e) { return expr }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Schedules Manager</h2>
        <button className="rs-btn-primary" onClick={openCreate}>Create Schedule</button>
      </div>

      <div className="rs-card">
        <div className="rs-table-wrap">
          <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={{ padding: 10 }}>Enabled</th>
                <th style={{ padding: 10 }}>Name</th>
                <th style={{ padding: 10 }}>Program</th>
                <th style={{ padding: 10 }}>Schedule</th>
                <th style={{ padding: 10 }}>Next Run</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => {
                const p = programs.find(x => x.program_id === s.program_id)
                return (
                  <tr key={s.schedule_id || s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: 10 }}>
                      <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s)} />
                    </td>
                    <td style={{ padding: 10 }}>{s.name}</td>
                    <td style={{ padding: 10 }}>{p ? p.name : 'Unknown'}</td>
                    <td style={{ padding: 10 }}>{renderCron(s.cron_utc)}<br/><small style={{color:'grey'}}>{s.timezone_display}</small></td>
                    <td style={{ padding: 10 }}>{s.next_run ? new Date(s.next_run + 'Z').toLocaleString() : 'Pending'}</td>
                    <td style={{ padding: 10 }}>
                      <button className="rs-btn-ghost" style={{ marginRight: 5 }} onClick={() => openEdit(s)}>Edit</button>
                      <button className="rs-btn-ghost" onClick={() => handleDelete(s.schedule_id || s.id)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
              {schedules.length === 0 && <tr><td colSpan="6" style={{ padding: 10, textAlign: 'center' }}>No schedules found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="rs-card" style={{ width: 500 }}>
            <h3>{editingId ? 'Edit Schedule' : 'Create Schedule'}</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, marginTop: 16 }}>
              <div>
                <label>Name</label><br/>
                <input type="text" className="rs-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ width: '100%' }} />
              </div>
              <div>
                <label>Program</label><br/>
                <select className="rs-input" value={formData.program_id} onChange={e => setFormData({...formData, program_id: e.target.value})} style={{ width: '100%' }}>
                  <option value="">Select Program...</option>
                  {programs.map(p => <option key={p.program_id} value={p.program_id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label>Cron Expression (e.g., 0 7 * * * for 7 AM)</label><br/>
                <input type="text" className="rs-input" value={formData.cron_utc} onChange={e => setFormData({...formData, cron_utc: e.target.value})} style={{ width: '100%' }} />
                <div style={{ marginTop: 5, color: '#00d4b2', fontSize: '0.9em' }}>{renderCron(formData.cron_utc)}</div>
              </div>

              <div>
                <label>Timezone</label><br/>
                <input type="text" className="rs-input" value={formData.timezone_display} onChange={e => setFormData({...formData, timezone_display: e.target.value})} style={{ width: '100%' }} />
              </div>

              <div>
                <label>Missed Run Policy</label><br/>
                <select className="rs-input" value={formData.missed_run_policy} onChange={e => setFormData({...formData, missed_run_policy: e.target.value})} style={{ width: '100%' }}>
                  <option value="skip">Skip</option>
                  <option value="run_once_on_recovery">Run Once On Recovery</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="rs-btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="rs-btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
