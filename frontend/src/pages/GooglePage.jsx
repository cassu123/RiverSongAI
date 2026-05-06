import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './GooglePage.css'

const API_BASE = '/api/google'

function authHeaders() {
  const token = localStorage.getItem('rs-auth-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const GOOGLE_FEATURES = [
  {
    key: 'calendar',
    icon: IconCalendar,
    title: 'CALENDAR',
    desc: 'Ask River what\'s on your schedule, add events by voice, or get a daily agenda briefing each morning.',
    tags: ['Google Calendar', 'Event creation', 'Daily briefing'],
  },
  {
    key: 'gmail',
    icon: IconMail,
    title: 'GMAIL',
    desc: 'Hear unread email summaries, draft replies by voice, and have River flag important messages.',
    tags: ['Inbox summary', 'Voice drafting', 'Priority filters'],
  },
  {
    key: 'maps',
    icon: IconMaps,
    title: 'MAPS & NAVIGATION',
    desc: 'Get travel time estimates, find nearby places, and ask River for directions conversationally.',
    tags: ['Travel time', 'Place search', 'Route info'],
  },
  {
    key: 'music',
    icon: IconMusic,
    title: 'YOUTUBE MUSIC',
    desc: 'Control music playback by voice — play an artist, queue an album, skip tracks, or ask what\'s playing.',
    tags: ['Voice playback', 'Queue control', 'Artist / album search'],
  },
]

export default function GooglePage() {
  const { token } = useAuth()
  const [status, setStatus] = useState({ connected: false, loading: true })
  const [calendar, setCalendar] = useState({ events: [], loading: false })
  const [gmail, setGmail] = useState({ messages: [], loading: false })
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`, { headers: authHeaders() })
      const data = await res.json()
      setStatus({ ...data, loading: false })
      if (data.connected) {
        loadData()
      }
    } catch (err) {
      setStatus({ connected: false, loading: false })
    }
  }, [])

  const loadData = async () => {
    setCalendar(prev => ({ ...prev, loading: true }))
    setGmail(prev => ({ ...prev, loading: true }))

    try {
      const [calRes, mailRes] = await Promise.all([
        fetch(`${API_BASE}/calendar/upcoming`, { headers: authHeaders() }),
        fetch(`${API_BASE}/gmail/unread`, { headers: authHeaders() })
      ])
      const calData = await calRes.json()
      const mailData = await mailRes.json()

      setCalendar({ events: calData.events || [], loading: false })
      setGmail({ messages: mailData.messages || [], loading: false })
    } catch (err) {
      console.error('Failed to load Google data:', err)
      setCalendar(prev => ({ ...prev, loading: false }))
      setGmail(prev => ({ ...prev, loading: false }))
    }
  }

  useEffect(() => {
    loadStatus()
    // Check for error in URL
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      setError(params.get('error'))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadStatus])

  const handleConnect = async () => {
    try {
      const redirectUri = `${window.location.origin}/api/google/auth/callback`
      const res = await fetch(`${API_BASE}/auth/url?redirect_uri=${encodeURIComponent(redirectUri)}`, {
        headers: authHeaders()
      })
      const { auth_url } = await res.json()
      window.location.href = auth_url
    } catch (err) {
      setError('Failed to initiate Google connection.')
    }
  }

  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>INTEGRATIONS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>GOOGLE</span>
      </div>
      <h1 className="page-title">Google</h1>
      <p className="page-subtitle">
        Connect your Google account to bring Calendar, Gmail, Maps, and Music into conversation.
      </p>

      {error && <div className="google-error-banner">{error}</div>}

      <div className="google-status-section">
        {status.loading ? (
          <div className="google-status-card google-status-card--loading">CHECKING CONNECTION...</div>
        ) : status.connected ? (
          <div className="google-status-card google-status-card--connected">
            <div className="google-status-info">
              <div className="google-status-dot" />
              <div className="google-status-text">CONNECTED AS {status.email || 'GOOGLE USER'}</div>
            </div>
            <button className="google-btn google-btn--outline" onClick={handleConnect}>RECONNECT</button>
          </div>
        ) : (
          <div className="google-status-card google-status-card--disconnected">
            <div className="google-status-text">NOT CONNECTED</div>
            <button className="google-btn google-btn--primary" onClick={handleConnect}>CONNECT GOOGLE ACCOUNT</button>
          </div>
        )}
      </div>

      <div className="google-data-grid">
        {/* Calendar Preview */}
        <div className={`google-data-card ${!status.connected ? 'google-data-card--locked' : ''}`}>
          <div className="google-data-header">
            <IconCalendar />
            <h3>UPCOMING EVENTS</h3>
          </div>
          {status.connected ? (
            calendar.loading ? <div className="google-data-loading">Loading events...</div> :
            calendar.events.length > 0 ? (
              <div className="google-event-list">
                {calendar.events.slice(0, 3).map(ev => (
                  <div key={ev.id} className="google-event-item">
                    <div className="google-event-time">
                      {ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day'}
                    </div>
                    <div className="google-event-title">{ev.summary}</div>
                  </div>
                ))}
              </div>
            ) : <div className="google-data-empty">No upcoming events.</div>
          ) : <div className="google-data-locked-msg">Connect account to see events</div>}
        </div>

        {/* Gmail Preview */}
        <div className={`google-data-card ${!status.connected ? 'google-data-card--locked' : ''}`}>
          <div className="google-data-header">
            <IconMail />
            <h3>UNREAD MESSAGES</h3>
          </div>
          {status.connected ? (
            gmail.loading ? <div className="google-data-loading">Loading messages...</div> :
            gmail.messages.length > 0 ? (
              <div className="google-mail-list">
                {gmail.messages.slice(0, 3).map(msg => (
                  <div key={msg.id} className="google-mail-item">
                    <div className="google-mail-from">{msg.from.split('<')[0].trim()}</div>
                    <div className="google-mail-subj">{msg.subject}</div>
                  </div>
                ))}
              </div>
            ) : <div className="google-data-empty">No unread messages.</div>
          ) : <div className="google-data-locked-msg">Connect account to see emails</div>}
        </div>
      </div>

      <div className="feature-card-grid" style={{ marginTop: '2rem' }}>
        {GOOGLE_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
          <div key={key} className={`feature-card ${!status.connected ? 'feature-card--locked' : ''}`}>
            <div className="feature-card-header">
              <div className="feature-card-icon"><Icon /></div>
              <div className="feature-card-title">{title}</div>
              {status.connected && <div className="feature-card-badge feature-card-badge--active">ACTIVE</div>}
            </div>
            <p className="feature-card-desc">{desc}</p>
            <div className="feature-card-tags">
              {tags.map(t => <span key={t} className="feature-tag">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="6" y1="2" x2="6" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="14" y1="2" x2="14" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="9" x2="18" y2="9" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="6" y="12" width="3" height="3" rx="0.5" fill="currentColor"/>
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="2,5 10,11 18,5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}

function IconMaps() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2a5 5 0 0 1 5 5c0 4-5 11-5 11S5 11 5 7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="10" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconMusic() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="6" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="14" cy="13" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="8.5,15 8.5,5 16.5,3 16.5,13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}
