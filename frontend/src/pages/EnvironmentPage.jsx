import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './EnvironmentPage.css'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

const ACTIVITY_MAP = {
  empty:   { label: 'EMPTY',    icon: '—', color: 'var(--text-muted)' },
  present: { label: 'PRESENT',  icon: '◉', color: '#00ff66' },
  working: { label: 'WORKING',  icon: '◈', color: '#00aaff' },
  eating:  { label: 'EATING',   icon: '◍', color: '#ffaa00' },
  reading: { label: 'READING',  icon: '◎', color: '#a277ff' },
  phone:   { label: 'ON PHONE', icon: '◉', color: '#00ced1' },
}

const ROVER_MODE_COLOR = {
  AUTO: '#00ff66',
  HOLD: '#ffaa00',
  RTL:  '#00aaff',
  MANUAL: 'var(--md-outline)',
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now - date) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  return `${Math.floor(diff / 60)}m ago`
}

export default function EnvironmentPage() {
  const { token, user } = useAuth()
  const [rooms, setRooms] = useState({})
  const [rover, setRover] = useState(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(null)
  const [flash, setFlash] = useState(null)

  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    const headers = authHeaders(token)
    try {
      const roomRes = await fetch('/api/context/rooms', { headers }).then(r => r.json())
      setRooms(roomRes.rooms || {})
      
      const roverRes = await fetch('/api/rover/telemetry', { headers }).then(r => r.json())
      setRover(roverRes.lat !== undefined ? roverRes : null)
    } catch (e) {
      console.error('[Environment] Fetch error:', e)
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchData()
    const roomInt = setInterval(() => fetchData(true), 10000)
    const roverInt = setInterval(async () => {
      try {
        const res = await fetch('/api/rover/telemetry', { headers: authHeaders(token) }).then(r => r.json())
        setRover(res.lat !== undefined ? res : null)
      } catch {}
    }, 3000)
    
    return () => {
      clearInterval(roomInt)
      clearInterval(roverInt)
    }
  }, [fetchData, token])

  const markRoom = async (roomKey, persons, activity) => {
    setActing(roomKey)
    try {
      await fetch('/api/context/sensor_event', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders(token)
        },
        body: JSON.stringify({
          source: 'manual',
          entity_id: `sensor.river_presence_${roomKey}`,
          state: String(persons),
          attributes: { activity }
        })
      })
      setFlash(`✓ ${roomKey.replace('_', ' ')} updated`)
      setTimeout(() => setFlash(null), 3000)
      fetchData(true)
    } finally {
      setActing(null)
    }
  }

  const sendRoverCommand = async (action, payload = {}) => {
    if (action === 'disarm' && !window.confirm('Are you sure you want to DISARM the mower?')) return
    setActing('rover')
    try {
      await fetch('/api/rover/command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(token)
        },
        body: JSON.stringify({ action, payload })
      })
    } finally {
      setActing(null)
      fetchData(true)
    }
  }

  const roomEntries = Object.entries(rooms)
  const isRoverActive = rover && rover.lat !== null && rover.lon !== null

  return (
    <div className="page-wrap env-wrap">
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>COMMAND</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>ENVIRONMENT</span>
          </div>
          <h1 className="page-title">Environment</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" style={{ background: loading ? undefined : 'var(--secondary)' }} />
            {loading ? 'Polling sensors…' : `${roomEntries.length} rooms tracked`}
          </div>
        </div>
        <button className="btn" onClick={() => fetchData()}>↺ REFRESH</button>
      </div>

      {flash && <div className="env-flash animate-fade-in">{flash}</div>}

      <div className="env-section">
        <div className="env-section-title">◉ ROOM PRESENCE</div>
        
        {roomEntries.length === 0 ? (
          <div className="card env-setup-msg">
            <div className="card-title">SENSORS NOT DETECTED</div>
            <p>Configure RTSP cameras in Settings or send events from Home Assistant to <code>/api/context/sensor_event</code> to see room occupancy here.</p>
          </div>
        ) : (
          <div className="env-room-grid">
            {roomEntries.map(([key, r]) => {
              const act = ACTIVITY_MAP[r.activity] || ACTIVITY_MAP.empty
              return (
                <div 
                  key={key} 
                  className={`card env-room-card ${r.persons > 0 ? 'env-room-card--occupied' : ''} ${r.stale ? 'env-room-card--stale' : ''}`}
                >
                  {r.stale && <div className="env-stale-badge">⚠ STALE</div>}
                  <div className="env-room-name">{key.replace('_', ' ').toUpperCase()}</div>
                  
                  <div className="env-occupancy-num">{r.persons}</div>
                  
                  <div className="env-activity-label" style={{ color: act.color }}>
                    {act.icon} {act.label}
                  </div>

                  <div className="env-room-meta">
                    <span>{r.temperature ? `${r.temperature}°F` : '--°F'}</span>
                    <span className={r.lights_on ? 'lights-on' : 'lights-off'}>
                      {r.lights_on ? '◉ LIGHTS ON' : '◌ LIGHTS OFF'}
                    </span>
                  </div>

                  <div className="env-last-seen">Seen {timeAgo(r.last_updated)}</div>

                  <div className="env-room-actions">
                    <button 
                      className="btn btn--ghost btn--xs" 
                      onClick={() => markRoom(key, 1, 'present')}
                      disabled={acting === key}
                    >
                      MARK OCCUPIED
                    </button>
                    <button 
                      className="btn btn--ghost btn--xs" 
                      onClick={() => markRoom(key, 0, 'empty')}
                      disabled={acting === key}
                    >
                      MARK EMPTY
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {isRoverActive && (
        <div className="env-section">
          <div className="env-section-title">◈ ROVER — ARDU MOWER</div>
          <div className="env-rover-grid">
            <div className="card env-rover-card">
              <div className="env-rover-top">
                <div className="env-mode-badge" style={{ background: ROVER_MODE_COLOR[rover.mode] || ROVER_MODE_COLOR.MANUAL }}>
                  {rover.mode}
                </div>
                <div className={`env-armed-status ${rover.armed ? 'armed' : ''}`}>
                  {rover.armed ? '◉ ARMED' : '◌ DISARMED'}
                </div>
              </div>

              <div className="env-rover-battery">
                <div className="env-battery-meta">
                  <span>BATTERY</span>
                  <span>{rover.battery_pct}% ({rover.battery_v}V)</span>
                </div>
                <input 
                  type="range" 
                  className="env-battery-bar" 
                  value={rover.battery_pct || 0} 
                  readOnly 
                />
              </div>

              <div className="env-rover-stats">
                <div className="env-stat-cell">
                  <span className="env-stat-label">SPEED</span>
                  <span className="env-stat-val">{rover.speed_ms} m/s</span>
                </div>
                <div className="env-stat-cell">
                  <span className="env-stat-label">HEADING</span>
                  <span className="env-stat-val">{rover.heading}°</span>
                </div>
              </div>

              <div className="env-rover-mission">
                <span className="env-stat-label">MISSION STATUS</span>
                <span className="env-stat-val">
                  {rover.mission_total > 0 
                    ? `Waypoint ${rover.mission_current} of ${rover.mission_total}`
                    : 'No active mission'}
                </span>
              </div>

              <div className="env-rover-gps">
                ◈ GPS: {rover.lat.toFixed(6)}, {rover.lon.toFixed(6)}
              </div>
            </div>

            {user.role === 'admin' && (
              <div className="env-rover-cmds">
                <button className="btn btn--primary" onClick={() => sendRoverCommand('set_mode', {mode: 'HOLD'})} disabled={acting === 'rover'}>HOLD</button>
                <button className="btn btn--primary" onClick={() => sendRoverCommand('set_mode', {mode: 'AUTO'})} disabled={acting === 'rover'}>AUTO</button>
                <button className="btn btn--primary" onClick={() => sendRoverCommand('set_mode', {mode: 'RTL'})} disabled={acting === 'rover'}>RTL</button>
                <button className="btn btn--danger" onClick={() => sendRoverCommand('disarm')} disabled={acting === 'rover'}>DISARM</button>
              </div>
            )}
          </div>

          <div className="card env-gps-placeholder">
            <div className="env-gps-text">◈ GPS: {rover.lat}, {rover.lon}</div>
            <div className="env-gps-note">Full real-time map integration is planned for Phase 14.</div>
          </div>
        </div>
      )}
    </div>
  )
}
