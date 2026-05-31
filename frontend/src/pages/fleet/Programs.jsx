import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'

const PATTERNS = ['stripes', 'spiral', 'perimeter_first', 'checkerboard']
const SPEEDS = ['slow', 'normal', 'fast']

export default function Programs() {
  const { token } = useAuth()
  const [programs, setPrograms] = useState([])
  const [units, setUnits] = useState([])
  const [zones, setZones] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  
  const [formData, setFormData] = useState({
    name: '', assigned_unit_id: '', zone_ids: [],
    pattern: 'stripes', direction_degrees: 0,
    overlap_pct: 15, edge_distance_m: 0.15,
    obstacle_clearance_m: 0.20, speed_profile: 'normal'
  })

  useEffect(() => {
    fetchPrograms()
    fetchUnits()
    fetchZones()
  }, [])

  const fetchPrograms = async () => {
    try {
      const res = await fetch('/api/vector/programs', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setPrograms(await res.json())
    } catch (err) { console.error(err) }
  }
  const fetchUnits = async () => {
    try {
      const res = await fetch('/api/vector/units', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setUnits(await res.json())
    } catch (err) { console.error(err) }
  }
  const fetchZones = async () => {
    try {
      const res = await fetch('/api/vector/zones', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setZones(await res.json())
    } catch (err) { console.error(err) }
  }

  const handleSave = async () => {
    // Client-side validation for obstacle clearance
    const unit = units.find(u => u.unit_id === formData.assigned_unit_id)
    if (unit) {
      let unitFloor = 0.20
      if (unit.safety_floors && unit.safety_floors.min_obstacle_clearance_m !== undefined) {
        unitFloor = unit.safety_floors.min_obstacle_clearance_m
      } else if (unit.absolute_floors && unit.absolute_floors.min_obstacle_clearance_m !== undefined) {
        unitFloor = unit.absolute_floors.min_obstacle_clearance_m
      }
      
      if (parseFloat(formData.obstacle_clearance_m) < unitFloor) {
        alert(`Obstacle clearance must be at least ${unitFloor}m for unit ${unit.name || unit.unit_id}`)
        return
      }
    }

    try {
      const method = editingId ? 'PATCH' : 'POST'
      const url = editingId ? `/api/vector/programs/${editingId}` : '/api/vector/programs'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        setShowModal(false)
        fetchPrograms()
      } else {
        const error = await res.json()
        alert("Error saving: " + JSON.stringify(error))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete program?')) return
    try {
      const res = await fetch(`/api/vector/programs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) fetchPrograms()
    } catch (err) { console.error(err) }
  }

  const toggleZone = (zoneId) => {
    if (formData.zone_ids.includes(zoneId)) {
      setFormData({ ...formData, zone_ids: formData.zone_ids.filter(z => z !== zoneId) })
    } else {
      setFormData({ ...formData, zone_ids: [...formData.zone_ids, zoneId] })
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setFormData({
      name: '', assigned_unit_id: '', zone_ids: [],
      pattern: 'stripes', direction_degrees: 0,
      overlap_pct: 15, edge_distance_m: 0.15,
      obstacle_clearance_m: 0.20, speed_profile: 'normal'
    })
    setShowModal(true)
  }

  const openEdit = (p) => {
    setEditingId(p.program_id || p.id)
    setFormData({
      name: p.name || '', assigned_unit_id: p.assigned_unit_id || '',
      zone_ids: typeof p.zone_ids === 'string' ? JSON.parse(p.zone_ids) : (p.zone_ids || []),
      pattern: p.pattern || 'stripes', direction_degrees: p.direction_degrees || 0,
      overlap_pct: p.overlap_pct || 15, edge_distance_m: p.edge_distance_m || 0.15,
      obstacle_clearance_m: p.obstacle_clearance_m || 0.20, speed_profile: p.speed_profile || 'normal'
    })
    setShowModal(true)
  }

  const handleRun = async (programId, unitId) => {
    if (!unitId) return alert('No assigned unit')
    try {
      const res = await fetch(`/api/vector/programs/${programId}/run`, { 
        method: 'POST', 
        headers: { Authorization: `Bearer ${token}` } 
      })
      if (res.ok) alert('Program started')
      else alert('Failed to start program')
    } catch (e) { console.error(e) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Programs Builder</h2>
        <button className="rs-btn-primary" onClick={openCreate}>Create Program</button>
      </div>

      <div className="rs-card">
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <th style={{ padding: 10 }}>Name</th>
              <th style={{ padding: 10 }}>Unit</th>
              <th style={{ padding: 10 }}>Zones</th>
              <th style={{ padding: 10 }}>Pattern</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {programs.map(p => {
              const u = units.find(x => x.unit_id === p.assigned_unit_id)
              let zIds = p.zone_ids || []
              if (typeof zIds === 'string') { try { zIds = JSON.parse(zIds) } catch(e){} }
              return (
                <tr key={p.program_id || p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: 10 }}>{p.name}</td>
                  <td style={{ padding: 10 }}>{u ? u.name : 'Unassigned'}</td>
                  <td style={{ padding: 10 }}>{zIds.length} zone(s)</td>
                  <td style={{ padding: 10 }}>{p.pattern}</td>
                  <td style={{ padding: 10 }}>
                    <button className="rs-btn-ghost" style={{ marginRight: 5 }} onClick={() => handleRun(p.program_id || p.id, p.assigned_unit_id)}>Run</button>
                    <button className="rs-btn-ghost" style={{ marginRight: 5 }} onClick={() => openEdit(p)}>Edit</button>
                    <button className="rs-btn-ghost" onClick={() => handleDelete(p.program_id || p.id)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {programs.length === 0 && <tr><td colSpan="5" style={{ padding: 10, textAlign: 'center' }}>No programs found</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="rs-card" style={{ width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3>{editingId ? 'Edit Program' : 'Create Program'}</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
              <div>
                <label>Name</label><br/>
                <input type="text" className="rs-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ width: '100%' }} />
              </div>
              <div>
                <label>Assigned Unit</label><br/>
                <select className="rs-input" value={formData.assigned_unit_id} onChange={e => setFormData({...formData, assigned_unit_id: e.target.value})} style={{ width: '100%' }}>
                  <option value="">Select Unit...</option>
                  {units.map(u => <option key={u.unit_id} value={u.unit_id}>{u.name || u.unit_id}</option>)}
                </select>
              </div>

              <div style={{ gridColumn: '1 / span 2' }}>
                <label>Zones</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 5 }}>
                  {zones.map(z => (
                    <label key={z.zone_id || z.id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius: 4 }}>
                      <input type="checkbox" checked={formData.zone_ids.includes(z.zone_id || z.id)} onChange={() => toggleZone(z.zone_id || z.id)} />
                      {z.name}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label>Pattern</label><br/>
                <select className="rs-input" value={formData.pattern} onChange={e => setFormData({...formData, pattern: e.target.value})} style={{ width: '100%' }}>
                  {PATTERNS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label>Direction (&deg;)</label><br/>
                <input type="number" className="rs-input" value={formData.direction_degrees} onChange={e => setFormData({...formData, direction_degrees: parseFloat(e.target.value)})} style={{ width: '100%' }} />
              </div>

              <div>
                <label>Overlap %</label><br/>
                <input type="number" className="rs-input" value={formData.overlap_pct} onChange={e => setFormData({...formData, overlap_pct: parseFloat(e.target.value)})} style={{ width: '100%' }} />
              </div>
              <div>
                <label>Edge Distance (m)</label><br/>
                <input type="number" step="0.01" className="rs-input" value={formData.edge_distance_m} onChange={e => setFormData({...formData, edge_distance_m: parseFloat(e.target.value)})} style={{ width: '100%' }} />
              </div>

              <div>
                <label>Obstacle Clearance (m)</label><br/>
                <input type="number" step="0.01" className="rs-input" value={formData.obstacle_clearance_m} onChange={e => setFormData({...formData, obstacle_clearance_m: parseFloat(e.target.value)})} style={{ width: '100%' }} />
              </div>
              <div>
                <label>Speed Profile</label><br/>
                <select className="rs-input" value={formData.speed_profile} onChange={e => setFormData({...formData, speed_profile: e.target.value})} style={{ width: '100%' }}>
                  {SPEEDS.map(s => <option key={s} value={s}>{s}</option>)}
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
