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

export default function BriefingPage({ onNavigate }) {
  const { user, token } = useAuth()
  const [weather, setWeather] = useState(null)
  const [calendar, setCalendar] = useState([])
  const [summary, setSummary] = useState('No briefing for today yet. Ask River to summarize your day.')
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const sRes = await fetch('/api/conversation/summary', { headers: { Authorization: `Bearer ${token}` } })
      if (sRes.ok) {
        const data = await sRes.json()
        if (data.summary) setSummary(data.summary)
      }
    } catch (e) {
      console.error('Fetch failed', e)
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
            <span className="rs-card-label">DAILY SUMMARY</span>
            <span className="material-symbols-rounded" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>auto_stories</span>
          </div>
          <div style={{ lineHeight: 1.6, fontSize: '1rem', color: 'rgba(255,255,255,0.9)' }}>
            <RsMarkdown onNavigate={onNavigate}>{summary}</RsMarkdown>
          </div>
          <div className="rs-card-meta" style={{ marginTop: 12 }}>
            Generated from your recent interactions and schedules.
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
