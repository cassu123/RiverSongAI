import React, { useState, useEffect, useCallback } from 'react'
import RiverStatusBox from '../components/RiverStatusBox.jsx'
import HealthCard from '../components/HealthCard.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import './DashboardPage.css'

// ---------------------------------------------------------------------------
// Widget registry — defines every available tile
// ---------------------------------------------------------------------------
const ALL_WIDGETS = [
  { key: 'health_status',   label: 'River Song Health', col: 'left' },
  { key: 'system_status',   label: 'System Status',   col: 'left',  adminOnly: true },
  { key: 'recent_sessions', label: 'Recent Sessions',  col: 'left'  },
  { key: 'memory_activity', label: 'Memory Activity',  col: 'left'  },
  { key: 'learned_patterns', label: 'Learned Patterns', col: 'left' },
  { key: 'environment',     label: 'Environment',      col: 'left' },
  { key: 'river_status',    label: 'River Status',     col: 'right' },
  { key: 'quick_actions',   label: 'Quick Actions',    col: 'right' },
  { key: 'rover',           label: 'Rover Status',     col: 'right' },
  { key: 'active_routines', label: 'Active Routines',  col: 'right' },
  { key: 'briefing_setup',  label: 'Briefing Setup',   col: 'right' },
]

const DEFAULT_VISIBLE = Object.fromEntries(ALL_WIDGETS.map(w => [w.key, true]))

function loadWidgets() {
  try {
    const v = localStorage.getItem('rs-dashboard-widgets')
    return v ? { ...DEFAULT_VISIBLE, ...JSON.parse(v) } : DEFAULT_VISIBLE
  } catch { return DEFAULT_VISIBLE }
}

function saveWidgets(v) {
  try { localStorage.setItem('rs-dashboard-widgets', JSON.stringify(v)) } catch {}
}

function loadSessions(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(`rs-history:${userId}`) || '[]')
    return [...all].reverse().slice(0, 8).map(s => ({
      time: new Date(s.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      date: s.date,
      text: s.messages?.[0]?.text || 'Conversation',
      count: s.messages?.length || 0,
      model: s.model || '',
    }))
  } catch { return [] }
}

function fmtSchedule(r) {
  if (r.trigger === 'daily')   return `Daily ${r.time || ''}`
  if (r.trigger === 'weekly')  return (r.days?.length ? r.days.join('/') : '—') + (r.time ? ` ${r.time}` : '')
  if (r.trigger === 'startup') return 'On startup'
  return 'Manual'
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------
export default function DashboardPage({ onNavigate, isAdmin = false }) {
  const { user, token } = useAuth()
  const userId = user?.id || 'default'

  const [time,       setTime]       = useState(fmtDate())
  const [arrange,    setArrange]    = useState(false)
  const [visible,    setVisible]    = useState(loadWidgets)
  const [stats,      setStats]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [sessions,   setSessions]   = useState([])
  const [routines,   setRoutines]   = useState([])
  const [patterns,   setPatterns]   = useState([])
  const [rooms,      setRooms]      = useState({})
  const [roverStatus, setRoverStatus] = useState(null)
  const [briefingModal, setBriefingModal] = useState(null) // 'morning' | 'evening' | null
  const [flash,      setFlash]      = useState(null)

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(fmtDate()), 30000)
    return () => clearInterval(id)
  }, [])

  // Live data fetch
  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetch(`/api/dashboard?user_id=${userId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(res.status)
      const data = await res.json()
      setStats(data)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [userId, token])

  const fetchRoutines = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/routines', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setRoutines(data)
        localStorage.setItem('rs-routines', JSON.stringify(data))
      }
    } catch {}
  }, [token])

  const fetchPatterns = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/memory/preferences?user_id=${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        const highConfHabits = data
          .filter(p => p.category?.includes('habit') || p.confidence === 'high')
          .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
          .slice(0, 4)
        setPatterns(highConfHabits)
      }
    } catch {}
  }, [userId, token])

  const fetchEnvironment = useCallback(async () => {
    if (!token) return
    try {
      const roomRes = await fetch('/api/context/rooms', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (roomRes.ok) {
        const data = await roomRes.json()
        setRooms(data.rooms || {})
      }

      const roverRes = await fetch('/api/rover/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (roverRes.ok) {
        const data = await roverRes.json()
        setRoverStatus(data)
      }
    } catch {}
  }, [token])

  useEffect(() => {
    fetchStats()
    fetchRoutines()
    fetchPatterns()
    fetchEnvironment()
    const id = setInterval(() => {
      fetchStats()
      fetchEnvironment()
    }, 30000)
    return () => clearInterval(id)
  }, [fetchStats, fetchRoutines, fetchPatterns, fetchEnvironment])

  // Load localStorage-backed data
  useEffect(() => {
    setSessions(loadSessions(userId))
  }, [userId])

  // Widget toggle
  const toggleWidget = (key) => {
    setVisible(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveWidgets(next)
      return next
    })
  }

  const resetWidgets = () => {
    setVisible(DEFAULT_VISIBLE)
    saveWidgets(DEFAULT_VISIBLE)
  }

  const handleBriefingSaved = (msg) => {
    setFlash(msg)
    setBriefingModal(null)
    fetchRoutines()
    setTimeout(() => setFlash(null), 4000)
  }

  // In arrange mode, show all widgets so they can be toggled
  const show = (key) => arrange || visible[key]

  // Derived status values
  const statusOk  = !stats || stats.status === 'operational'
  const latency   = stats ? `${stats.latency_ms}ms` : '—'
  const uptime    = stats ? stats.uptime : '—'
  const factCount = stats ? stats.memory.facts.toLocaleString() : '—'
  const sumCount  = stats ? stats.memory.summaries : '—'
  const firstName = user?.display_name?.split(' ')[0] || 'Operator'

  // Bar chart
  const totalMemory = stats ? (stats.memory.facts + stats.memory.summaries) : 0
  const barHeights  = Array.from({ length: 30 }, (_, i) => {
    const base = totalMemory > 0 ? Math.min(48, 8 + (totalMemory / 30) * (0.5 + Math.sin(i * 1.3 + 1) * 0.5)) : 8 + Math.sin(i * 0.7) * 4
    return Math.max(6, Math.round(base))
  })

  const morningRoutine = routines.find(r => r.name === 'Morning Briefing')
  const eveningRoutine = routines.find(r => r.name === 'Evening Summary')

  return (
    <div className="page-wrap dashboard-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>COMMAND</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>NODE-CW-01</span>
          </div>
          <h1 className="page-title">{greeting()}, {firstName}.</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            River is standing by.
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{time}</span>
          </div>
        </div>

        <div className="page-header-actions">
          {arrange && (
            <button className="btn" onClick={resetWidgets}>RESET</button>
          )}
          <button
            className={`btn ${arrange ? 'btn--primary' : ''}`}
            onClick={() => setArrange(a => !a)}
          >
            {arrange ? '✓ DONE' : '⊞ ARRANGE'}
          </button>
          <button className="btn btn--cta" onClick={() => onNavigate('speak')}>
            ▸ SPEAK TO RIVER
          </button>
        </div>
      </div>

      {flash && <div className="dash-flash animate-fade-in">{flash}</div>}

      {/* Arrange mode banner */}
      {arrange && (
        <div className="dash-arrange-banner">
          Toggle tiles to show or hide them on your dashboard.
        </div>
      )}

      {/* Widget toggles (arrange mode) */}
      {arrange && (
        <div className="dash-widget-toggles">
          {ALL_WIDGETS.filter(w => !w.adminOnly || isAdmin).map(w => (
            <button
              key={w.key}
              className={`dash-widget-chip ${visible[w.key] ? 'dash-widget-chip--on' : ''}`}
              onClick={() => toggleWidget(w.key)}
            >
              <span className={`dot ${visible[w.key] ? 'dot--on' : 'dot--off'}`} />
              {w.label}
              {w.adminOnly && <span className="dash-widget-admin-badge">ADMIN</span>}
            </button>
          ))}
        </div>
      )}

      {/* Dashboard grid */}
      <div className="dashboard">
        <div className="dashboard-left">

          {/* Health Status */}
          {show('health_status') && (
            <WidgetShell
              label={null}
              widgetKey="health_status"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              noPad
            >
              <HealthCard />
            </WidgetShell>
          )}

          {/* System Status — admin only */}
          {isAdmin && show('system_status') && (
            <WidgetShell
              label="SYSTEM STATUS"
              widgetKey="system_status"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="status-grid">
                <div className="status-cell">
                  <div className="status-cell-label">OPS</div>
                  <div className={`status-cell-value ${statusOk ? 'status-cell-value--ok' : ''} status-cell-value--nominal`}>
                    <span className={`dot ${loading ? 'dot--standby' : statusOk ? 'dot--on' : 'dot--warn'}`} />
                    {loading ? 'LOADING' : statusOk ? 'NOMINAL' : 'DEGRADED'}
                  </div>
                </div>
                <div className="status-cell">
                  <div className="status-cell-label">LATENCY</div>
                  <div className="status-cell-value">{latency}</div>
                </div>
                <div className="status-cell">
                  <div className="status-cell-label">FACTS</div>
                  <div className="status-cell-value">{factCount}</div>
                </div>
                <div className="status-cell">
                  <div className="status-cell-label">UPTIME</div>
                  <div className="status-cell-value">{uptime}</div>
                </div>
              </div>
            </WidgetShell>
          )}

          {/* Recent Sessions */}
          {show('recent_sessions') && (
            <WidgetShell
              label="RECENT SESSIONS"
              widgetKey="recent_sessions"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              style={{ flex: 1 }}
            >
              <div className="session-list">
                {sessions.length === 0 ? (
                  <div className="session-empty">No saved sessions yet. Conversations save when you reset the chat.</div>
                ) : sessions.map((s, i) => (
                  <div className="session-row" key={i}>
                    <span className="session-time">{s.time}</span>
                    <span className="session-text">{s.text}</span>
                    <span className="session-dur">{s.count} msg</span>
                  </div>
                ))}
              </div>
            </WidgetShell>
          )}

          {/* Memory Activity */}
          {show('memory_activity') && (
            <WidgetShell
              label="MEMORY ACTIVITY"
              widgetKey="memory_activity"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="memory-stats">
                <div className="mem-stat">
                  <span className="mem-stat-val">{factCount}</span>
                  <span className="mem-stat-label">FACTS</span>
                </div>
                <div className="mem-stat">
                  <span className="mem-stat-val">{sumCount}</span>
                  <span className="mem-stat-label">SUMMARIES</span>
                </div>
              </div>
              <div className="mem-bar-chart">
                {barHeights.map((h, i) => (
                  <div key={i} className="mem-bar" style={{ height: `${h}px` }} />
                ))}
              </div>
            </WidgetShell>
          )}

          {/* Learned Patterns Widget */}
          {show('learned_patterns') && (
            <WidgetShell
              label="LEARNED PATTERNS"
              widgetKey="learned_patterns"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              {patterns.length === 0 ? (
                <div className="patterns-empty">No patterns learned yet — start talking to River Song!</div>
              ) : (
                <ul className="patterns-list">
                  {patterns.map((p, i) => (
                    <li key={i} className="patterns-item">
                      <span className="patterns-item-icon">◈</span>
                      <div className="patterns-item-content">
                        <div className="patterns-item-text">{p.value}</div>
                        <div className="patterns-item-date">{new Date(p.last_updated).toLocaleDateString()}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="patterns-footer">
                <button className="dash-link" onClick={() => onNavigate('memory')}>View all →</button>
              </div>
            </WidgetShell>
          )}

          {/* Environment Widget */}
          {show('environment') && (
            <WidgetShell
              label="ENVIRONMENT"
              widgetKey="environment"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="dash-env-summary">
                {Object.keys(rooms).length === 0 ? (
                  <div className="patterns-empty">No sensors active.</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {Object.entries(rooms).filter(([_, r]) => r.persons > 0).map(([name, r]) => (
                        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#00ff66' }}>
                          <span>◉</span> {name.replace('_', ' ').toUpperCase()} ({r.persons})
                        </div>
                      ))}
                    </div>
                    {Object.entries(rooms).filter(([_, r]) => r.persons > 0).length === 0 && (
                      <div className="patterns-empty" style={{ padding: '8px 0' }}>All rooms empty.</div>
                    )}
                  </>
                )}
              </div>
              <div className="patterns-footer">
                <button className="dash-link" onClick={() => onNavigate('environment')}>View details →</button>
              </div>
            </WidgetShell>
          )}
        </div>

        <div className="dashboard-right">

          {/* River Status */}
          {show('river_status') && (
            <WidgetShell
              label={null}
              widgetKey="river_status"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              noPad
            >
              <RiverStatusBox state="idle" />
            </WidgetShell>
          )}

          {/* Quick Actions */}
          {show('quick_actions') && (
            <WidgetShell
              label="QUICK ACTIONS"
              widgetKey="quick_actions"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="quick-actions">
                <button className="qa-btn" onClick={() => onNavigate('speak')}>
                  <span className="qa-dot" />LISTEN
                </button>
                <button className="qa-btn" onClick={() => setBriefingModal('morning')}>
                  <span className="qa-dot" style={{ background: '#ffaa00' }} />☀ MORNING BRIEFING
                </button>
                <button className="qa-btn" onClick={() => setBriefingModal('evening')}>
                  <span className="qa-dot" style={{ background: '#00aaff' }} />🌙 EVENING SUMMARY
                </button>
                <button className="qa-btn" onClick={() => onNavigate('routines')}>
                  <span className="qa-dot" style={{ background: 'var(--text-dim)' }} />NEW ROUTINE
                </button>
                <button className="qa-btn" onClick={() => onNavigate('home')}>
                  <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />HOME SCENE
                </button>
                <button className="qa-btn" onClick={() => onNavigate('memory')}>
                  <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />LOG EVENT
                </button>
              </div>
            </WidgetShell>
          )}

          {/* Rover Status Widget */}
          {show('rover') && roverStatus && (
            <WidgetShell
              label="ROVER STATUS"
              widgetKey="rover"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="dash-rover-summary" style={{ fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ 
                    padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600, color: 'black',
                    background: roverStatus.telemetry_summary.mode === 'AUTO' ? '#00ff66' : '#ffaa00' 
                  }}>
                    {roverStatus.telemetry_summary.mode || 'OFFLINE'}
                  </span>
                  <span style={{ color: roverStatus.telemetry_summary.armed ? 'var(--md-error)' : 'var(--text-muted)' }}>
                    {roverStatus.telemetry_summary.armed ? '◉ ARMED' : '◌ DISARMED'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  <span>BATTERY</span>
                  <span>{roverStatus.telemetry_summary.battery_pct != null ? `${roverStatus.telemetry_summary.battery_pct}%` : '--%'}</span>
                </div>
                <div style={{ height: 4, background: 'var(--md-outline-variant)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', background: 'var(--md-primary)', 
                    width: `${roverStatus.telemetry_summary.battery_pct || 0}%` 
                  }} />
                </div>
              </div>
              <div className="patterns-footer">
                <button className="dash-link" onClick={() => onNavigate('environment')}>View details →</button>
              </div>
            </WidgetShell>
          )}

          {/* Active Routines */}
          {show('active_routines') && (
            <WidgetShell
              label="ACTIVE ROUTINES"
              widgetKey="active_routines"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              style={{ flex: 1 }}
            >
              {routines.length === 0 ? (
                <div className="session-empty" style={{ padding: '10px 0' }}>
                  No routines yet.{' '}
                  <button className="dash-link" onClick={() => onNavigate('routines')}>Create one →</button>
                </div>
              ) : routines.map((r) => (
                <div className="routine-row" key={r.id}>
                  <span className={`dot ${r.enabled ? 'dot--on' : 'dot--off'}`} />
                  <span className="routine-name">{r.name}</span>
                  <span className="routine-sched">{fmtSchedule(r)}</span>
                </div>
              ))}
            </WidgetShell>
          )}

          {/* Briefing Setup Widget */}
          {show('briefing_setup') && (
            <WidgetShell
              label="BRIEFING SETUP"
              widgetKey="briefing_setup"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
            >
              <div className="briefing-status">
                <div className="briefing-status-item">
                  <span className={`dot ${morningRoutine?.enabled ? 'dot--on' : 'dot--off'}`} />
                  ☀ Morning: {morningRoutine ? morningRoutine.time : 'Not set'}
                </div>
                <div className="briefing-status-item">
                  <span className={`dot ${eveningRoutine?.enabled ? 'dot--on' : 'dot--off'}`} />
                  🌙 Evening: {eveningRoutine ? eveningRoutine.time : 'Not set'}
                </div>
                {morningRoutine && eveningRoutine && (
                  <div style={{ marginTop: 8, color: 'var(--secondary)' }}>✓ Active</div>
                )}
              </div>
              <div className="patterns-footer">
                <button className="dash-link" onClick={() => setBriefingModal('morning')}>Edit briefings →</button>
              </div>
            </WidgetShell>
          )}
        </div>
      </div>

      {briefingModal && (
        <BriefingModal
          type={briefingModal}
          token={token}
          existing={briefingModal === 'morning' ? morningRoutine : eveningRoutine}
          onClose={() => setBriefingModal(null)}
          onSaved={handleBriefingSaved}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WidgetShell — card wrapper with optional arrange-mode overlay
// ---------------------------------------------------------------------------
function WidgetShell({ label, widgetKey, arrange, visible, onToggle, children, style, noPad }) {
  return (
    <div
      className={`card widget-shell ${arrange ? 'widget-shell--arrange' : ''} ${!visible[widgetKey] ? 'widget-shell--hidden' : ''}`}
      style={{ padding: noPad ? 0 : undefined, overflow: noPad ? 'hidden' : undefined, ...style }}
    >
      {label && <div className="card-title">{label}</div>}
      {children}
      {arrange && (
        <button
          className={`widget-toggle-btn ${visible[widgetKey] ? 'widget-toggle-btn--on' : ''}`}
          onClick={() => onToggle(widgetKey)}
          aria-label={visible[widgetKey] ? 'Hide widget' : 'Show widget'}
        >
          {visible[widgetKey] ? '● VISIBLE' : '○ HIDDEN'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Briefing Modal
// ---------------------------------------------------------------------------
function BriefingModal({ type, token, existing, onClose, onSaved }) {
  const isMorning = type === 'morning'
  const [time, setTime] = useState(existing?.time || (isMorning ? '07:00' : '20:00'))
  const [busy, setBusy] = useState(false)
  const [checks, setChecks] = useState(() => {
    if (isMorning) {
      return { weather: true, calendar: true, email: true, news: false, reminders: false }
    } else {
      return { highlights: true, tomorrow: true, reminders: false, inventory: false }
    }
  })

  const toggle = (k) => setChecks(prev => ({ ...prev, [k]: !prev[k] }))

  const handleSave = async () => {
    setBusy(true)
    const name = isMorning ? "Morning Briefing" : "Evening Summary"
    
    let prompt = isMorning 
      ? "Give me my morning briefing. Include: "
      : "Give me my evening summary. Include: "

    if (isMorning) {
      const parts = []
      if (checks.weather) parts.push("today's weather forecast")
      if (checks.calendar) parts.push("my calendar events for today")
      if (checks.email) parts.push("unread emails summary")
      if (checks.news) parts.push("top news headlines")
      if (checks.reminders) parts.push("reminder check")
      prompt += parts.join(", ") + ". Keep it warm and concise."
    } else {
      const parts = []
      if (checks.highlights) parts.push("highlights from today")
      if (checks.tomorrow) parts.push("tomorrow's calendar preview")
      if (checks.reminders) parts.push("any pending reminders")
      if (checks.inventory) parts.push("inventory/shopping notes")
      prompt += parts.join(", ") + ". Keep it reflective and warm."
    }

    const payload = {
      name,
      trigger: "daily",
      time,
      days: ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"],
      enabled: true,
      prompt
    }

    try {
      const method = existing ? 'PATCH' : 'POST'
      const url = existing ? `/api/routines/${existing.id}` : '/api/routines'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        onSaved(`✓ ${name} set for ${time}`)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="briefing-modal-overlay" onClick={onClose}>
      <div className="card briefing-modal" onClick={e => e.stopPropagation()}>
        <div className="card-title">{isMorning ? '☀ MORNING BRIEFING' : '🌙 EVENING SUMMARY'}</div>
        
        <div className="briefing-time-row">
          <label>What time?</label>
          <input 
            type="time" 
            className="briefing-time-input" 
            value={time} 
            onChange={e => setTime(e.target.value)} 
          />
        </div>

        <div className="briefing-checks">
          {isMorning ? (
            <>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.weather} onChange={() => toggle('weather')} /> Weather</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.calendar} onChange={() => toggle('calendar')} /> Calendar</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.email} onChange={() => toggle('email')} /> Emails</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.news} onChange={() => toggle('news')} /> News</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.reminders} onChange={() => toggle('reminders')} /> Reminders</label>
            </>
          ) : (
            <>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.highlights} onChange={() => toggle('highlights')} /> Highlights</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.tomorrow} onChange={() => toggle('tomorrow')} /> Tomorrow</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.reminders} onChange={() => toggle('reminders')} /> Reminders</label>
              <label className="briefing-check-label"><input type="checkbox" checked={checks.inventory} onChange={() => toggle('inventory')} /> Shopping</label>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn--primary" onClick={handleSave} disabled={busy}>
            {busy ? 'SAVING...' : existing ? 'UPDATE BRIEFING' : 'CREATE BRIEFING'}
          </button>
          <button className="btn" onClick={onClose}>CANCEL</button>
        </div>
      </div>
    </div>
  )
}
