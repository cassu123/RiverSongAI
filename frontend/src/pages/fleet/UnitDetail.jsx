import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

export default function UnitDetail() {
  const { id } = useParams()
  const { token } = useAuth()
  const navigate = useNavigate()
  
  const [tab, setTab] = useState('live')
  const [unit, setUnit] = useState(null)
  const [telemetry, setTelemetry] = useState([])
  const [alerts, setAlerts] = useState([])
  const [sessions, setSessions] = useState([])
  
  const [manualMode, setManualMode] = useState(false)
  const [eStopHolding, setEStopHolding] = useState(false)
  const eStopTimer = useRef(null)

  const fetchUnit = useCallback(async () => {
    try {
      const res = await fetch(`/api/vector/units`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const units = await res.json()
        const u = units.find(x => x.unit_id === id)
        if (u) setUnit(u)
      }
    } catch (e) { console.error(e) }
  }, [id, token])

  const fetchLists = useCallback(async () => {
    try {
      const [tRes, aRes, sRes] = await Promise.all([
        fetch(`/api/vector/units/${id}/telemetry?limit=50`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/vector/units/${id}/alerts?limit=20`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/vector/sessions`, { headers: { Authorization: `Bearer ${token}` } })
      ])
      if (tRes.ok) setTelemetry(await tRes.json())
      if (aRes.ok) setAlerts(await aRes.json())
      if (sRes.ok) {
        const all = await sRes.json()
        setSessions(all.filter(s => s.unit_id === id))
      }
    } catch (e) { console.error(e) }
  }, [id, token])

  useEffect(() => {
    fetchUnit()
    fetchLists()
    
    const es = new EventSource('/api/vector/units/stream')
    es.addEventListener('update', (e) => {
      try {
        const units = JSON.parse(e.data)
        const u = units.find(x => x.unit_id === id)
        if (u) setUnit(u)
        // Also refresh telemetry lists slightly to keep in sync
        fetchLists()
      } catch (err) {}
    })
    return () => es.close()
  }, [id, fetchUnit, fetchLists])

  const sendCommand = async (action, params = {}) => {
    try {
      await fetch(`/api/vector/units/${id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, params })
      })
    } catch (e) { console.error(e) }
  }

  const handleEStopDown = () => {
    setEStopHolding(true)
    eStopTimer.current = setTimeout(() => {
      sendCommand('estop')
      setEStopHolding(false)
      alert("E-STOP TRIGGERED")
    }, 2000)
  }
  const handleEStopUp = () => {
    if (eStopTimer.current) {
      clearTimeout(eStopTimer.current)
      eStopTimer.current = null
    }
    setEStopHolding(false)
  }

  const ackAlert = async (alertId) => {
    try {
      await fetch(`/api/vector/units/${id}/alerts/${alertId}/ack`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchLists()
    } catch (e) { console.error(e) }
  }

  const manualTimer = useRef(null)

  const bindManualKey = (action, payload = {}) => {
    const start = () => {
      if (!manualMode) return
      sendCommand(action, payload)
      if (manualTimer.current) clearInterval(manualTimer.current)
      manualTimer.current = setInterval(() => sendCommand(action, payload), 500)
    }
    const stop = () => {
      if (manualTimer.current) clearInterval(manualTimer.current)
    }
    return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop, onTouchStart: start, onTouchEnd: stop }
  }

  if (!unit) return <div style={{ padding: 20 }}>Loading unit...</div>

  const latestT = telemetry[0] || {}

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{unit.name || unit.unit_id}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ padding: '4px 8px', borderRadius: 4, background: unit.online ? 'rgba(0,255,0,0.2)' : 'rgba(255,0,0,0.2)' }}>
            {unit.online ? 'Online' : 'Offline'}
          </span>
          <span style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>
            Mode: {unit.operating_mode || 'idle'}
          </span>
          <span style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>
            Tier: {unit.connectivity_tier || 'lan'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid rgba(255,255,255,0.1)', margin: '20px 0', paddingBottom: 10 }}>
        <button className="rs-btn-ghost" style={{ fontWeight: tab === 'live' ? 'bold' : 'normal' }} onClick={() => setTab('live')}>Live</button>
        <button className="rs-btn-ghost" style={{ fontWeight: tab === 'history' ? 'bold' : 'normal' }} onClick={() => setTab('history')}>History</button>
        <button className="rs-btn-ghost" style={{ fontWeight: tab === 'settings' ? 'bold' : 'normal' }} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'live' && (
        <div className="grid grid-cols-1 rail:grid-cols-[2fr_1fr] gap-5">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Telemetry Grid */}
            <div className="rs-card grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div><small style={{ color: 'grey' }}>Battery</small><div>{latestT.battery_pct ?? '--'}% ({latestT.battery_v ?? '--'}V)</div></div>
              <div><small style={{ color: 'grey' }}>Fuel</small><div>{latestT.fuel_pct ?? '--'}%</div></div>
              <div><small style={{ color: 'grey' }}>RPM</small><div>{latestT.rpm ?? '--'}</div></div>
              <div><small style={{ color: 'grey' }}>Speed</small><div>{latestT.speed_kmh ?? '--'} km/h</div></div>
              <div><small style={{ color: 'grey' }}>Temp</small><div>{latestT.temperature_c ?? '--'} &deg;C</div></div>
              <div><small style={{ color: 'grey' }}>Heading</small><div>{latestT.heading_deg ?? '--'}&deg;</div></div>
              <div><small style={{ color: 'grey' }}>Progress</small><div>{latestT.progress_pct ?? '--'}%</div></div>
              <div><small style={{ color: 'grey' }}>GPS Acc</small><div>{latestT.gps_accuracy_m ?? '--'}m</div></div>
            </div>

            {/* Map */}
            <div className="rs-map">
              <MapContainer center={[latestT.lat || 0, latestT.lng || 0]} zoom={18} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={20} />
                {latestT.lat && <Marker position={[latestT.lat, latestT.lng]} />}
              </MapContainer>
            </div>
            
            {/* Alerts */}
            <div className="rs-card">
              <h3>Recent Alerts</h3>
              {alerts.length === 0 && <p style={{ color: 'grey' }}>No alerts.</p>}
              {alerts.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <strong style={{ color: a.level === 'critical' ? 'var(--danger)' : 'white' }}>{a.title}</strong>
                    <div style={{ fontSize: '0.85em', color: 'grey' }}>{new Date(a.timestamp + 'Z').toLocaleString()}</div>
                    {a.message && <div style={{ fontSize: '0.9em' }}>{a.message}</div>}
                  </div>
                  {!a.acknowledged && (
                    <button className="rs-btn-ghost" onClick={() => ackAlert(a.id)}>Ack</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Controls */}
            <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3>Controls</h3>
              <button className="rs-btn-primary" onClick={() => sendCommand('mow_start')}>Start</button>
              <button className="rs-btn" onClick={() => sendCommand('mow_stop')}>Stop</button>
              <button className="rs-btn-ghost" onClick={() => sendCommand('return_home')}>Return Home</button>
              <button 
                className="rs-btn-danger" 
                style={{ 
                  background: eStopHolding ? 'darkred' : 'var(--danger)', 
                  transition: 'background 2s ease-in' 
                }}
                onMouseDown={handleEStopDown}
                onMouseUp={handleEStopUp}
                onMouseLeave={handleEStopUp}
                onTouchStart={handleEStopDown}
                onTouchEnd={handleEStopUp}
              >
                {eStopHolding ? 'HOLD TO E-STOP...' : 'E-STOP (Hold 2s)'}
              </button>
              <button className="rs-btn-ghost" onClick={() => sendCommand('estop_reset')}>Reset E-Stop</button>
            </div>

            <div className="rs-card">
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 'bold' }}>
                <input type="checkbox" checked={manualMode} onChange={e => setManualMode(e.target.checked)} />
                Enable Manual Mode
              </label>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" style={{ marginTop: 20, opacity: manualMode ? 1 : 0.5, pointerEvents: manualMode ? 'auto' : 'none' }}>
                <div />
                <button className="rs-btn-ghost" {...bindManualKey('manual.drive', { direction: 'forward', throttle: 0.3, duration_ms: 500 })}>&#8593;</button>
                <div />
                <button className="rs-btn-ghost" {...bindManualKey('manual.steer', { angle_deg: -15, duration_ms: 500 })}>&#8592;</button>
                <button className="rs-btn-danger" {...bindManualKey('manual.brake', { force: 1.0, duration_ms: 500 })}>Brake</button>
                <button className="rs-btn-ghost" {...bindManualKey('manual.steer', { angle_deg: 15, duration_ms: 500 })}>&#8594;</button>
                <div />
                <button className="rs-btn-ghost" {...bindManualKey('manual.drive', { direction: 'reverse', throttle: 0.3, duration_ms: 500 })}>&#8595;</button>
                <div />
              </div>
              <div style={{ marginTop: 20 }}>
                <button className="rs-btn-primary" style={{ width: '100%', opacity: manualMode ? 1 : 0.5, pointerEvents: manualMode ? 'auto' : 'none' }} {...bindManualKey('manual.blades', { engage: true })}>Engage Blades</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="rs-card">
          <div className="rs-table-wrap">
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: 10 }}>Started At</th>
                  <th style={{ padding: 10 }}>Program</th>
                  <th style={{ padding: 10 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.session_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: 10 }}>{new Date(s.started_at + 'Z').toLocaleString()}</td>
                    <td style={{ padding: 10 }}>{s.program_id || 'Manual'}</td>
                    <td style={{ padding: 10 }}>{s.status}</td>
                  </tr>
                ))}
                {sessions.length === 0 && <tr><td colSpan="3" style={{ padding: 10, textAlign: 'center' }}>No sessions found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="rs-card">
          <button className="rs-btn-ghost" onClick={() => navigate(`/fleet/units/${id}/setup`)}>
            Re-run Setup Wizard
          </button>
          
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <h3>Danger Zone</h3>
            <button className="rs-btn-danger" onClick={async () => {
              if (confirm('Delete this unit? This cannot be undone.')) {
                await fetch(`/api/vector/units/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
                navigate('/fleet')
              }
            }}>Delete Unit</button>
          </div>
        </div>
      )}
    </div>
  )
}
