import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@context/AuthContext'
import Sheet, { SheetRow } from '../chrome/Sheet'
import ReadingIntegrationsModal from '@components/ReadingIntegrationsModal'

const API = '/api/reading'

// All possible services with metadata
const ALL_SERVICES = [
  { key: 'kindle', label: 'Kindle', color: '#ff9900', icon: 'auto_stories' },
  { key: 'audible', label: 'Audible', color: '#f58220', icon: 'headphones' },
  { key: 'libby', label: 'Libby', color: '#00aaff', icon: 'local_library' },
  { key: 'google_play', label: 'Google Play', color: '#4285f4', icon: 'play_arrow' },
  { key: 'other', label: 'Other', color: '#8888aa', icon: 'more_horiz' },
]

const ALL_SERVICES_MAP = Object.fromEntries(ALL_SERVICES.map(s => [s.key, s]))

const STATUSES = [
  { key: 'all',          label: 'ALL',          icon: 'filter_list' },
  { key: 'reading',      label: 'ACTIVE',       icon: 'chrome_reader_mode' },
  { key: 'finished',     label: 'FINISHED',     icon: 'verified' },
  { key: 'want_to_read', label: 'QUEUE',        icon: 'bookmark' },
]

function authHeaders() {
  try {
    const token = localStorage.getItem('rs-auth-token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    // Private browsing / Safari ITP / SSR — localStorage can throw.
    return {}
  }
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export default function ReadingPage({ setAction }) {
  const { user, token } = useAuth()
  const userId = user?.id || 'default'

  const [shelf, setShelf] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeStatus, setActiveStatus] = useState('all')
  const [activeService, setActiveService] = useState('all')
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState({ total: 0, reading: 0, queue: 0, dnf: 0, finished: 0 })
  
  const [pickerOpen, setPickerOpen] = useState(false)
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  const [selectedServiceKeys, setSelectedServiceKeys] = useState(() => {
    try { const raw = localStorage.getItem(`rs-reading-services:${userId}`); return raw ? JSON.parse(raw) : [] } catch { return [] }
  })

  const loadShelf = useCallback(() => {
    setLoading(true)
    apiFetch('/shelf').then(setShelf).catch(err => console.warn('[ReadingPage] shelf load failed:', err))
    apiFetch('/stats').then(setStats).catch(err => console.warn('[ReadingPage] stats load failed:', err)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadShelf() }, [loadShelf])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return shelf.filter(b => {
      if (activeStatus !== 'all' && b.status !== activeStatus) return false
      if (activeService !== 'all' && b.service !== activeService) return false
      if (q && !b.title.toLowerCase().includes(q) && !(b.author || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [shelf, activeStatus, activeService, search])

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls rs-w-full">
        <div className="rs-flex rs-gap-3 rs-items-center rs-w-full">
          <div className="rs-chat-input-container rs-grow" style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', background: 'color-mix(in srgb, var(--md-surface-container-low) 60%, transparent)' }}>
            <div className="rs-flex rs-items-center rs-gap-3">
              <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>search</span>
              <input 
                type="text" 
                className="rs-w-full rs-type-small rs-fw-600" style={{ all: 'unset' }} 
                placeholder="SEARCH ARCHIVES..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
              />
            </div>
          </div>
          <div className="rs-flex rs-gap-2">
            {STATUSES.slice(1).map(s => (
               <button key={s.key} className={`rs-pill ${activeStatus === s.key ? 'is-active' : ''}`} onClick={() => setActiveStatus(activeStatus === s.key ? 'all' : s.key)}>
                 <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>{s.icon}</span>
                 <span className="rs-speak-actions-label">{s.label}</span>
               </button>
            ))}
            <button className="rs-pill" onClick={() => setPickerOpen(true)} title="Filter Sources">
               <span className="material-symbols-rounded">tune</span>
            </button>
          </div>
        </div>
      </div>
    )
    return () => setAction(null)
  }, [search, activeStatus, setAction])

  return (
    <div className="rs-foyer">
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">The Library</h1>
        <div className="rs-greeting-sub">Sector archives and digital reading telemetry.</div>
      </header>

      {/* Cockpit Analytics Slate */}
      <div className="rs-card-flow rs-mb-6">
        <div className="rs-card is-wide is-elev">
           <div className="rs-card-inner">
             <div className="rs-flex rs-flex-wrap" style={{ gap: 64 }}>
               <div>
                 <div className="rs-card-label">TOTAL VOLUMES</div>
                 <div className="rs-card-value rs-mono" style={{ fontSize: '2.5rem' }}>{stats.total}</div>
               </div>
               <div>
                 <div className="rs-card-label rs-c-accent">ACTIVE READS</div>
                 <div className="rs-card-value rs-mono rs-c-accent" style={{ fontSize: '2.5rem' }}>{stats.reading}</div>
               </div>
               <div>
                 <div className="rs-card-label" style={{ color: 'var(--warn)' }}>QUEUE DEPTH</div>
                 <div className="rs-card-value rs-mono" style={{ fontSize: '2.5rem', color: 'var(--warn)' }}>{stats.queue}</div>
               </div>
               <div className="rs-grow rs-flex rs-items-center rs-justify-end" style={{ minWidth: 200 }}>
                  <div className="rs-status-strip">
                    <span className="rs-status-dot" style={{ background: '#4ade80' }} />
                    <span>ARCHIVES NOMINAL</span>
                  </div>
               </div>
             </div>
           </div>
        </div>
      </div>

      <div className="rs-card-flow" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))' }}>
        {loading ? (
          <div className="rs-card-meta rs-p-7 rs-text-center" style={{ gridColumn: '1/-1' }}>ACCESSING ARCHIVE SECTOR...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card is-wide rs-text-center" style={{ gridColumn: '1/-1', padding: '64px 24px' }}>
            <span className="material-symbols-rounded rs-mb-4" style={{ fontSize: '3rem', opacity: 0.1 }}>auto_stories</span>
            <div className="rs-card-value">Sector clear</div>
            <div className="rs-card-meta">No records identified with current filters.</div>
          </div>
        ) : (
          filtered.map(book => (
            <div key={book.id} className="rs-card is-tappable animate-page-in rs-clip" style={{ padding: 0 }}>
              <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
                <div className="rs-relative" style={{ aspectRatio: '2/3', background: 'var(--md-surface-container-highest)' }}>
                  {book.cover_url ? (
                    <img src={book.cover_url} alt="" className="rs-w-full rs-h-full" style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="rs-w-full rs-flex rs-items-center rs-justify-center rs-h-full" style={{ opacity: 0.1 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '3rem' }}>menu_book</span>
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 12, right: 12 }}>
                    <span className="rs-status-dot" style={{ background: ALL_SERVICES_MAP[book.service]?.color || 'var(--primary)' }} />
                  </div>
                  {book.status === 'reading' && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(0,0,0,0.3)' }}>
                      <div className="rs-h-full" style={{ width: `${book.progress_pct}%`, background: 'var(--primary)', boxShadow: '0 0 12px var(--primary)' }} />
                    </div>
                  )}
                </div>
                <div className="rs-p-4">
                  <div className="rs-mb-1 rs-type-small rs-clip rs-fw-700" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.2 }}>{book.title}</div>
                  <div className="rs-card-meta rs-mt-2 rs-type-nano">{book.author}</div>
                  <div className="rs-mt-4 rs-flex rs-justify-between rs-items-center">
                     <span className="rs-card-label rs-type-nano">{book.status.toUpperCase()}</span>
                     <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.3 }}>edit_note</span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Archive Sources">
        <div style={{ padding: '0 var(--rs-space-4) var(--rs-space-5)' }}>
           <div className="rs-flex rs-justify-between rs-items-center rs-mb-5">
             <p className="rs-card-meta rs-m-0">Toggle frequency bands for digital integrations.</p>
             <button className="rs-pill" onClick={() => setIntegrationsOpen(true)}>
               <span className="material-symbols-rounded">settings_input_antenna</span>
               INTEGRATIONS
             </button>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ALL_SERVICES.map(s => {
                const active = (selectedServiceKeys || []).includes(s.key)
                return (
                  <button key={s.key} className={`rs-card is-tappable ${active ? 'is-elev' : ''}`} style={{ padding: 'var(--rs-space-4)', textAlign: 'center' }} onClick={() => {
                     const next = active ? selectedServiceKeys.filter(k => k !== s.key) : [...selectedServiceKeys, s.key]
                     setSelectedServiceKeys(next)
                     localStorage.setItem(`rs-reading-services:${userId}`, JSON.stringify(next))
                  }}>
                    <div className="rs-card-inner" style={{ background: active ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent', border: active ? '1px solid var(--primary)' : '1px solid transparent' }}>
                      <span className="material-symbols-rounded rs-mb-2" style={{ fontSize: '1.8rem', color: s.color }}>{s.icon}</span>
                      <div className="rs-type-micro rs-fw-700">{s.label.toUpperCase()}</div>
                    </div>
                  </button>
                )
              })}
           </div>
        </div>
      </Sheet>

      <ReadingIntegrationsModal 
        open={integrationsOpen} 
        onClose={() => setIntegrationsOpen(false)}
        onRefresh={loadShelf}
      />
    </div>
  )
}
