import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import PulseWidget from '../components/PulseWidget.jsx'
import RsMarkdown from '../components/RsMarkdown.jsx'

/**
 * BriefingPage — Daily Briefing
 * -----------------------------------------------------------------------------
 * A focused hub for the user's daily information: weather, calendar, 
 * news, market pulse, and system notifications.
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

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4).replace(/^\s*\n/, '')
}

function openDailyInChronos(virtualPath) {
  if (!virtualPath) return
  const parts = virtualPath.split('/')
  const root = parts.shift()
  const title = parts.join('/').replace(/\.md$/, '')
  try {
    localStorage.setItem('rs-chronos-open', JSON.stringify({ title, root }))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }))
  } catch {}
}

export default function BriefingPage({ onNavigate }) {
  const { user, token } = useAuth()
  const EMPTY_HINT = 'No entries yet today. Once you chat with River or save notes, they\'ll show up in your daily [[Daily/' + new Date().toISOString().slice(0, 10) + ']] log.'
  const [weather, setWeather] = useState(null)
  const [calendar, setCalendar] = useState([])
  const [summary, setSummary] = useState(EMPTY_HINT)
  const [dailyPath, setDailyPath] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/daily/today', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDailyPath(data.virtual_path)
        const body = stripFrontmatter(data.content || '')
        if (body.trim()) setSummary(body)
      }
    } catch (e) {
      console.error('Daily note fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const firstName = user?.display_name?.split(' ')[0] || 'Operator'

  return (
    <div className="rs-foyer animate-fade-in">
      
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting()}, {firstName}.</h1>
        <div className="rs-greeting-sub">Your daily briefing is ready. {fmtDate()}.</div>
      </header>

      <div className="rs-card-flow">

        {/* Daily Summary */}
        <div className="rs-card is-elev is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">DAILY LOG</span>
            <button
              className="rs-pill"
              onClick={() => openDailyInChronos(dailyPath)}
              disabled={!dailyPath}
              title="Open today's daily note in CHRONOS"
              style={{ fontSize: '0.65rem', padding: '4px 10px' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 4 }}>auto_stories</span>
              OPEN IN CHRONOS
            </button>
          </div>
          <div style={{ lineHeight: 1.6, fontSize: '1rem', color: 'rgba(255,255,255,0.9)' }}>
            <RsMarkdown onNavigate={onNavigate}>{summary}</RsMarkdown>
          </div>
          <div className="rs-card-meta" style={{ marginTop: 12 }}>
            Compiled from conversation summaries and your CHRONOS daily note.
          </div>
        </div>

        {/* Market & News Pulse */}
        <div className="rs-card is-tappable is-wide" onClick={() => onNavigate('feeds')}>
          <div className="rs-card-head">
            <span className="rs-card-label">MARKET & NEWS PULSE</span>
            <span className="material-symbols-rounded rs-card-chevron">chevron_right</span>
          </div>
          <PulseWidget token={token} />
        </div>

        {/* Weather & Environment (Simplified for Briefing) */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">WEATHER</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '3rem', color: 'var(--primary)' }}>wb_sunny</span>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 600 }}>72°F</div>
              <div className="rs-card-meta">Clear Skies · NY</div>
            </div>
          </div>
        </div>

        {/* Schedule / Tasks */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">UPCOMING</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="rs-pill" style={{ justifyContent: 'flex-start', background: 'var(--md-surface-container-high)' }}>
               <span style={{ opacity: 0.5, marginRight: 12 }}>09:00</span>
               <span>Team Sync</span>
            </div>
            <div className="rs-pill" style={{ justifyContent: 'flex-start' }}>
               <span style={{ opacity: 0.5, marginRight: 12 }}>14:30</span>
               <span>Dentist Appt</span>
            </div>
          </div>
          <button className="rs-btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={() => onNavigate('google')}>
            VIEW FULL CALENDAR
          </button>
        </div>

        {/* Quick Utilities */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">QUICK ACTIONS</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <button className="rs-pill" onClick={() => onNavigate('chat')}>NEW CHAT</button>
            <button className="rs-pill" onClick={() => onNavigate('chronos')}>NOTES</button>
            <button className="rs-pill" onClick={() => onNavigate('inventory')}>STASH</button>
            <button className="rs-pill" onClick={() => onNavigate('culinary')}>KITCHEN</button>
          </div>
        </div>

      </div>
    </div>
  )
}
