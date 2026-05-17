import React, { useState, useEffect, useCallback } from 'react'
import RiverStatusBox from '../components/RiverStatusBox.jsx'
import HealthCard from '../components/HealthCard.jsx'
import PulseWidget from '../components/PulseWidget.jsx'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * DashboardPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Futuristic "Glass Round" layout. 
 * Replaces the grid-locked SaaS dashboard with a floating "Flow" of cards.
 * Uses the shared grammar defined in chrome-components.css.
 */

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function fmtTime() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

export default function DashboardPage({ onNavigate, isAdmin = false }) {
  const { user, token } = useAuth()
  const userId = user?.id || 'default'

  const [time, setTime] = useState(fmtTime())
  const [date, setDate] = useState(fmtDate())
  const [stats, setStats] = useState(null)
  const [sessions, setSessions] = useState([])
  const [routines, setRoutines] = useState([])
  const [rooms, setRooms] = useState({})
  const [loading, setLoading] = useState(true)

  // Update clock
  useEffect(() => {
    const id = setInterval(() => {
      setTime(fmtTime())
      setDate(fmtDate())
    }, 10000)
    return () => clearInterval(id)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?user_id=${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) setStats(await res.json())

      const rRes = await fetch('/api/routines', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (rRes.ok) setRoutines(await rRes.json())

      const envRes = await fetch('/api/context/rooms', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (envRes.ok) {
        const data = await envRes.json()
        setRooms(data.rooms || {})
      }
    } catch (e) {
      console.error('Fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [userId, token])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30000)
    return () => clearInterval(id)
  }, [fetchData])

  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(`rs-history:${userId}`) || '[]')
      setSessions(all.reverse().slice(0, 5))
    } catch {}
  }, [userId])

  const firstName = user?.display_name?.split(' ')[0] || 'Operator'
  const activeRooms = Object.entries(rooms).filter(([_, r]) => r.persons > 0)
  const statusOk = !stats || stats.status === 'operational'

  return (
    <div className="rs-foyer animate-fade-in">
      
      {/* Hero Zone */}
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting()}, {firstName}.</h1>
        <div className="rs-greeting-sub">River is standing by. All systems nominal.</div>
        
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{ background: statusOk ? '#4ade80' : '#facc15' }} />
          <span>{statusOk ? 'NODE ACTIVE' : 'DEGRADED'}</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span>{date.toUpperCase()}</span>
          <span style={{ opacity: 0.3 }}>|</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
        </div>
      </header>

      {/* Main Flow */}
      <div className="rs-card-flow">

        {/* River Core Status */}
        <div className="rs-card is-elev is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">RIVER CORE</span>
            <span className="rs-card-label" style={{ color: '#4ade80' }}>OPERATIONAL</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <RiverStatusBox state={loading ? 'thinking' : 'idle'} />
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div className="rs-card-label">MEMORY</div>
                <div className="rs-card-value">{stats?.memory?.facts.toLocaleString() || '—'}</div>
                <div className="rs-card-meta">Known facts</div>
              </div>
              <div>
                <div className="rs-card-label">UPTIME</div>
                <div className="rs-card-value">{stats?.uptime || '—'}</div>
                <div className="rs-card-meta">System age</div>
              </div>
            </div>
          </div>
        </div>

        {/* Pulse / Ambient */}
        <div className="rs-card is-tappable" onClick={() => onNavigate('feeds')}>
          <div className="rs-card-head">
            <span className="rs-card-label">PULSE</span>
            <span className="material-symbols-rounded rs-card-chevron">chevron_right</span>
          </div>
          <PulseWidget token={token} />
        </div>

        {/* Quick Actions */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">QUICK ACCESS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="rs-btn-primary" onClick={() => onNavigate('speak')}>
              <span className="material-symbols-rounded">mic</span>
              LISTEN
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button className="rs-pill" onClick={() => onNavigate('chat')}>CHAT</button>
              <button className="rs-pill" onClick={() => onNavigate('chronos')}>NOTES</button>
              <button className="rs-pill" onClick={() => onNavigate('vehicles')}>GARAGE</button>
              <button className="rs-pill" onClick={() => onNavigate('inventory')}>STASH</button>
            </div>
          </div>
        </div>

        {/* Recent Conversations */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">RECENT SESSIONS</span>
            <button className="rs-pill" onClick={() => onNavigate('memory')}>HISTORY</button>
          </div>
          {sessions.length === 0 ? (
            <div className="rs-card-meta">No recent activity recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sessions.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.5, fontSize: '0.8rem' }}>
                    {new Date(s.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '0.92rem' }}>
                    {s.messages?.[0]?.text || 'Voice Interaction'}
                  </span>
                  <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>{s.messages?.length} MSG</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Environment / Smart Home */}
        <div className="rs-card is-tappable" onClick={() => onNavigate('environment')}>
          <div className="rs-card-head">
            <span className="rs-card-label">ENVIRONMENT</span>
            <span className="material-symbols-rounded rs-card-chevron">chevron_right</span>
          </div>
          {activeRooms.length === 0 ? (
            <div className="rs-card-value">ALL QUIET</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {activeRooms.map(([name, r]) => (
                <span key={name} className="rs-pill is-active">
                  {name.replace('_', ' ').toUpperCase()} ({r.persons})
                </span>
              ))}
            </div>
          )}
          <div className="rs-card-meta">Sensors active in {Object.keys(rooms).length} zones.</div>
        </div>

        {/* Routines / Briefing */}
        <div className="rs-card is-tappable" onClick={() => onNavigate('routines')}>
          <div className="rs-card-head">
            <span className="rs-card-label">ACTIVE ROUTINES</span>
            <span className="material-symbols-rounded rs-card-chevron">chevron_right</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {routines.slice(0, 3).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="rs-status-dot" style={{ width: 6, height: 6, opacity: r.enabled ? 1 : 0.2 }} />
                <span style={{ fontSize: '0.9rem' }}>{r.name.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Health */}
        <div className="rs-card is-wide no-pad" style={{ padding: 0, overflow: 'hidden' }}>
          <HealthCard />
        </div>

      </div>
    </div>
  )
}
