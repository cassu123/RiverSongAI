import React, { useState, useEffect, useCallback } from 'react'
import RiverStatusBox from '../components/RiverStatusBox.jsx'
import './DashboardPage.css'

// ---------------------------------------------------------------------------
// Widget registry — defines every available tile
// ---------------------------------------------------------------------------
const ALL_WIDGETS = [
  { key: 'system_status',   label: 'System Status',   col: 'left',  adminOnly: true },
  { key: 'recent_sessions', label: 'Recent Sessions',  col: 'left'  },
  { key: 'memory_activity', label: 'Memory Activity',  col: 'left'  },
  { key: 'river_status',    label: 'River Status',     col: 'right' },
  { key: 'quick_actions',   label: 'Quick Actions',    col: 'right' },
  { key: 'active_routines', label: 'Active Routines',  col: 'right' },
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

// ---------------------------------------------------------------------------
// Mock recent sessions (no session persistence in backend yet)
// ---------------------------------------------------------------------------
const MOCK_SESSIONS = [
  { time: '14:22', text: 'Log today\'s training session.',       dur: '2m' },
  { time: '11:04', text: 'Reschedule Thursday standup.',         dur: '4m' },
  { time: '09:30', text: 'Morning brief — calendar + weather.',  dur: '6m' },
  { time: 'Tue',   text: 'Deploy garden-watering routine.',      dur: '12m' },
  { time: 'Mon',   text: 'Recipe — miso salmon, dinner for 4.', dur: '3m' },
]

const MOCK_ROUTINES = [
  { name: 'Morning Brief', sched: '06:30 daily', on: true },
  { name: 'Garden Water',  sched: 'Tue/Thu/Sat', on: true },
  { name: 'Away Mode',     sched: 'auto',         on: false },
]

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
// Bar chart heights (last 30 days relative activity)
// ---------------------------------------------------------------------------
const BAR_HEIGHTS = [22,18,30,14,26,20,35,18,28,22,38,24,30,16,
                     32,22,36,28,40,24,34,28,42,30,38,32,44,36,46,48]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function DashboardPage({ onNavigate, isAdmin = false }) {
  const [time,       setTime]       = useState(fmtDate())
  const [arrange,    setArrange]    = useState(false)
  const [visible,    setVisible]    = useState(loadWidgets)
  const [stats,      setStats]      = useState(null)
  const [loading,    setLoading]    = useState(true)

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTime(fmtDate()), 30000)
    return () => clearInterval(id)
  }, [])

  // Live data fetch
  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard')
      if (!res.ok) throw new Error(res.status)
      const data = await res.json()
      setStats(data)
    } catch {
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    const id = setInterval(fetchStats, 30000)
    return () => clearInterval(id)
  }, [fetchStats])

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

  const show = (key) => !arrange || visible[key]  // in arrange mode show all for toggling

  // Derived status values
  const statusOk  = !stats || stats.status === 'operational'
  const latency   = stats ? `${stats.latency_ms}ms` : '—'
  const uptime    = stats ? stats.uptime : '—'
  const factCount = stats ? stats.memory.facts.toLocaleString() : '—'
  const sumCount  = stats ? stats.memory.summaries : '—'

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
          <h1 className="page-title">{greeting()}, Charlie.</h1>
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

          {/* System Status — admin only */}
          {isAdmin && visible['system_status'] && (
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
          {visible['recent_sessions'] && (
            <WidgetShell
              label="RECENT SESSIONS"
              widgetKey="recent_sessions"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              style={{ flex: 1 }}
            >
              <div className="session-list">
                {MOCK_SESSIONS.map((s, i) => (
                  <div className="session-row" key={i}>
                    <span className="session-time">{s.time}</span>
                    <span className="session-text">{s.text}</span>
                    <span className="session-dur">{s.dur}</span>
                  </div>
                ))}
              </div>
            </WidgetShell>
          )}

          {/* Memory Activity */}
          {visible['memory_activity'] && (
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
                {BAR_HEIGHTS.map((h, i) => (
                  <div key={i} className="mem-bar" style={{ height: `${h}px` }} />
                ))}
              </div>
            </WidgetShell>
          )}
        </div>

        <div className="dashboard-right">

          {/* River Status */}
          {visible['river_status'] && (
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
          {visible['quick_actions'] && (
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
                <button className="qa-btn" onClick={() => onNavigate('routines')}>
                  <span className="qa-dot" style={{ background: 'var(--text-dim)' }} />NEW ROUTINE
                </button>
                <button className="qa-btn" onClick={() => onNavigate('home')}>
                  <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />HOME SCENE
                </button>
                <button className="qa-btn">
                  <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />LOG EVENT
                </button>
              </div>
            </WidgetShell>
          )}

          {/* Active Routines */}
          {visible['active_routines'] && (
            <WidgetShell
              label="ACTIVE ROUTINES"
              widgetKey="active_routines"
              arrange={arrange}
              visible={visible}
              onToggle={toggleWidget}
              style={{ flex: 1 }}
            >
              {MOCK_ROUTINES.map((r, i) => (
                <div className="routine-row" key={i}>
                  <span className={`dot ${r.on ? 'dot--on' : 'dot--off'}`} />
                  <span className="routine-name">{r.name}</span>
                  <span className="routine-sched">{r.sched}</span>
                </div>
              ))}
            </WidgetShell>
          )}
        </div>
      </div>
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
