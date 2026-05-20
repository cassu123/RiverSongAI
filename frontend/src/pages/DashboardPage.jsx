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
 * Supports fluid glass card expansion and interactive transitions.
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
  const [expandedCard, setExpandedCard] = useState(null)

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

  const toggleExpand = (cardId) => {
    setExpandedCard(prev => prev === cardId ? null : cardId)
  }

  const getCardClasses = (cardId, baseClasses = '') => {
    const isExpanded = expandedCard === cardId
    const isAnyExpanded = expandedCard !== null
    const isReceding = isAnyExpanded && !isExpanded
    return `${baseClasses} ${isExpanded ? 'is-expanded' : ''} ${isReceding ? 'is-receding' : ''}`
  }

  if (loading) return <div className="loading-screen">NEURAL LINK ACTIVE...</div>

  return (
    <div className="rs-foyer animate-page-in">
      
      {/* Hero Zone — Cinematic Greeting */}
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting()}, {firstName}.</h1>
        <div className="rs-greeting-sub">River is standing by. Sector {stats?.sector || '7-G'} systems nominal.</div>
      </header>

      {/* Main Flow (Floating Bento Layout) */}
      <div className="rs-dashboard-flow">

        {/* River Core Status — High Density Telemetry */}
        <div 
          className={getCardClasses('telemetry', 'rs-card is-elev is-wide is-tappable')}
          onClick={() => toggleExpand('telemetry')}
        >
          {expandedCard === 'telemetry' && (
            <button 
              className="rs-icon-btn rs-card-close" 
              onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          )}

          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">CORE TELEMETRY</span>
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ color: statusOk ? 'var(--rs-status-nominal)' : 'var(--rs-status-warning)' }} />
                <span>{statusOk ? 'ESTABLISHED' : 'DEGRADED'}</span>
              </div>
            </div>
            
            <div className="rs-telemetry-container">
              <div className="rs-telemetry-visual">
                <RiverStatusBox state={loading ? 'thinking' : 'idle'} />
              </div>
              <div className="rs-telemetry-grid">
                <div>
                  <div className="rs-card-label">COGNITIVE LOAD</div>
                  <div className="rs-card-value">{stats?.memory?.facts?.toLocaleString() || '—'}</div>
                  <div className="rs-card-meta">Recorded facts</div>
                </div>
                <div>
                  <div className="rs-card-label">UPTIME</div>
                  <div className="rs-card-value">{stats?.uptime || '—'}</div>
                  <div className="rs-card-meta">Node age</div>
                </div>
                <div>
                  <div className="rs-card-label">NEURAL LATENCY</div>
                  <div className="rs-card-value">12<small style={{ fontSize: '0.6rem', opacity: 0.5, marginLeft: 4 }}>MS</small></div>
                  <div className="rs-card-meta">Link speed</div>
                </div>
                <div>
                  <div className="rs-card-label">SECTOR SYNC</div>
                  <div className="rs-card-value">1.2<small style={{ fontSize: '0.6rem', opacity: 0.5, marginLeft: 4 }}>GB/S</small></div>
                  <div className="rs-card-meta">Data throughput</div>
                </div>
              </div>
            </div>

            {expandedCard === 'telemetry' && (
              <div className="rs-card-inner animate-fade-in">
                <div className="rs-card-label">INTEGRATED COGNITIVE SKILLS & TOOLS</div>
                <div className="rs-archives-grid" style={{ marginTop: 16 }}>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">GOOGLE TASKS</div>
                    <div className="rs-health-value">ACTIVE</div>
                    <div className="rs-health-subvalue">list_google_tasks, add_google_task</div>
                  </div>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">GOOGLE BOOKS</div>
                    <div className="rs-health-value">ACTIVE</div>
                    <div className="rs-health-subvalue">search_google_books</div>
                  </div>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">DREAMSCAPE ENGINE</div>
                    <div className="rs-health-value">ACTIVE</div>
                    <div className="rs-health-subvalue">generate_image</div>
                  </div>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">COGNITIVE AGENTS</div>
                    <div className="rs-health-value">RESEARCHER, SELF</div>
                    <div className="rs-health-subvalue">Subagent orchestrator v2.0</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pulse / Ambient */}
        <div 
          className={getCardClasses('pulse', 'rs-card is-tappable is-small')}
          onClick={() => toggleExpand('pulse')}
        >
          {expandedCard === 'pulse' && (
            <button 
              className="rs-icon-btn rs-card-close" 
              onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          )}

          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">SECTOR PULSE</span>
              <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>sensors</span>
            </div>
            <div className="rs-widget-pulse-wrapper">
              <PulseWidget data={stats?.pulse} />
            </div>
            <div className="rs-card-meta">Real-time activity reports</div>

            {expandedCard === 'pulse' && (
              <div className="rs-card-inner animate-fade-in">
                <div className="rs-card-label">DETAILED ENVIRONMENT TELEMETRY</div>
                <div className="rs-archives-grid" style={{ marginTop: 16 }}>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">ACTIVE ROOMS</div>
                    <div className="rs-health-value">
                      {Object.keys(rooms).length > 0 
                        ? Object.entries(rooms).map(([name, r]) => `${name.toUpperCase()} (${r.temperature}°C)`).join(' · ') 
                        : 'NO ACTIVE BEACON'}
                    </div>
                    <div className="rs-health-subvalue">Context-aware environment sync</div>
                  </div>
                  <div className="rs-archive-item">
                    <div className="rs-card-label">ROUTINES IN QUEUE</div>
                    <div className="rs-health-value">
                      {routines.length > 0 
                        ? `${routines.length} ACTIVE PATTERNS` 
                        : 'NONE CONFIGURED'}
                    </div>
                    <div className="rs-health-subvalue">Automatic trigger matching</div>
                  </div>
                </div>
                <div className="flex justify-end mt-6">
                  <button className="rs-btn-primary" onClick={(e) => { e.stopPropagation(); onNavigate('feeds'); }}>
                    <span>Open Feeds Panel</span>
                    <span className="material-symbols-rounded">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Maintenance / Health */}
        <div 
          className={getCardClasses('integrity', 'rs-card is-tappable is-small')}
          onClick={() => toggleExpand('integrity')}
        >
          {expandedCard === 'integrity' && (
            <button 
              className="rs-icon-btn rs-card-close" 
              onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          )}

          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">SYSTEM INTEGRITY</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="rs-status-dot" style={{ color: statusOk ? 'var(--rs-status-nominal)' : 'var(--rs-status-warning)' }} />
                <span className="rs-card-label" style={{ color: statusOk ? 'var(--rs-status-nominal)' : 'var(--rs-status-warning)', opacity: 1 }}>
                  {statusOk ? 'NOMINAL' : 'DEGRADED'}
                </span>
              </div>
            </div>
            <div className="rs-widget-health-wrapper">
               <HealthCard stats={stats} />
            </div>
            <div className="rs-card-meta">Fleet & Hardware status</div>

            {expandedCard === 'integrity' && (
              <div className="flex justify-end mt-6 animate-fade-in">
                <button className="rs-btn-primary" onClick={(e) => { e.stopPropagation(); onNavigate('pulse'); }}>
                  <span>Open Pulse Panel</span>
                  <span className="material-symbols-rounded">arrow_forward</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Recent Conversations */}
        <div 
          className={getCardClasses('archives', 'rs-card is-tappable is-wide')}
          onClick={() => toggleExpand('archives')}
        >
          {expandedCard === 'archives' && (
            <button 
              className="rs-icon-btn rs-card-close" 
              onClick={(e) => { e.stopPropagation(); setExpandedCard(null); }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          )}

          <div className="rs-card-inner">
            <div className="rs-card-head">
              <span className="rs-card-label">ACTIVE ARCHIVES</span>
              <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>history</span>
            </div>
            {(!sessions || sessions.length === 0) ? (
              <div className="rs-empty-state">Archives empty. Start a link to begin recording.</div>
            ) : (
              <div className="rs-archives-grid">
                {(expandedCard === 'archives' ? sessions : sessions.slice(0, 3)).map((s, i) => (
                  <div key={i} className="rs-archive-item">
                    <div className="rs-card-label">{new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="rs-archive-message">{s.messages?.[0]?.text || 'Voice interaction'}</div>
                    <div className="rs-card-meta">{s.messages?.length || 0} MSG</div>
                  </div>
                ))}
              </div>
            )}

            {expandedCard === 'archives' && (
              <div className="rs-card-inner animate-fade-in">
                <div className="rs-card-label">RECENT KNOWLEDGE REVELATIONS & MEMORY STACKS</div>
                <div className="rs-archives-grid" style={{ marginTop: 16 }}>
                  {stats?.memory?.recent_facts?.length > 0 ? (
                    stats.memory.recent_facts.map((fact, idx) => (
                      <div key={idx} className="rs-archive-item">
                        <div className="rs-card-label">FACT RECORD #{idx + 1}</div>
                        <div className="rs-archive-message" style={{ WebkitLineClamp: 2 }}>{fact}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rs-archive-item">
                      <div className="rs-card-label">FACT CORE</div>
                      <div className="rs-health-value">SYNC COMPLETE</div>
                      <div className="rs-health-subvalue">No recent modifications</div>
                    </div>
                  )}
                </div>
                <div className="flex justify-end mt-6">
                  <button className="rs-btn-primary" onClick={(e) => { e.stopPropagation(); onNavigate('memory'); }}>
                    <span>Open Memory Vault</span>
                    <span className="material-symbols-rounded">arrow_forward</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Status Strip (Bottom) */}
        <div className="rs-dashboard-status-wrapper">
          <div className="rs-status-strip">
            <span className="rs-status-dot" style={{ color: statusOk ? 'var(--rs-status-nominal)' : 'var(--rs-status-warning)' }} />
            <span>NEURAL LINK: {statusOk ? 'NOMINAL' : 'DEGRADED'}</span>
            <span className="rs-status-divider">|</span>
            <span>{date.toUpperCase()}</span>
            <span className="rs-status-divider">|</span>
            <span className="rs-status-time">{time}</span>
          </div>
        </div>

      </div>
    </div>
  )
}
