import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'

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

export default function EnvironmentPage({ setAction }) {
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

  const ActionSlot = useMemo(() => (
    <div className="rs-input-bar">
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', width: '100%' }}>
         <button className="rs-pill" onClick={() => fetchData()}>
           <span className="material-symbols-rounded">refresh</span>
           REFRESH
         </button>
      </div>
    </div>
  ), [fetchData])

  useEffect(() => {
    if (setAction) setAction(ActionSlot)
    return () => { if (setAction) setAction(null) }
  }, [ActionSlot, setAction])

  const markRoom = async (roomKey, persons, activity) => {
    setActing(roomKey)
    try {
      await fetch('/api/context/manual_override', {
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
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-card-label">COMMAND / ENVIRONMENT</div>
        <h1 className="rs-greeting">Environment</h1>
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{ background: loading ? undefined : 'var(--secondary)' }} />
          <span>{loading ? 'POLLING SENSORS…' : `${roomEntries.length} ROOMS TRACKED`}</span>
        </div>
      </header>

      {flash && (
        <div className="rs-card" style={{ 
          background: 'var(--md-primary-container)', 
          color: 'var(--md-on-primary-container)',
          marginBottom: 16,
          padding: '12px 20px',
          borderRadius: 'var(--md-shape-xl)'
        }}>
          {flash}
        </div>
      )}

      <div className="rs-card-flow">
        <div className="rs-card-label" style={{ marginBottom: -12, marginLeft: 12 }}>◉ ROOM PRESENCE</div>
        
        {roomEntries.length === 0 ? (
          <div className="rs-card">
            <div className="rs-card-head">
              <span className="rs-card-label">SENSORS NOT DETECTED</span>
            </div>
            <p className="rs-card-meta">Configure RTSP cameras in Settings or send events from Home Assistant to <code>/api/context/sensor_event</code> to see room occupancy here.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, width: '100%' }}>
            {roomEntries.map(([key, r]) => {
              const act = ACTIVITY_MAP[r.activity] || ACTIVITY_MAP.empty
              return (
                <div 
                  key={key} 
                  className="rs-card"
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    position: 'relative',
                    opacity: r.stale ? 0.6 : 1,
                    border: r.persons > 0 ? '1px solid color-mix(in srgb, var(--md-tertiary) 40%, transparent)' : undefined,
                    boxShadow: r.persons > 0 ? '0 0 15px color-mix(in srgb, var(--md-tertiary) 10%, transparent)' : undefined,
                    backdropFilter: 'var(--glass-blur)'
                  }}
                >
                  {r.stale && <div className="rs-pill" style={{ position: 'absolute', top: 12, right: 12, fontSize: '0.6rem', background: 'var(--warn)', color: 'black' }}>STALE</div>}
                  <div className="rs-card-label">{key.replace('_', ' ').toUpperCase()}</div>
                  
                  <div style={{ fontSize: '4rem', fontWeight: 300, lineHeight: 1, margin: '12px 0' }}>{r.persons}</div>
                  
                  <div style={{ color: act.color, fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {act.icon} {act.label}
                  </div>

                  <div style={{ marginTop: 20, width: '100%', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                    <span>{r.temperature ? `${r.temperature}°F` : '--°F'}</span>
                    <span style={{ color: r.lights_on ? 'var(--warn)' : 'inherit' }}>
                      {r.lights_on ? '◉ LIGHTS ON' : '◌ LIGHTS OFF'}
                    </span>
                  </div>

                  <div className="rs-card-meta" style={{ marginTop: 8 }}>Seen {timeAgo(r.last_updated)}</div>

                  <div style={{ marginTop: 20, display: 'flex', gap: 8, width: '100%' }}>
                    <button 
                      className="rs-pill" 
                      style={{ flex: 1 }}
                      onClick={() => markRoom(key, 1, 'present')}
                      disabled={acting === key}
                    >
                      OCCUPIED
                    </button>
                    <button 
                      className="rs-pill" 
                      style={{ flex: 1 }}
                      onClick={() => markRoom(key, 0, 'empty')}
                      disabled={acting === key}
                    >
                      EMPTY
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {isRoverActive && (
          <>
            <div className="rs-card-label" style={{ marginBottom: -12, marginLeft: 12, marginTop: 24 }}>◈ ROVER — ARDU MOWER</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, width: '100%', alignItems: 'start' }}>
              <div className="rs-card" style={{ flex: 1, backdropFilter: 'var(--glass-blur)' }}>
                <div className="rs-card-head">
                  <div className="rs-pill" style={{ background: ROVER_MODE_COLOR[rover.mode] || ROVER_MODE_COLOR.MANUAL, color: 'black', fontWeight: 600 }}>
                    {rover.mode}
                  </div>
                  <div className="rs-card-label" style={{ color: rover.armed ? 'var(--md-error)' : 'inherit' }}>
                    {rover.armed ? '◉ ARMED' : '◌ DISARMED'}
                  </div>
                </div>

                <div style={{ margin: '20px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginBottom: 6, opacity: 0.7 }}>
                    <span>BATTERY</span>
                    <span>{rover.battery_pct}% ({rover.battery_v}V)</span>
                  </div>
                  <div style={{ height: 4, width: '100%', background: 'var(--md-surface-container-high)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${rover.battery_pct}%`, background: 'var(--md-primary)' }} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
                  <div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>SPEED</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{rover.speed_ms} m/s</div>
                  </div>
                  <div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>HEADING</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{rover.heading}°</div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>MISSION STATUS</div>
                  <div style={{ fontSize: '0.85rem' }}>
                    {rover.mission_total > 0 
                      ? `Waypoint ${rover.mission_current} of ${rover.mission_total}`
                      : 'No active mission'}
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', opacity: 0.5 }}>
                  ◈ GPS: {rover.lat.toFixed(6)}, {rover.lon.toFixed(6)}
                </div>
              </div>

              {user.role === 'admin' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'HOLD'})} disabled={acting === 'rover'}>HOLD</button>
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'AUTO'})} disabled={acting === 'rover'}>AUTO</button>
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'RTL'})} disabled={acting === 'rover'}>RTL</button>
                  <button className="rs-pill" style={{ minWidth: 120, color: 'var(--md-error)' }} onClick={() => sendRoverCommand('disarm')} disabled={acting === 'rover'}>DISARM</button>
                </div>
              )}
            </div>

            <div className="rs-card" style={{ borderStyle: 'dashed', background: 'transparent', backdropFilter: 'var(--glass-blur-sm)' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--primary)' }}>◈ GPS: {rover.lat}, {rover.lon}</div>
              <div className="rs-card-meta" style={{ marginTop: 4 }}>Full real-time map integration is planned for Phase 14.</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
