import React, { useState, useEffect, useCallback } from 'react'
import RiverStatusBox from '../components/RiverStatusBox.jsx'
import HealthCard from '../components/HealthCard.jsx'
import PulseWidget from '../components/PulseWidget.jsx'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * DashboardPage — Phase 3 Refactor
 * -----------------------------------------------------------------------------
 * Futuristic "Foyer" layout. 
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

export default function DashboardPage({ onNavigate, isAdmin = false, setAction }) {
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
      const raw = localStorage.getItem(`rs-history:${userId}`)
      const all = raw ? JSON.parse(raw) : []
      if (Array.isArray(all)) {
        setSessions([...all].reverse().slice(0, 5))
      }
    } catch {}
  }, [userId])

  useEffect(() => {
    if (setAction) {
      setAction(
        <div className="rs-speak-actions">
          <button className="rs-btn-primary" onClick={() => onNavigate('speak')}>
            <span className="material-symbols-rounded">mic</span>
            <span>Speak to River</span>
          </button>
        </div>
      )
    }
    return () => { if (setAction) setAction(null) }
  }, [setAction, onNavigate])

  const firstName = user?.display_name?.split(' ')[0] || 'Operator'
  const statusOk = !stats || stats.status === 'operational'

  if (loading) return <div className="loading-screen">NEURAL LINK ACTIVE...</div>

  return (
    <div className="rs-foyer animate-page-in">
      
      {/* Hero Zone — Cinematic Greeting */}
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting()}, {firstName}.</h1>
        <div className="rs-greeting-sub">River is standing by. Sector {stats?.sector || '7-G'} systems nominal.</div>
      </header>

      {/* Main Flow (Hardened Bento Grid) */}
      <div className="rs-card-flow">

        {/* River Core Status — High Density Telemetry */}
        <div className="rs-card is-elev is-wide">
          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">CORE TELEMETRY</span>
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ background: statusOk ? '#4ade80' : '#facc15' }} />
                <span>{statusOk ? 'ESTABLISHED' : 'DEGRADED'}</span>
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <RiverStatusBox state={loading ? 'thinking' : 'idle'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 32 }}>
                <div>
                  <div className="rs-card-label">COGNITIVE LOAD</div>
                  <div className="rs-card-value" style={{ fontFamily: 'var(--font-mono)' }}>{stats?.memory?.facts?.toLocaleString() || '—'}</div>
                  <div className="rs-card-meta">Recorded facts</div>
                </div>
                <div>
                  <div className="rs-card-label">UPTIME</div>
                  <div className="rs-card-value" style={{ fontFamily: 'var(--font-mono)' }}>{stats?.uptime || '—'}</div>
                  <div className="rs-card-meta">Node age</div>
                </div>
                <div>
                  <div className="rs-card-label">NEURAL LATENCY</div>
                  <div className="rs-card-value" style={{ fontFamily: 'var(--font-mono)' }}>12<small style={{ fontSize: '0.6rem', opacity: 0.5, marginLeft: 4 }}>MS</small></div>
                  <div className="rs-card-meta">Link speed</div>
                </div>
                <div>
                  <div className="rs-card-label">SECTOR SYNC</div>
                  <div className="rs-card-value" style={{ fontFamily: 'var(--font-mono)' }}>1.2<small style={{ fontSize: '0.6rem', opacity: 0.5, marginLeft: 4 }}>GB/S</small></div>
                  <div className="rs-card-meta">Data throughput</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pulse / Ambient */}
        <div className="rs-card is-tappable" onClick={() => onNavigate('feeds')}>
          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">SECTOR PULSE</span>
              <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>sensors</span>
            </div>
            <div style={{ height: 140, margin: '12px 0' }}>
              <PulseWidget data={stats?.pulse} />
            </div>
            <div className="rs-card-meta">Real-time activity reports</div>
          </div>
        </div>

        {/* Maintenance / Health */}
        <div className="rs-card is-tappable" onClick={() => onNavigate('pulse')}>
          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">SYSTEM INTEGRITY</span>
              <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>monitor_heart</span>
            </div>
            <div style={{ padding: '8px 0' }}>
               <HealthCard stats={stats} />
            </div>
            <div className="rs-card-meta">Fleet & Hardware status</div>
          </div>
        </div>

        {/* Recent Conversations */}
        <div className="rs-card is-wide is-tappable" onClick={() => onNavigate('memory')}>
          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">ACTIVE ARCHIVES</span>
              <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>history</span>
            </div>
            {(!sessions || sessions.length === 0) ? (
              <div className="rs-card-meta" style={{ padding: '24px 0', textAlign: 'center' }}>Archives empty. Start a link to begin recording.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                {sessions.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ borderLeft: '1px solid var(--md-outline-variant)', paddingLeft: 20 }}>
                    <div className="rs-card-label" style={{ fontSize: '0.55rem' }}>{new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', marginTop: 6, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.messages?.[0]?.text || 'Voice interaction'}</div>
                    <div className="rs-card-meta" style={{ fontSize: '0.65rem' }}>{s.messages?.length || 0} MSG</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status Strip (Bottom) */}
        <div className="rs-card is-wide !bg-transparent !border-none !shadow-none !p-0 flex justify-center mt-12">
          <div className="rs-status-strip" style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="rs-status-dot" style={{ background: statusOk ? '#4ade80' : '#facc15' }} />
            <span style={{ fontSize: '0.65rem', fontWeight: 900 }}>NEURAL LINK: {statusOk ? 'NOMINAL' : 'DEGRADED'}</span>
            <span style={{ opacity: 0.2 }}>|</span>
            <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>{date.toUpperCase()}</span>
            <span style={{ opacity: 0.2 }}>|</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em' }}>{time}</span>
          </div>
        </div>

      </div>
    </div>
  )
}
