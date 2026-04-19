import React, { useState, useEffect } from 'react'

const RECENT_SESSIONS = [
  { time: '14:22', text: 'Log today\'s training session.',          dur: '2m' },
  { time: '11:04', text: 'Reschedule Thursday standup.',           dur: '4m' },
  { time: '09:30', text: 'Morning brief — calendar + weather.',    dur: '6m' },
  { time: 'Tue',   text: 'Deploy garden-watering routine.',        dur: '12m' },
  { time: 'Mon',   text: 'Recipe — miso salmon, dinner for 4.',   dur: '3m' },
]

const ACTIVE_ROUTINES = [
  { name: 'Morning Brief', sched: '06:30 daily', on: true },
  { name: 'Garden Water',  sched: 'Tue/Thu/Sat', on: true },
  { name: 'Away Mode',     sched: 'auto',         on: false },
]

const BAR_HEIGHTS = [22, 18, 30, 14, 26, 20, 35, 18, 28, 22, 38, 24, 30, 16,
                     32, 22, 36, 28, 40, 24, 34, 28, 42, 30, 38, 32, 44, 36, 46, 48]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function DashboardPage({ onNavigate }) {
  const [time, setTime] = useState(fmtDate())
  useEffect(() => {
    const id = setInterval(() => setTime(fmtDate()), 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="page-wrap" style={{ overflow: 'auto', height: '100%' }}>
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span>
            <span>COMMAND</span>
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
          <button className="btn">⊞ ARRANGE</button>
          <button className="btn">RESET</button>
          <button className="btn btn--cta" onClick={() => onNavigate('speak')}>
            ▸ SPEAK TO RIVER
          </button>
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="dashboard">
        {/* LEFT COLUMN */}
        <div className="dashboard-left">

          {/* System status */}
          <div>
            <div className="card-title">SYSTEM STATUS</div>
            <div className="status-grid">
              <div className="status-cell">
                <div className="status-cell-label">OPS</div>
                <div className="status-cell-value status-cell-value--ok status-cell-value--nominal">
                  <span className="dot dot--on" />
                  NOMINAL
                </div>
              </div>
              <div className="status-cell">
                <div className="status-cell-label">LATENCY</div>
                <div className="status-cell-value">42ms</div>
              </div>
              <div className="status-cell">
                <div className="status-cell-label">MEM</div>
                <div className="status-cell-value">18.4 GB</div>
              </div>
              <div className="status-cell">
                <div className="status-cell-label">UPTIME</div>
                <div className="status-cell-value">142d</div>
              </div>
            </div>
          </div>

          {/* Recent sessions */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">RECENT SESSIONS</div>
            <div className="session-list">
              {RECENT_SESSIONS.map((s, i) => (
                <div className="session-row" key={i}>
                  <span className="session-time">{s.time}</span>
                  <span className="session-text">{s.text}</span>
                  <span className="session-dur">{s.dur}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Memory activity */}
          <div className="card">
            <div className="card-title">MEMORY ACTIVITY</div>
            <div className="memory-stats">
              <div className="mem-stat">
                <span className="mem-stat-val">14,218</span>
                <span className="mem-stat-label">FACTS</span>
              </div>
              <div className="mem-stat">
                <span className="mem-stat-val">342</span>
                <span className="mem-stat-label">SUMMARIES</span>
              </div>
              <div className="mem-stat">
                <span className="mem-stat-val mem-stat-val--today">+24 today</span>
                <span className="mem-stat-label">&nbsp;</span>
              </div>
            </div>
            <div className="mem-bar-chart">
              {BAR_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  className="mem-bar"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="dashboard-right">

          {/* River portrait */}
          <div className="river-panel">
            <img
              src="/river_standby.png"
              alt="River Song"
              className="river-panel-img"
              onError={e => { e.target.style.display = 'none' }}
            />
            <div className="river-panel-footer">
              <div className="river-status">
                <span className="dot dot--standby" />
                STANDBY
              </div>
              <span className="river-tap">TAP TO SPEAK</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="card">
            <div className="card-title">QUICK ACTIONS</div>
            <div className="quick-actions">
              <button className="qa-btn" onClick={() => onNavigate('speak')}>
                <span className="qa-dot" />
                LISTEN
              </button>
              <button className="qa-btn" onClick={() => onNavigate('routines')}>
                <span className="qa-dot" style={{ background: 'var(--text-dim)' }} />
                NEW ROUTINE
              </button>
              <button className="qa-btn" onClick={() => onNavigate('home')}>
                <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />
                HOME SCENE
              </button>
              <button className="qa-btn">
                <span className="qa-dot" style={{ background: 'var(--text-muted)' }} />
                LOG EVENT
              </button>
            </div>
          </div>

          {/* Active routines */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">ACTIVE ROUTINES</div>
            {ACTIVE_ROUTINES.map((r, i) => (
              <div className="routine-row" key={i}>
                <span className={`dot ${r.on ? 'dot--on' : 'dot--off'}`} />
                <span className="routine-name">{r.name}</span>
                <span className="routine-sched">{r.sched}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
