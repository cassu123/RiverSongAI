import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@context/AuthContext'
import { Link } from 'react-router-dom'

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
      <div className="rs-flex rs-gap-3 rs-w-full" style={{ justifyContent: 'flex-end' }}>
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

      <div className="rs-flex rs-gap-5 rs-mb-5" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--rs-space-2)' }}>
        <Link to="/environment" style={{ fontWeight: 600, color: 'var(--accent-primary)', textDecoration: 'none', borderBottom: '2px solid var(--accent-primary)', paddingBottom: 'var(--rs-space-2)', marginBottom: -9 }}>Property / Home</Link>
        <Link to="/fleet" style={{ fontWeight: 400, color: 'var(--text-secondary)', textDecoration: 'none' }}>Fleet</Link>
      </div>

      {flash && (
        <div className="rs-card rs-mb-4" style={{
          background: 'var(--md-primary-container)',
          color: 'var(--md-on-primary-container)',
          padding: 'var(--rs-space-3) var(--rs-space-5)',
          borderRadius: 'var(--md-shape-xl)',
        }}>
          {flash}
        </div>
      )}

      <div className="rs-card-flow">
        <div className="rs-card-label" style={{ marginBottom: -12, marginLeft: 'var(--rs-space-3)' }}>◉ ROOM PRESENCE</div>
        
        {roomEntries.length === 0 ? (
          <div className="rs-card">
            <div className="rs-card-head">
              <span className="rs-card-label">SENSORS NOT DETECTED</span>
            </div>
            <p className="rs-card-meta">Configure RTSP cameras in Settings or send events from Home Assistant to <code>/api/context/sensor_event</code> to see room occupancy here.</p>
          </div>
        ) : (
          <div className="rs-gap-4 rs-w-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {roomEntries.map(([key, r]) => {
              const act = ACTIVITY_MAP[r.activity] || ACTIVITY_MAP.empty
              return (
                <div 
                  key={key} 
                  className="rs-card rs-flex rs-flex-col rs-items-center rs-relative"
                  style={{
                    opacity: r.stale ? 0.6 : 1,
                    border: r.persons > 0 ? '1px solid color-mix(in srgb, var(--md-tertiary) 40%, transparent)' : undefined,
                    boxShadow: r.persons > 0 ? '0 0 15px color-mix(in srgb, var(--md-tertiary) 10%, transparent)' : undefined,
                    backdropFilter: 'var(--glass-blur)',
                  }}
                >
                  {r.stale && <div className="rs-pill rs-type-nano" style={{ position: 'absolute', top: 12, right: 12, background: 'var(--warn)', color: 'black' }}>STALE</div>}
                  <div className="rs-card-label">{key.replace('_', ' ').toUpperCase()}</div>
                  
                  <div style={{ fontSize: '4rem', fontWeight: 300, lineHeight: 1, margin: 'var(--rs-space-3) 0' }}>{r.persons}</div>
                  
                  <div className="rs-type-micro" style={{ color: act.color, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {act.icon} {act.label}
                  </div>

                  <div className="rs-mt-5 rs-w-full rs-flex rs-justify-between rs-muted rs-type-micro rs-mono">
                    <span>{r.temperature ? `${r.temperature}°F` : '--°F'}</span>
                    <span style={{ color: r.lights_on ? 'var(--warn)' : 'inherit' }}>
                      {r.lights_on ? '◉ LIGHTS ON' : '◌ LIGHTS OFF'}
                    </span>
                  </div>

                  <div className="rs-card-meta rs-mt-2">Seen {timeAgo(r.last_updated)}</div>

                  <div className="rs-mt-5 rs-flex rs-gap-2 rs-w-full">
                    <button 
                      className="rs-pill rs-grow" 
                     
                      onClick={() => markRoom(key, 1, 'present')}
                      disabled={acting === key}
                    >
                      OCCUPIED
                    </button>
                    <button 
                      className="rs-pill rs-grow" 
                     
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
            <div className="rs-card-label rs-mt-5" style={{ marginBottom: -12, marginLeft: 'var(--rs-space-3)' }}>◈ ROVER — ARDU MOWER</div>
            <div className="rs-gap-4 rs-w-full" style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'start' }}>
              <div className="rs-card rs-grow" style={{ backdropFilter: 'var(--glass-blur)' }}>
                <div className="rs-card-head">
                  <div className="rs-pill" style={{ background: ROVER_MODE_COLOR[rover.mode] || ROVER_MODE_COLOR.MANUAL, color: 'black', fontWeight: 600 }}>
                    {rover.mode}
                  </div>
                  <div className="rs-card-label" style={{ color: rover.armed ? 'var(--md-error)' : 'inherit' }}>
                    {rover.armed ? '◉ ARMED' : '◌ DISARMED'}
                  </div>
                </div>

                <div style={{ margin: 'var(--rs-space-5) 0' }}>
                  <div className="rs-flex rs-justify-between rs-mb-2 rs-muted rs-type-nano">
                    <span>BATTERY</span>
                    <span>{rover.battery_pct}% ({rover.battery_v}V)</span>
                  </div>
                  <div className="rs-w-full rs-clip" style={{ height: 4, background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-xs)' }}>
                    <div className="rs-h-full" style={{ width: `${rover.battery_pct}%`, background: 'var(--md-primary)' }} />
                  </div>
                </div>

                <div className="rs-gap-5 rs-mb-4" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <div className="rs-card-label rs-type-nano">SPEED</div>
                    <div className="rs-type-small" style={{ fontWeight: 500 }}>{rover.speed_ms} m/s</div>
                  </div>
                  <div>
                    <div className="rs-card-label rs-type-nano">HEADING</div>
                    <div className="rs-type-small" style={{ fontWeight: 500 }}>{rover.heading}°</div>
                  </div>
                </div>

                <div className="rs-mb-3 rs-flex rs-justify-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--rs-space-3)' }}>
                  <div className="rs-card-label rs-type-nano">MISSION STATUS</div>
                  <div className="rs-type-tiny">
                    {rover.mission_total > 0 
                      ? `Waypoint ${rover.mission_current} of ${rover.mission_total}`
                      : 'No active mission'}
                  </div>
                </div>

                <div className="rs-muted rs-mono rs-type-nano">
                  ◈ GPS: {rover.lat.toFixed(6)}, {rover.lon.toFixed(6)}
                </div>
              </div>

              {user.role === 'admin' && (
                <div className="rs-flex rs-flex-col rs-gap-2">
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'HOLD'})} disabled={acting === 'rover'}>HOLD</button>
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'AUTO'})} disabled={acting === 'rover'}>AUTO</button>
                  <button className="rs-btn-primary" style={{ minWidth: 120 }} onClick={() => sendRoverCommand('set_mode', {mode: 'RTL'})} disabled={acting === 'rover'}>RTL</button>
                  <button className="rs-pill" style={{ minWidth: 120, color: 'var(--md-error)' }} onClick={() => sendRoverCommand('disarm')} disabled={acting === 'rover'}>DISARM</button>
                </div>
              )}
            </div>

            <div className="rs-card" style={{ borderStyle: 'dashed', background: 'transparent', backdropFilter: 'var(--glass-blur-sm)' }}>
              <div className="rs-mono rs-type-tiny" style={{ color: 'var(--primary)' }}>◈ GPS: {rover.lat}, {rover.lon}</div>
              <div className="rs-card-meta rs-mt-1">Full real-time map integration is planned for Phase 14.</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
