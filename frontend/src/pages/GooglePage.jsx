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
    key: 'books',
    icon: IconBooks,
    title: 'GOOGLE BOOKS',
    desc: 'Browse your reading library, search for new titles, and track your reading progress across all your devices.',
    tags: ['Library sync', 'Progress tracking', 'Book search'],
  },
  {
    key: 'tasks',
    icon: IconTasks,
    title: 'GOOGLE TASKS',
    desc: 'Stay on top of your to-do list. Create, view, and complete tasks directly through River Song.',
    tags: ['Task lists', 'Quick add', 'Voice management'],
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
  // Q2#8 — Gmail triage. When `available` is null we haven't probed yet;
  // a 404 from the route sets `available=false` and hides the button.
  const [triage, setTriage] = useState({ messages: [], loading: false, available: null, error: '' })
  const [books, setBooks] = useState({ library: [], loading: false })
  const [tasks, setTasks] = useState({ list: [], loading: false })
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
    setBooks(prev => ({ ...prev, loading: true }))
    setTasks(prev => ({ ...prev, loading: true }))

    // Calendar
    fetch(`${API_BASE}/calendar/upcoming`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => setCalendar({ events: data.events || [], loading: false }))
      .catch(err => {
        console.error('Failed to load Calendar:', err)
        setCalendar(prev => ({ ...prev, loading: false }))
      })

    // Gmail
    fetch(`${API_BASE}/gmail/unread`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => setGmail({ messages: data.messages || [], loading: false }))
      .catch(err => {
        console.error('Failed to load Gmail:', err)
        setGmail(prev => ({ ...prev, loading: false }))
      })

    // Google Books
    fetch(`${API_BASE}/books/library`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => setBooks({ library: data.library || [], loading: false }))
      .catch(err => {
        console.error('Failed to load Google Books:', err)
        setBooks(prev => ({ ...prev, loading: false }))
      })

    // Google Tasks
    fetch(`${API_BASE}/tasks`, { headers: authHeaders() })
      .then(res => res.json())
      .then(data => setTasks({ list: data.tasks || [], loading: false }))
      .catch(err => {
        console.error('Failed to load Google Tasks:', err)
        setTasks(prev => ({ ...prev, loading: false }))
      })
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

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your Google account? This will remove access to Calendar, Gmail, and other services.')) {
      return
    }

    try {
      const res = await fetch(`${API_BASE}/auth`, {
        method: 'DELETE',
        headers: authHeaders()
      })
      if (res.ok) {
        setStatus({ connected: false, loading: false })
        setCalendar({ events: [], loading: false })
        setGmail({ messages: [], loading: false })
        setBooks({ library: [], loading: false })
        setTasks({ list: [], loading: false })
      } else {
        throw new Error('Failed to disconnect')
      }
    } catch (err) {
      setError('Failed to disconnect Google account.')
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
             <div style={{ display: 'flex', gap: 12 }}>
                {status.connected && (
                  <button className="rs-pill" onClick={handleDisconnect} style={{ color: 'var(--md-error)' }}>
                    DISCONNECT
                  </button>
                )}
                <button 
                  className={status.connected ? 'rs-pill' : 'rs-btn-primary'} 
                  onClick={handleConnect}
                  disabled={status.loading}
                >
                    {status.connected ? 'RECONNECT' : 'CONNECT GOOGLE ACCOUNT'}
                </button>
             </div>
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
              <div className="rs-card-head" style={{ justifyContent: 'space-between' }}>
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconMail />
                    <span className="rs-card-label">UNREAD MESSAGES</span>
                 </div>
                 {status.connected && triage.available !== false && (
                   <button
                     className="rs-pill"
                     disabled={triage.loading}
                     onClick={async () => {
                       setTriage(t => ({ ...t, loading: true, error: '' }))
                       try {
                         const res = await fetch(`${API_BASE}/gmail/triage?max_results=10`, { headers: authHeaders() })
                         if (res.status === 404) { setTriage({ messages: [], loading: false, available: false, error: '' }); return }
                         if (!res.ok) throw new Error('Triage failed.')
                         const data = await res.json()
                         setTriage({ messages: data.messages || [], loading: false, available: true, error: '' })
                       } catch (e) {
                         setTriage(t => ({ ...t, loading: false, error: e.message }))
                       }
                     }}
                     style={{ fontSize: '0.65rem' }}
                   >
                     {triage.loading ? 'TRIAGING…' : 'TRIAGE'}
                   </button>
                 )}
              </div>
              <div style={{ flex: 1 }}>
                {status.connected ? (
                  triage.messages.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {triage.messages.slice(0, 5).map(msg => {
                        const t = msg.triage || {}
                        const urgencyColor = t.urgency === 'high' ? 'var(--md-error)' : t.urgency === 'low' ? 'var(--md-on-surface-variant)' : 'var(--md-secondary)'
                        return (
                          <div key={msg.id} className="rs-card" style={{ padding: '10px 12px', background: 'var(--md-surface-container-high)', border: 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span className="rs-pill" style={{ fontSize: '0.55rem', padding: '1px 7px', background: urgencyColor, color: 'var(--bg-base)' }}>
                                {(t.urgency || 'med').toUpperCase()}
                              </span>
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--md-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {(msg.from || '').split('<')[0].trim()}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.subject}</div>
                            {t.summary && <div style={{ fontSize: '0.72rem', opacity: 0.7, marginTop: 4, lineHeight: 1.35 }}>{t.summary}</div>}
                            {(t.tags || []).length > 0 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                {t.tags.slice(0, 4).map((tag, i) => (
                                  <span key={i} className="rs-pill" style={{ fontSize: '0.55rem', padding: '1px 6px', opacity: 0.7 }}>{tag}</span>
                                ))}
                              </div>
                            )}
                            {t.draft_reply && (
                              <details style={{ marginTop: 8 }}>
                                <summary style={{ fontSize: '0.7rem', fontWeight: 700, opacity: 0.8, cursor: 'pointer' }}>DRAFT REPLY</summary>
                                <div style={{ fontSize: '0.78rem', marginTop: 4, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 6, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{t.draft_reply}</div>
                              </details>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) :
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
                {triage.error && <div style={{ color: 'var(--md-error)', fontSize: '0.7rem', marginTop: 6 }}>{triage.error}</div>}
              </div>
           </div>

           {/* Google Books Preview */}
           <div className="rs-card" style={{ 
             opacity: !status.connected ? 0.6 : 1, 
             backdropFilter: 'var(--glass-blur)',
             display: 'flex',
             flexDirection: 'column'
           }}>
              <div className="rs-card-head">
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconBooks />
                    <span className="rs-card-label">READING LIBRARY</span>
                 </div>
              </div>
              <div style={{ flex: 1 }}>
                {status.connected ? (
                  books.loading ? <div className="rs-card-meta">Loading library...</div> :
                  books.library.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {books.library.slice(0, 3).map(b => (
                        <div key={b.volume_id} className="rs-card" style={{ padding: '10px 12px', background: 'var(--md-surface-container-high)', border: 'none', display: 'flex', gap: 12 }}>
                          {b.cover_url && (
                            <img src={b.cover_url} alt={b.title} style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {b.authors.join(', ')}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '1px 6px' }}>
                                {b.status === 'reading' ? 'READING' : b.status === 'finished' ? 'FINISHED' : 'WANT TO READ'}
                              </span>
                              {b.status === 'reading' && (
                                <span style={{ fontSize: '0.65rem', color: 'var(--md-tertiary)', fontWeight: 600 }}>{Math.round(b.progress_pct)}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <div className="rs-card-meta">No books found.</div>
                ) : <div className="rs-card-meta">Connect account to see library</div>}
              </div>
           </div>

           {/* Google Tasks Preview */}
           <div className="rs-card" style={{ 
             opacity: !status.connected ? 0.6 : 1, 
             backdropFilter: 'var(--glass-blur)',
             display: 'flex',
             flexDirection: 'column'
           }}>
              <div className="rs-card-head">
                 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <IconTasks />
                    <span className="rs-card-label">GOOGLE TASKS</span>
                 </div>
              </div>
              <div style={{ flex: 1 }}>
                {status.connected ? (
                  tasks.loading ? <div className="rs-card-meta">Loading tasks...</div> :
                  tasks.list.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {tasks.list.slice(0, 4).map(t => {
                        const completed = t.status === 'completed'
                        return (
                          <div key={t.id} className="rs-card" style={{ padding: '10px 12px', background: 'var(--md-surface-container-high)', border: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ 
                              width: 14, 
                              height: 14, 
                              borderRadius: '50%', 
                              border: completed ? 'none' : '1.5px solid var(--text-muted)',
                              background: completed ? 'var(--md-tertiary)' : 'transparent',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              {completed && (
                                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                                  <path d="M1.5 4l1.5 1.5 3.5-3.5" stroke="var(--bg-base)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </span>
                            <div style={{ 
                              fontSize: '0.85rem', 
                              fontWeight: 500,
                              textDecoration: completed ? 'line-through' : 'none',
                              opacity: completed ? 0.5 : 1,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              flex: 1
                            }}>
                              {t.title}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : <div className="rs-card-meta">No tasks found.</div>
                ) : <div className="rs-card-meta">Connect account to see tasks</div>}
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

function IconBooks() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 4h12v12H4z" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 4v12M10 4v12M13 4v12" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconTasks() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
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
