import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

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
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-card-label">INTEGRATIONS / GOOGLE</div>
        <h1 className="rs-greeting">Google</h1>
        <div className="rs-greeting-sub">
          Connect your Google account to bring Calendar, Gmail, Maps, and Music into conversation.
        </div>
      </header>

      {error && (
        <div className="rs-card" style={{ 
          background: 'var(--md-error-container)', 
          color: 'var(--md-on-error-container)',
          marginBottom: 24,
          borderLeft: '4px solid var(--md-error)'
        }}>
          {error}
        </div>
      )}

      <div className="rs-card-flow">
        
        {/* Status Card */}
        <div className="rs-card is-wide" style={{ 
          backdropFilter: 'var(--glass-blur)',
          border: status.connected ? '1px solid var(--md-tertiary)' : undefined,
          background: status.connected ? 'color-mix(in srgb, var(--md-tertiary) 5%, var(--rs-card-bg))' : undefined
        }}>
          <div className="rs-card-head">
             <span className="rs-card-label">CONNECTION STATUS</span>
             {status.connected && <span className="rs-card-label" style={{ color: 'var(--md-tertiary)' }}>ACTIVE</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="rs-status-dot" style={{ background: status.loading ? 'var(--text-muted)' : (status.connected ? 'var(--md-tertiary)' : 'var(--md-outline)') }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 500, letterSpacing: '0.05em' }}>
                   {status.loading ? 'CHECKING CONNECTION...' : (status.connected ? `CONNECTED AS ${status.email?.toUpperCase() || 'GOOGLE USER'}` : 'NOT CONNECTED')}
                </span>
             </div>
             <button 
               className={status.connected ? 'rs-pill' : 'rs-btn-primary'} 
               onClick={handleConnect}
               disabled={status.loading}
             >
                {status.connected ? 'RECONNECT' : 'CONNECT GOOGLE ACCOUNT'}
             </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, width: '100%' }}>
           {/* Calendar Preview */}
           <div className="rs-card" style={{ 
             opacity: !status.connected ? 0.6 : 1, 
             backdropFilter: 'var(--glass-blur)',
             display: 'flex',
             flexDirection: 'column'
           }}>
              <div className="rs-card-head">
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconCalendar />
                    <span className="rs-card-label">UPCOMING EVENTS</span>
                 </div>
              </div>
              <div style={{ flex: 1 }}>
                {status.connected ? (
                  calendar.loading ? <div className="rs-card-meta">Loading events...</div> :
                  calendar.events.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {calendar.events.slice(0, 3).map(ev => (
                        <div key={ev.id} className="rs-card" style={{ padding: '10px 12px', background: 'var(--md-surface-container-high)', border: 'none' }}>
                          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--md-tertiary)', marginBottom: 2 }}>
                            {ev.start.dateTime ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day'}
                          </div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{ev.summary}</div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="rs-card-meta">No upcoming events.</div>
                ) : <div className="rs-card-meta">Connect account to see events</div>}
              </div>
           </div>

           {/* Gmail Preview */}
           <div className="rs-card" style={{ 
             opacity: !status.connected ? 0.6 : 1, 
             backdropFilter: 'var(--glass-blur)',
             display: 'flex',
             flexDirection: 'column'
           }}>
              <div className="rs-card-head">
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconMail />
                    <span className="rs-card-label">UNREAD MESSAGES</span>
                 </div>
              </div>
              <div style={{ flex: 1 }}>
                {status.connected ? (
                  gmail.loading ? <div className="rs-card-meta">Loading messages...</div> :
                  gmail.messages.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {gmail.messages.slice(0, 3).map(msg => (
                        <div key={msg.id} className="rs-card" style={{ padding: '10px 12px', background: 'var(--md-surface-container-high)', border: 'none' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--md-secondary)', marginBottom: 2 }}>{msg.from.split('<')[0].trim()}</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.subject}</div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="rs-card-meta">No unread messages.</div>
                ) : <div className="rs-card-meta">Connect account to see emails</div>}
              </div>
           </div>
        </div>

        {/* Features Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, width: '100%', marginTop: 24 }}>
          {GOOGLE_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
            <div key={key} className="rs-card" style={{ 
              opacity: !status.connected ? 0.6 : 1,
              backdropFilter: 'var(--glass-blur-sm)',
              borderRadius: 'var(--md-shape-xl)'
            }}>
              <div className="rs-card-head">
                 <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ color: 'var(--md-primary)' }}><Icon /></div>
                    <span className="rs-card-label">{title}</span>
                 </div>
                 {status.connected && <span className="rs-pill" style={{ fontSize: '0.6rem', background: 'var(--md-tertiary-container)', color: 'var(--md-on-tertiary-container)' }}>ACTIVE</span>}
              </div>
              <p className="rs-card-meta" style={{ fontSize: '0.9rem', color: 'inherit', opacity: 0.8, margin: '12px 0' }}>{desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tags.map(t => <span key={t} className="rs-pill" style={{ fontSize: '0.65rem', opacity: 0.7 }}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>

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
