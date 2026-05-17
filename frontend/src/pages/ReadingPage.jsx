import React, { useState, useEffect, useCallback, useRef } from 'react'
import './ReadingPage.css'

const API = '/api/reading'

// All possible services with metadata
const ALL_SERVICES = [
  {
    key: 'kindle',
    label: 'Kindle',
    color: '#ff9900',
    bg: 'rgba(255,153,0,0.10)',
    connect: 'audible',       // shares Audible auth
    type: 'sync',
    description: 'Amazon e-books. Syncs via your Audible/Amazon account.',
    syncs: 'Full library · Reading progress',
    requires: 'audible',
    requiresLabel: 'Connect Audible first — Kindle uses the same Amazon account.',
  },
  {
    key: 'audible',
    label: 'Audible',
    color: '#f58220',
    bg: 'rgba(245,130,32,0.10)',
    type: 'live',
    description: 'Amazon audiobooks. Registers this device to your account.',
    syncs: 'Full library · Listening progress',
    caveat: 'Accounts with 2-step verification may need it temporarily disabled during setup.',
  },
  {
    key: 'libby',
    label: 'Libby',
    color: '#00aaff',
    bg: 'rgba(0,170,255,0.10)',
    type: 'live',
    description: 'Public library loans & holds — no password needed.',
    syncs: 'Current loans · Holds queue · Reading progress',
  },
  {
    key: 'google_play',
    label: 'Google Play',
    color: '#4285f4',
    bg: 'rgba(66,133,244,0.10)',
    type: 'live',
    hasSync: true,
    description: 'Google Play Books via OAuth — sign in once, sync anytime.',
    syncs: 'Full library · Reading status · Progress · Ratings · Covers',
  },
  {
    key: 'kobo',
    label: 'Kobo',
    color: '#e8a020',
    bg: 'rgba(232,160,32,0.10)',
    type: 'import',
    description: 'Import via Goodreads export. Kobo syncs to Goodreads natively.',
    syncs: 'Library · Reading status · Ratings',
    importInstructions: [
      'Open Kobo app or kobobooks.com',
      'Go to Settings → Goodreads and link your account',
      'Go to goodreads.com → My Books → Import/Export → Export Library',
      'Upload the goodreads_library_export.csv file here',
    ],
  },
  {
    key: 'apple_books',
    label: 'Apple Books',
    color: '#fc3c44',
    bg: 'rgba(252,60,68,0.10)',
    type: 'import',
    description: 'Import via Goodreads — Apple Books supports Goodreads reading history.',
    syncs: 'Library · Reading status · Ratings',
    importInstructions: [
      'Open the Books app on your iPhone or iPad',
      'Tap your profile → Goodreads → Connect',
      'Go to goodreads.com → My Books → Import/Export → Export Library',
      'Upload the goodreads_library_export.csv file here',
    ],
  },
  {
    key: 'other',
    label: 'Other',
    color: '#8888aa',
    bg: 'rgba(136,136,170,0.10)',
    type: 'manual',
    description: 'Books added manually.',
    syncs: 'Manual entry only',
  },
]

const ALL_SERVICES_MAP = Object.fromEntries(ALL_SERVICES.map(s => [s.key, s]))

// "All Books" pseudo-tab (always shown)
const ALL_TAB = { key: 'all', label: 'All Books', color: '#00aaff', bg: 'rgba(0,170,255,0.10)' }

const SERVICE_LAUNCH = {
  kindle:      'https://read.amazon.com',
  google_play: 'https://play.google.com/books',
  audible:     'https://www.audible.com/library',
  libby:       'https://libbyapp.com',
  kobo:        'https://www.kobo.com/ebooks',
  apple_books: 'https://books.apple.com',
}

const STATUSES = [
  { key: 'all',          label: 'All',          color: 'var(--text-dim)' },
  { key: 'reading',      label: 'Reading',      color: 'var(--primary)' },
  { key: 'finished',     label: 'Finished',     color: 'var(--secondary)' },
  { key: 'want_to_read', label: 'Want to Read', color: 'var(--warn)' },
  { key: 'dnf',          label: 'DNF',          color: 'var(--text-muted)' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId() {
  try {
    const token = localStorage.getItem('rs-auth-token')
    if (!token) return 'default'
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.sub || 'default'
  } catch { return 'default' }
}

function loadSelectedServices(userId) {
  try {
    const raw = localStorage.getItem(`rs-reading-services:${userId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null  // null = not yet configured
}

function saveSelectedServices(userId, keys) {
  try { localStorage.setItem(`rs-reading-services:${userId}`, JSON.stringify(keys)) } catch {}
}

function authHeaders() {
  const token = localStorage.getItem('rs-auth-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
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
  if (res.status === 204) return null
  return res.json()
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReadingPage({ setAction }) {
  const userId = getUserId()

  const [selectedServiceKeys, setSelectedServiceKeys] = useState(() => loadSelectedServices(userId))
  const [showServicePicker, setShowServicePicker]     = useState(false)

  const [shelf, setShelf]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [activeService, setActiveService] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [search, setSearch]             = useState('')
  const [showModal, setShowModal]       = useState(false)
  const [editBook, setEditBook]         = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [libbyTab, setLibbyTab]         = useState('loans')
  const [libbyLoans, setLibbyLoans]     = useState(null)
  const [libbyHolds, setLibbyHolds]     = useState(null)
  const [libbyLoading, setLibbyLoading] = useState(false)
  const [libbyError, setLibbyError]     = useState('')
  const [connections, setConnections]   = useState({ libby: false, audible: false, kindle: false })
  const [connectModal, setConnectModal] = useState(null)
  const [importTarget, setImportTarget] = useState(null)
  const [syncingService, setSyncingService] = useState(null)

  // -- Bottom Action Slot --
  const ActionSlot = useMemo(() => (
    <div className="rs-input-bar">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="rs-card" style={{ flex: 1, padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'center', background: 'var(--md-surface-container-low)' }}>
          <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>search</span>
          <input
            style={{ all: 'unset', flex: 1, fontSize: '0.95rem' }}
            placeholder="Search title or author…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="rs-pill" style={{ padding: '4px' }} onClick={() => setSearch('')}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
            </button>
          )}
        </div>
        <button className="rs-btn-primary" style={{ padding: '10px 20px' }} onClick={() => { setEditBook(null); setShowModal(true) }}>
          <span className="material-symbols-rounded">add</span>
          BOOK
        </button>
      </div>
    </div>
  ), [search])

  useEffect(() => {
    if (setAction) setAction(ActionSlot)
  }, [ActionSlot, setAction])

  // Services the user has selected, resolved to objects
  const activeServices = selectedServiceKeys
    ? selectedServiceKeys.map(k => ALL_SERVICES_MAP[k]).filter(Boolean)
    : []

  const loadShelf = useCallback(() => {
    setLoading(true)
    apiFetch('/shelf')
      .then(setShelf)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const loadConnections = useCallback(() => {
    apiFetch('/connections').then(setConnections).catch(() => {})
  }, [])

  useEffect(() => { loadShelf(); loadConnections() }, [loadShelf, loadConnections])

  const loadLibby = useCallback((tab) => {
    setLibbyLoading(true)
    setLibbyError('')
    const path = tab === 'loans' ? '/libby/loans' : '/libby/holds'
    apiFetch(path)
      .then(data => {
        if (tab === 'loans') setLibbyLoans(data)
        else setLibbyHolds(data)
      })
      .catch(e => setLibbyError(e.message))
      .finally(() => setLibbyLoading(false))
  }, [])

  useEffect(() => {
    if (activeService === 'libby') loadLibby(libbyTab)
  }, [activeService, libbyTab, loadLibby])

  const handleSaveServices = (keys) => {
    saveSelectedServices(userId, keys)
    setSelectedServiceKeys(keys)
    setShowServicePicker(false)
    // Reset to 'all' if current tab was removed
    if (activeService !== 'all' && !keys.includes(activeService)) {
      setActiveService('all')
    }
  }

  const handleSave = async (data) => {
    if (editBook) {
      const updated = await apiFetch(`/shelf/${editBook.id}`, { method: 'PATCH', body: JSON.stringify(data) })
      setShelf(s => s.map(b => b.id === updated.id ? updated : b))
    } else {
      const created = await apiFetch('/shelf', { method: 'POST', body: JSON.stringify(data) })
      setShelf(s => [created, ...s])
    }
    setShowModal(false)
    setEditBook(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await apiFetch(`/shelf/${deleteTarget.id}`, { method: 'DELETE' })
      setShelf(s => s.filter(b => b.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setError(e.message)
      setDeleteTarget(null)
    }
  }

  const openEdit = (book) => { setEditBook(book); setShowModal(true) }
  const openAdd  = () => { setEditBook(null); setShowModal(true) }

  const q = search.toLowerCase()
  const filtered = shelf.filter(b => {
    if (activeService !== 'all' && b.service !== activeService) return false
    if (activeStatus  !== 'all' && b.status  !== activeStatus)  return false
    if (q && !b.title.toLowerCase().includes(q) && !(b.author || '').toLowerCase().includes(q)) return false
    return true
  })

  const stats = {
    reading:      shelf.filter(b => b.status === 'reading').length,
    finished:     shelf.filter(b => b.status === 'finished').length,
    want_to_read: shelf.filter(b => b.status === 'want_to_read').length,
    dnf:          shelf.filter(b => b.status === 'dnf').length,
  }

  const counts = Object.fromEntries(
    ALL_SERVICES.map(s => [s.key, shelf.filter(b => b.service === s.key).length])
  )

  // Tabs = All + selected services that have books OR are selected
  const tabs = [
    ALL_TAB,
    ...activeServices,
  ]

  // Show first-run picker if no services chosen yet
  if (selectedServiceKeys === null || showServicePicker) {
    return (
      <div className="rs-foyer animate-fade-in">
        <header className="rs-foyer-head">
          <div className="rs-card-label" style={{ marginBottom: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>auto_stories</span>
            INTEGRATIONS / READING
          </div>
          <h1 className="rs-greeting">Reading Services</h1>
        </header>
        <ServicePickerPage
          current={selectedServiceKeys || []}
          onSave={handleSaveServices}
          isFirstRun={selectedServiceKeys === null}
          onCancel={selectedServiceKeys === null ? null : () => setShowServicePicker(false)}
        />
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
           <div>
              <div className="rs-card-label" style={{ marginBottom: 8 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>auto_stories</span>
                INTEGRATIONS / READING
              </div>
              <h1 className="rs-greeting">Reading</h1>
              <div className="rs-greeting-sub">Track progress and browse your digital library.</div>
           </div>
           <button className="rs-pill" onClick={() => setShowServicePicker(true)}>
             <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>settings</span>
             SERVICES
           </button>
        </div>
      </header>

      {error && (
        <div className="rs-pill is-active" style={{ background: 'var(--md-error)', color: 'white', marginBottom: 24, width: 'fit-content' }}>
          {error}
          <button style={{ all: 'unset', marginLeft: 12, cursor: 'pointer' }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* My services panel */}
      {activeServices.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <MyServicesPanel
            services={activeServices}
            connections={connections}
            shelf={shelf}
            onConnect={svc => setConnectModal(svc)}
            onDisconnect={async (svc) => {
              await apiFetch(`/connect/${svc}`, { method: 'DELETE' })
              loadConnections()
            }}
            onSync={async (svc) => {
              const result = await apiFetch(`/sync/${svc}`, { method: 'POST' })
              loadShelf()
              return result
            }}
            onImport={svc => setImportTarget(svc)}
          />
        </div>
      )}

      {/* Stats bar */}
      {!loading && shelf.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          <StatPill label="Reading"      count={stats.reading}      color="var(--primary)"    onClick={() => setActiveStatus('reading')}      active={activeStatus === 'reading'} />
          <StatPill label="Finished"     count={stats.finished}     color="var(--secondary)"  onClick={() => setActiveStatus('finished')}     active={activeStatus === 'finished'} />
          <StatPill label="Want to Read" count={stats.want_to_read} color="var(--warn)"       onClick={() => setActiveStatus('want_to_read')} active={activeStatus === 'want_to_read'} />
          <StatPill label="DNF"          count={stats.dnf}          color="var(--text-muted)" onClick={() => setActiveStatus('dnf')}          active={activeStatus === 'dnf'} />
          {activeStatus !== 'all' && (
            <button className="rs-pill" onClick={() => setActiveStatus('all')}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
              CLEAR
            </button>
          )}
        </div>
      )}

      {/* Service tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {tabs.map(s => (
          <button
            key={s.key}
            className={`rs-pill ${activeService === s.key ? 'is-active' : ''}`}
            onClick={() => setActiveService(s.key)}
          >
            <span className="rs-status-dot" style={{ width: 6, height: 6, background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
            {s.label.toUpperCase()}
            {counts[s.key] > 0 && (
              <span style={{ opacity: 0.5, marginLeft: 4 }}>({counts[s.key]})</span>
            )}
            {s.key === 'all' && shelf.length > 0 && (
              <span style={{ opacity: 0.5, marginLeft: 4 }}>({shelf.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Libby live section */}
      {activeService === 'libby' && (
        <div className="rs-card is-wide" style={{ marginBottom: 24 }}>
          <div className="rs-card-head">
            <span className="rs-card-label">LIVE LIBRARY DATA</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {['loans', 'holds'].map(t => (
                <button
                  key={t}
                  className={`rs-pill ${libbyTab === t ? 'is-active' : ''}`}
                  onClick={() => setLibbyTab(t)}
                  style={{ fontSize: '0.7rem' }}
                >
                  {t === 'loans' ? 'LOANS' : 'HOLDS'}
                </button>
              ))}
              <button className="rs-pill" onClick={() => loadLibby(libbyTab)} style={{ fontSize: '0.7rem' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>refresh</span>
              </button>
            </div>
          </div>

          {libbyLoading && <div className="rs-card-meta">Fetching from Libby…</div>}
          {libbyError && (
            <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
              {libbyError.includes('not set up')
                ? <>Libby not connected. Click <strong>Connect Libby</strong> above.</>
                : libbyError}
            </div>
          )}

          {!libbyLoading && !libbyError && (
             <div className="rs-card-flow" style={{ marginTop: 16 }}>
                {libbyTab === 'loans' ? (
                  libbyLoans?.length === 0 
                    ? <div className="rs-card-meta">No active loans.</div>
                    : libbyLoans?.map((loan, i) => <LibbyLoanCard key={i} loan={loan} />)
                ) : (
                  libbyHolds?.length === 0
                    ? <div className="rs-card-meta">No holds in queue.</div>
                    : libbyHolds?.map((hold, i) => <LibbyHoldCard key={i} hold={hold} />)
                )}
             </div>
          )}
        </div>
      )}

      {/* Shelf */}
      {loading ? (
        <div className="rs-card-meta">Loading shelf…</div>
      ) : filtered.length === 0 ? (
        <div className="rs-card is-wide" style={{ textAlign: 'center', padding: '64px 24px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: 16 }}>auto_stories</span>
          <div className="rs-card-value">Shelf empty</div>
          <div className="rs-card-meta">
            {shelf.length === 0
              ? 'Add your first book to get started.'
              : 'No books match your filter.'
            }
          </div>
        </div>
      ) : (
        <div className="rs-card-flow">
          {filtered.map(book => (
            <BookCard
              key={book.id}
              book={book}
              onEdit={() => openEdit(book)}
              onDelete={() => setDeleteTarget(book)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <BookModal
          book={editBook}
          defaultService={activeService !== 'all' && activeService !== 'libby' ? activeService : (activeServices[0]?.key || 'kindle')}
          availableServices={activeServices.length > 0 ? activeServices : ALL_SERVICES}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditBook(null) }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          book={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {connectModal === 'libby' && (
        <LibbyConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {connectModal === 'audible' && (
        <AudibleConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {connectModal === 'google_play' && (
        <GooglePlayConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {importTarget && (
        <CsvImportModal
          svc={importTarget}
          onDone={() => { setImportTarget(null); loadShelf() }}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  )
}

      {/* Modals */}
      {showModal && (
        <BookModal
          book={editBook}
          defaultService={activeService !== 'all' && activeService !== 'libby' ? activeService : (activeServices[0]?.key || 'kindle')}
          availableServices={activeServices.length > 0 ? activeServices : ALL_SERVICES}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditBook(null) }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          book={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {connectModal === 'libby' && (
        <LibbyConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {connectModal === 'audible' && (
        <AudibleConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {connectModal === 'google_play' && (
        <GooglePlayConnectModal
          onDone={() => { setConnectModal(null); loadConnections() }}
          onClose={() => setConnectModal(null)}
        />
      )}

      {importTarget && (
        <CsvImportModal
          svc={importTarget}
          onDone={() => { setImportTarget(null); loadShelf() }}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  )
}

// =============================================================================
// Service Picker (first-run + manage)
// =============================================================================

function ServicePickerPage({ current, onSave, isFirstRun, onCancel }) {
  const [selected, setSelected] = useState(new Set(current))

  const toggle = (key) => {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      // If Kindle selected, auto-select Audible (they share auth)
      if (key === 'kindle' && !next.has('audible')) next.add('audible')
      return next
    })
  }

  const orderedKeys = ALL_SERVICES.map(s => s.key).filter(k => selected.has(k))

  return (
    <div className="reading-picker-wrap">
      <div className="reading-picker-header">
        <h2 className="reading-picker-title">
          {isFirstRun ? 'Which reading services do you use?' : 'Manage Your Services'}
        </h2>
        <p className="reading-picker-sub">
          {isFirstRun
            ? 'Select every platform where you have books. You can change this anytime.'
            : 'Add or remove services from your reading hub.'}
        </p>
      </div>

      <div className="reading-picker-grid">
        {ALL_SERVICES.map(svc => {
          const on = selected.has(svc.key)
          return (
            <button
              key={svc.key}
              className={`reading-picker-card${on ? ' reading-picker-card--on' : ''}`}
              style={{ '--svc-color': svc.color }}
              onClick={() => toggle(svc.key)}
            >
              <div className="reading-picker-card-top">
                <span className="reading-picker-dot" style={{ background: svc.color }} />
                <span className="reading-picker-name">{svc.label}</span>
                <span className={`reading-picker-type reading-svc-type-pill--${svc.type}`}>
                  {svc.type === 'live' ? 'LIVE' : svc.type === 'sync' ? 'SYNC' : svc.type === 'import' ? 'IMPORT' : 'MANUAL'}
                </span>
                <span className={`reading-picker-check${on ? ' reading-picker-check--on' : ''}`}>
                  {on ? '✓' : '+'}
                </span>
              </div>
              <p className="reading-picker-desc">{svc.description}</p>
              <p className="reading-picker-syncs">{svc.syncs}</p>
              {svc.requires && !selected.has(svc.requires) && (
                <p className="reading-picker-caveat">⚠ {svc.requiresLabel}</p>
              )}
            </button>
          )
        })}
      </div>

      <div className="reading-picker-footer">
        {onCancel && (
          <button className="btn" onClick={onCancel}>Cancel</button>
        )}
        <button
          className="btn btn--primary"
          onClick={() => onSave(orderedKeys)}
          disabled={selected.size === 0}
        >
          {isFirstRun ? `Set Up ${selected.size} Service${selected.size !== 1 ? 's' : ''} →` : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// My Services Panel (compact, one card per selected service)
// =============================================================================

function MyServicesPanel({ services, connections, shelf, onConnect, onDisconnect, onSync, onImport }) {
  const [open, setOpen]           = useState(true)
  const [syncing, setSyncing]     = useState(null)
  const [syncResult, setSyncResult] = useState({})
  const [disconnecting, setDisconnecting] = useState(null)

  const handleSync = async (key) => {
    setSyncing(key)
    setSyncResult(r => ({ ...r, [key]: null }))
    try {
      const result = await onSync(key)
      setSyncResult(r => ({ ...r, [key]: result }))
    } catch (e) {
      setSyncResult(r => ({ ...r, [key]: { error: e.message } }))
    } finally {
      setSyncing(null)
    }
  }

  const handleDisconnect = async (key) => {
    setDisconnecting(key)
    try { await onDisconnect(key) } finally { setDisconnecting(null) }
  }

  const bookCounts = Object.fromEntries(
    services.map(s => [s.key, shelf.filter(b => b.service === s.key).length])
  )

  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head" onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer' }}>
        <span className="rs-card-label">
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>account_tree</span>
          MY SERVICES
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {services.map(s => {
              const connected = s.type === 'manual' || s.type === 'import' || connections[s.key]
              return (
                <span key={s.key} className="rs-status-dot" style={{ width: 6, height: 6, background: connected ? s.color : 'var(--md-outline)', opacity: connected ? 1 : 0.3 }} />
              )
            })}
          </div>
          <span className="material-symbols-rounded rs-card-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>chevron_right</span>
        </div>
      </div>

      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
          {services.map(svc => {
            const connected = connections[svc.key]
            const blockedBy = svc.requires && !connections[svc.requires]
            const res = syncResult[svc.key]
            const bookCount = bookCounts[svc.key] || 0

            const isImport  = svc.type === 'import'
            const isManual  = svc.type === 'manual'
            const isLive    = svc.type === 'live'
            const isSync    = svc.type === 'sync'

            // Effective connected state for display
            const effectiveConnected = isImport || isManual ? bookCount > 0 : connected

            return (
              <div
                key={svc.key}
                className={`rs-card ${effectiveConnected ? 'is-elev' : ''}`}
                style={{ background: 'var(--md-surface-container-low)', padding: 16 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                       <span className="rs-status-dot" style={{ width: 6, height: 6, background: svc.color, boxShadow: `0 0 8px ${svc.color}` }} />
                       <span style={{ fontWeight: 600 }}>{svc.label}</span>
                    </div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>{svc.type.toUpperCase()}</div>
                  </div>
                  {bookCount > 0 && (
                    <span className="rs-pill" style={{ fontSize: '0.65rem' }}>{bookCount} BOOKS</span>
                  )}
                </div>

                <div className="rs-card-meta" style={{ fontSize: '0.75rem', marginBottom: 16 }}>
                  {svc.syncs}
                  {blockedBy && <div style={{ color: 'var(--md-error)', marginTop: 4 }}>⚠ {svc.requiresLabel}</div>}
                  {res && !res.error && <div style={{ color: '#4ade80', marginTop: 4 }}>✓ {res.added} added</div>}
                  {res?.error && <div style={{ color: 'var(--md-error)', marginTop: 4 }}>✗ {res.error}</div>}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {isLive && !connected && (
                    <button className="rs-pill is-active" onClick={() => onConnect(svc.key)} style={{ width: '100%', background: svc.color, color: 'black' }}>
                      CONNECT
                    </button>
                  )}

                  {isLive && connected && (
                    <>
                      {svc.hasSync && (
                        <button className="rs-pill is-active" onClick={() => handleSync(svc.key)} disabled={syncing === svc.key} style={{ flex: 1 }}>
                          {syncing === svc.key ? '…' : 'SYNC'}
                        </button>
                      )}
                      <button className="rs-pill" onClick={() => handleDisconnect(svc.key)} disabled={disconnecting === svc.key}>
                        DISCONNECT
                      </button>
                    </>
                  )}

                  {isSync && !blockedBy && (
                    <button className="rs-pill is-active" onClick={() => handleSync(svc.key)} disabled={syncing === svc.key} style={{ width: '100%' }}>
                      {syncing === svc.key ? 'SYNCING…' : 'SYNC LIBRARY'}
                    </button>
                  )}

                  {isSync && blockedBy && (
                    <button className="rs-pill is-active" onClick={() => onConnect('audible')} style={{ width: '100%', background: '#f58220', color: 'black' }}>
                      CONNECT AUDIBLE FIRST
                    </button>
                  )}

                  {isImport && (
                    <button className="rs-pill is-active" onClick={() => onImport(svc)} style={{ width: '100%' }}>
                      {bookCount > 0 ? 'RE-IMPORT' : 'IMPORT CSV'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Stats pill
// =============================================================================

function StatPill({ label, count, color, onClick, active }) {
  return (
    <button
      className={`rs-pill ${active ? 'is-active' : ''}`}
      onClick={onClick}
      style={active ? { background: color, color: 'black' } : {}}
    >
      <span style={{ fontWeight: 700 }}>{count}</span>
      <span style={{ opacity: 0.7 }}>{label.toUpperCase()}</span>
    </button>
  )
}

// =============================================================================
// Book card (cover-forward)
// =============================================================================

function BookCard({ book, onEdit, onDelete }) {
  const svc      = ALL_SERVICES_MAP[book.service] || ALL_SERVICES_MAP['other']
  const launchUrl = book.launch_url || SERVICE_LAUNCH[book.service] || null
  const statusObj = STATUSES.find(s => s.key === book.status)

  return (
    <div className="rs-card" style={{ flex: '1 1 180px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', aspectRatio: '2/3', background: 'var(--md-surface-container-highest)' }}>
        {book.cover_url ? (
          <img src={book.cover_url} alt={book.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, marginBottom: 8 }}>book</span>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, opacity: 0.5 }}>{book.title}</div>
          </div>
        )}
        
        {/* Overlays */}
        <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
           <span className="rs-pill is-active" style={{ fontSize: '0.6rem', padding: '2px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', color: 'white', border: 'none' }}>
             {statusObj?.label.toUpperCase() || book.status.toUpperCase()}
           </span>
           <span className="rs-status-dot" style={{ width: 8, height: 8, background: svc?.color || '#8888aa', boxShadow: `0 0 8px ${svc?.color}` }} />
        </div>

        {book.status === 'reading' && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.2)' }}>
            <div style={{ height: '100%', width: `${book.progress_pct}%`, background: svc?.color || 'var(--primary)', transition: 'width 0.5s' }} />
          </div>
        )}

        <div className="reading-book-overlay" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', padding: 16 }}>
            {launchUrl && (
              <a href={launchUrl} target="_blank" rel="noopener noreferrer" className="rs-btn-primary" style={{ padding: '8px', fontSize: '0.8rem', textAlign: 'center', textDecoration: 'none' }}>
                OPEN ↗
              </a>
            )}
            <button className="rs-pill is-active" onClick={onEdit} style={{ fontSize: '0.8rem' }}>EDIT</button>
            <button className="rs-pill" onClick={onDelete} style={{ fontSize: '0.8rem', color: 'var(--md-error)' }}>DELETE</button>
          </div>
        </div>
      </div>

      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.title}</div>
        <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: 8 }}>{book.author || 'Unknown Author'}</div>
        
        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           {book.rating ? (
             <div style={{ color: 'var(--warn)', fontSize: '0.8rem' }}>{'★'.repeat(book.rating)}</div>
           ) : <div />}
           {book.status === 'reading' && (
             <div className="rs-card-label" style={{ fontSize: '0.65rem' }}>{Math.round(book.progress_pct)}%</div>
           )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Libby cards
// =============================================================================

function LibbyLoanCard({ loan }) {
  const urgent = loan.days_remaining >= 0 && loan.days_remaining <= 3
  return (
    <div className="rs-card" style={{ flex: '1 1 160px', padding: 0, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '2/3' }}>
        {loan.cover_url ? (
          <img src={loan.cover_url} alt={loan.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'var(--md-surface-container-highest)' }} />
        )}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
           <span className={`rs-pill is-active`} style={{ fontSize: '0.6rem', padding: '2px 8px', background: urgent ? 'var(--md-error)' : 'rgba(0,0,0,0.6)', border: 'none', color: 'white' }}>
             {loan.days_remaining >= 0 ? `${loan.days_remaining}D LEFT` : 'ACTIVE'}
           </span>
        </div>
        {loan.percent_complete >= 0 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(255,255,255,0.2)' }}>
            <div style={{ height: '100%', width: `${loan.percent_complete}%`, background: '#00aaff' }} />
          </div>
        )}
        <div className="reading-book-overlay" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
          <a href="https://libbyapp.com" target="_blank" rel="noopener noreferrer" className="rs-btn-primary" style={{ padding: '8px 16px', fontSize: '0.8rem', textDecoration: 'none' }}>
            OPEN LIBBY ↗
          </a>
        </div>
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loan.title}</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{loan.author}</div>
      </div>
    </div>
  )
}

function LibbyHoldCard({ hold }) {
  return (
    <div className="rs-card" style={{ flex: '1 1 160px', padding: 0, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '2/3' }}>
        {hold.cover_url ? (
          <img src={hold.cover_url} alt={hold.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'var(--md-surface-container-highest)' }} />
        )}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
           <span className="rs-pill is-active" style={{ fontSize: '0.6rem', padding: '2px 8px', background: 'var(--warn)', color: 'black', border: 'none' }}>
             {hold.queue_position > 0 ? `#${hold.queue_position}` : 'HOLD'}
           </span>
        </div>
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hold.title}</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          {hold.estimated_wait_days >= 0 ? `~${hold.estimated_wait_days}d wait` : hold.author}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Libby connect modal (2-step chip pairing)
// =============================================================================

function LibbyConnectModal({ onDone, onClose }) {
  const [step, setStep]       = useState(1)
  const [code, setCode]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const [instructions, setInstructions] = useState('')

  const start = async () => {
    setBusy(true); setErr('')
    try {
      const res = await apiFetch('/connect/libby/start', { method: 'POST' })
      setInstructions(res.instructions)
      setStep(2)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const complete = async () => {
    if (code.replace(/\D/g, '').length !== 8) { setErr('Enter the full 8-digit code.'); return }
    setBusy(true); setErr('')
    try {
      await apiFetch('/connect/libby/complete', {
        method: 'POST',
        body: JSON.stringify({ code: code.replace(/\D/g, '') }),
      })
      onDone()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal reading-modal--sm" style={{ '--modal-accent': '#00aaff' }}>
        <div className="reading-modal-header">
          <span className="reading-modal-title">CONNECT LIBBY</span>
          <button className="reading-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="reading-connect-body">
          {step === 1 && (
            <>
              <div className="reading-connect-icon" style={{ color: '#00aaff' }}><IconLibby /></div>
              <p className="reading-connect-intro">
                Link your public library account. River Song will create a device identity
                and pair it with your Libby account — no password required.
              </p>
              <div className="reading-connect-steps">
                <div className="reading-connect-step"><span>1</span>Click Start below — we'll create a device pairing code</div>
                <div className="reading-connect-step"><span>2</span>Open the Libby app on your phone</div>
                <div className="reading-connect-step"><span>3</span>Settings → Copy to Another Device → This is the sending device</div>
                <div className="reading-connect-step"><span>4</span>Enter the 8-digit code that appears</div>
              </div>
              {err && <div className="reading-form-error">{err}</div>}
              <div className="reading-modal-actions">
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn btn--primary" onClick={start} disabled={busy}>
                  {busy ? 'Creating pairing…' : 'Start Pairing'}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="reading-connect-icon" style={{ color: '#00aaff' }}><IconLibby /></div>
              <p className="reading-connect-intro">{instructions}</p>
              <div className="reading-form-row" style={{ margin: '8px 0 4px' }}>
                <label className="reading-form-label">8-DIGIT CODE FROM LIBBY</label>
                <input
                  className="reading-form-input reading-code-input"
                  placeholder="12345678"
                  maxLength={8}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
              </div>
              {err && <div className="reading-form-error">{err}</div>}
              <div className="reading-modal-actions">
                <button className="btn" onClick={() => { setStep(1); setCode(''); setErr('') }}>Back</button>
                <button className="btn btn--primary" onClick={complete} disabled={busy || code.length < 8}>
                  {busy ? 'Linking…' : 'Link Account'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Audible connect modal
// =============================================================================

function AudibleConnectModal({ onDone, onClose }) {
  const [form, setForm] = useState({ email: '', password: '', country_code: 'us' })
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) { setErr('Email and password are required.'); return }
    setBusy(true); setErr('')
    try {
      await apiFetch('/connect/audible', { method: 'POST', body: JSON.stringify(form) })
      onDone()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal reading-modal--sm" style={{ '--modal-accent': '#f58220' }}>
        <div className="reading-modal-header">
          <span className="reading-modal-title">CONNECT AUDIBLE</span>
          <button className="reading-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="reading-connect-body">
          <div className="reading-connect-icon" style={{ color: '#f58220' }}>🎧</div>
          <p className="reading-connect-intro">
            Enter your Amazon credentials to link your Audible library.
            Your credentials are used only once to register this device and are not stored.
          </p>
          <div className="reading-audible-warning">
            ⚠ Accounts with 2-step verification may need it temporarily disabled during setup.
          </div>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div className="reading-form-row">
              <label className="reading-form-label">Amazon Email</label>
              <input className="reading-form-input" type="email" value={form.email}
                onChange={e => set('email', e.target.value)} placeholder="you@example.com" autoFocus />
            </div>
            <div className="reading-form-row">
              <label className="reading-form-label">Amazon Password</label>
              <input className="reading-form-input" type="password" value={form.password}
                onChange={e => set('password', e.target.value)} placeholder="••••••••" />
            </div>
            <div className="reading-form-row">
              <label className="reading-form-label">Marketplace</label>
              <select className="reading-form-select" value={form.country_code}
                onChange={e => set('country_code', e.target.value)}>
                {[['us','United States'],['uk','United Kingdom'],['de','Germany'],
                  ['fr','France'],['es','Spain'],['it','Italy'],['jp','Japan'],
                  ['au','Australia'],['ca','Canada'],['in','India']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            {err && <div className="reading-form-error">{err}</div>}
            <div className="reading-modal-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? 'Connecting…' : 'Connect Audible'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Google Play Books OAuth modal
// =============================================================================

function GooglePlayConnectModal({ onDone, onClose }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')
  const [waiting, setWaiting] = useState(false)  // true after redirect, polling for completion

  // The callback page posts the code back via localStorage
  useEffect(() => {
    if (!waiting) return
    const interval = setInterval(async () => {
      const code = localStorage.getItem('rs-books-oauth-code')
      if (!code) return
      localStorage.removeItem('rs-books-oauth-code')
      clearInterval(interval)
      setBusy(true)
      try {
        await apiFetch('/connect/google_play/callback', {
          method: 'POST',
          body: JSON.stringify({
            code,
            redirect_uri: `${window.location.origin}/reading-oauth-callback`,
          }),
        })
        onDone()
      } catch (e) {
        setErr(e.message)
        setBusy(false)
        setWaiting(false)
      }
    }, 800)
    return () => clearInterval(interval)
  }, [waiting, onDone])

  const startOAuth = async () => {
    setBusy(true); setErr('')
    try {
      const redirectUri = `${window.location.origin}/reading-oauth-callback`
      const data = await apiFetch(
        `/connect/google_play/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`
      )
      setBusy(false)
      setWaiting(true)
      // Open OAuth in a popup so we can stay on the page
      const popup = window.open(data.auth_url, 'google-books-auth', 'width=520,height=640,left=200,top=100')
      // Watch for popup close without completing
      const check = setInterval(() => {
        if (popup && popup.closed) {
          clearInterval(check)
          const code = localStorage.getItem('rs-books-oauth-code')
          if (!code) {
            setWaiting(false)
            setErr('Authorization cancelled or popup was closed.')
          }
        }
      }, 600)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal reading-modal--sm" style={{ '--modal-accent': '#4285f4' }}>
        <div className="reading-modal-header">
          <span className="reading-modal-title">CONNECT GOOGLE PLAY BOOKS</span>
          <button className="reading-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="reading-connect-body">
          <div className="reading-connect-icon" style={{ color: '#4285f4' }}>
            <IconGooglePlay />
          </div>

          {!waiting ? (
            <>
              <p className="reading-connect-intro">
                Sign in with Google to link your Play Books library. River Song will request
                read-only access to your books — no other Google data is accessed.
              </p>
              <div className="reading-connect-steps">
                <div className="reading-connect-step">
                  <span style={{ background: 'rgba(66,133,244,0.15)', color: '#4285f4' }}>1</span>
                  Click below — a Google sign-in popup will open
                </div>
                <div className="reading-connect-step">
                  <span style={{ background: 'rgba(66,133,244,0.15)', color: '#4285f4' }}>2</span>
                  Sign in and grant Books access
                </div>
                <div className="reading-connect-step">
                  <span style={{ background: 'rgba(66,133,244,0.15)', color: '#4285f4' }}>3</span>
                  Return here — then use "Sync Library" to pull your books
                </div>
              </div>
              {err && <div className="reading-form-error">{err}</div>}
              <div className="reading-modal-actions">
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn btn--primary" onClick={startOAuth} disabled={busy}>
                  {busy ? 'Opening…' : 'Sign in with Google'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="reading-connect-intro">
                Waiting for Google authorization…
                <br />
                Complete the sign-in in the popup window.
              </p>
              <div className="reading-books-waiting">
                <span className="reading-books-spinner" />
              </div>
              {err && <div className="reading-form-error">{err}</div>}
              <div className="reading-modal-actions">
                <button className="btn" onClick={() => { setWaiting(false); onClose() }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// CSV Import modal
// =============================================================================

function CsvImportModal({ svc, onDone, onClose }) {
  const [file, setFile]     = useState(null)
  const [busy, setBusy]     = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr]       = useState('')
  const inputRef            = useRef(null)

  const submit = async () => {
    if (!file) { setErr('Choose a CSV file first.'); return }
    setBusy(true); setErr(''); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('service', svc.key)
      const token = localStorage.getItem('rs-auth-token')
      const res = await fetch('/api/reading/import/csv', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(data.detail || res.statusText)
      }
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal" style={{ '--modal-accent': svc.color }}>
        <div className="reading-modal-header">
          <span className="reading-modal-title">IMPORT FROM {svc.label.toUpperCase()}</span>
          <button className="reading-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="reading-connect-body">
          <p className="reading-connect-intro">{svc.description}</p>

          {svc.importInstructions && (
            <div className="reading-connect-steps">
              {svc.importInstructions.map((step, i) => (
                <div key={i} className="reading-connect-step">
                  <span style={{ background: `color-mix(in srgb, ${svc.color} 18%, transparent)`, color: svc.color }}>{i + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          )}

          {!result && (
            <div className="reading-import-file-row">
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => { setFile(e.target.files[0]); setErr('') }}
              />
              <button
                className="reading-svc-btn reading-svc-btn--connect"
                style={{ '--svc-color': svc.color }}
                onClick={() => inputRef.current?.click()}
              >
                {file ? `✓ ${file.name}` : 'Choose CSV file'}
              </button>
              {file && (
                <button className="reading-svc-btn reading-svc-btn--disconnect" onClick={() => setFile(null)}>Clear</button>
              )}
            </div>
          )}

          {err && <div className="reading-form-error">{err}</div>}

          {result && (
            <div className="reading-import-result">
              <div className="reading-import-result-num" style={{ color: svc.color }}>{result.added}</div>
              <div className="reading-import-result-label">books added to your shelf</div>
              {result.skipped > 0 && (
                <div className="reading-import-result-sub">{result.skipped} already on shelf, skipped</div>
              )}
              {result.errors > 0 && (
                <div className="reading-import-result-sub reading-import-result-sub--warn">{result.errors} rows had errors</div>
              )}
              <div className="reading-import-result-format">Format detected: {result.format_detected}</div>
            </div>
          )}

          <div className="reading-modal-actions">
            {result
              ? <button className="btn btn--primary" onClick={onDone}>Done</button>
              : <>
                  <button className="btn" onClick={onClose}>Cancel</button>
                  <button className="btn btn--primary" onClick={submit} disabled={busy || !file}>
                    {busy ? 'Importing…' : 'Import Books'}
                  </button>
                </>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Delete confirm
// =============================================================================

function DeleteConfirm({ book, onConfirm, onCancel }) {
  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="reading-modal reading-modal--sm">
        <div className="reading-modal-header">
          <span className="reading-modal-title">REMOVE BOOK</span>
          <button className="reading-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="reading-delete-body">
          <div className="reading-delete-icon">🗑</div>
          <p className="reading-delete-msg">
            Remove <strong>"{book.title}"</strong> from your shelf? This cannot be undone.
          </p>
          <div className="reading-modal-actions">
            <button className="btn" onClick={onCancel}>Cancel</button>
            <button className="btn btn--danger" onClick={onConfirm}>Remove Book</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Add / Edit modal
// =============================================================================

function BookModal({ book, defaultService, availableServices, onSave, onClose }) {
  const [form, setForm] = useState({
    service:      book?.service      ?? defaultService,
    title:        book?.title        ?? '',
    author:       book?.author       ?? '',
    cover_url:    book?.cover_url    ?? '',
    progress_pct: book?.progress_pct ?? 0,
    status:       book?.status       ?? 'reading',
    rating:       book?.rating       ?? '',
    notes:        book?.notes        ?? '',
    launch_url:   book?.launch_url   ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Title is required.'); return }
    setSaving(true)
    setErr('')
    try {
      await onSave({
        ...form,
        progress_pct: parseFloat(form.progress_pct) || 0,
        rating: form.rating ? parseInt(form.rating) : null,
      })
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  const svc = ALL_SERVICES_MAP[form.service] || ALL_SERVICES_MAP['other']

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal">
        <div className="reading-modal-header" style={{ '--modal-accent': svc.color }}>
          <span className="reading-modal-title">{book ? 'EDIT BOOK' : 'ADD BOOK'}</span>
          <button className="reading-modal-close" onClick={onClose}>✕</button>
        </div>

        <form className="reading-modal-form" onSubmit={submit}>
          <div className="reading-form-row">
            <label className="reading-form-label">Service</label>
            <select className="reading-form-select" value={form.service} onChange={e => set('service', e.target.value)}>
              {availableServices.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="reading-form-row-2">
            <div className="reading-form-row">
              <label className="reading-form-label">Title *</label>
              <input className="reading-form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Book title" autoFocus />
            </div>
            <div className="reading-form-row">
              <label className="reading-form-label">Author</label>
              <input className="reading-form-input" value={form.author} onChange={e => set('author', e.target.value)} placeholder="Author name" />
            </div>
          </div>

          <div className="reading-form-row">
            <label className="reading-form-label">Cover URL</label>
            <input className="reading-form-input" value={form.cover_url} onChange={e => set('cover_url', e.target.value)} placeholder="https://…" />
          </div>

          <div className="reading-form-row-2">
            <div className="reading-form-row">
              <label className="reading-form-label">Status</label>
              <select className="reading-form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUSES.filter(s => s.key !== 'all').map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="reading-form-row">
              <label className="reading-form-label">Rating</label>
              <div className="reading-form-stars">
                {[1,2,3,4,5].map(n => (
                  <button
                    key={n} type="button"
                    className={`reading-star-btn${parseInt(form.rating) >= n ? ' reading-star-btn--on' : ''}`}
                    onClick={() => set('rating', form.rating === n ? '' : n)}
                  >★</button>
                ))}
                {form.rating && <button type="button" className="reading-clear-rating" onClick={() => set('rating', '')}>clear</button>}
              </div>
            </div>
          </div>

          {form.status === 'reading' && (
            <div className="reading-form-row">
              <label className="reading-form-label">Progress — {Math.round(form.progress_pct)}%</label>
              <input
                type="range" min="0" max="100" step="1"
                value={form.progress_pct}
                onChange={e => set('progress_pct', e.target.value)}
                className="reading-form-range"
                style={{ '--range-color': svc.color }}
              />
            </div>
          )}

          <div className="reading-form-row">
            <label className="reading-form-label">Launch URL <span className="reading-form-optional">(optional — overrides default)</span></label>
            <input className="reading-form-input" value={form.launch_url} onChange={e => set('launch_url', e.target.value)} placeholder="Direct link to this book" />
          </div>

          <div className="reading-form-row">
            <label className="reading-form-label">Notes</label>
            <textarea className="reading-form-textarea" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Your notes…" rows={3} />
          </div>

          {err && <div className="reading-form-error">{err}</div>}

          <div className="reading-modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? 'Saving…' : book ? 'Save Changes' : 'Add Book'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// =============================================================================
// Icons
// =============================================================================

function IconBook() {
  return (
    <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
      <path d="M3 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13l-7-3-7 3V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5"/>
      <line x1="13.5" y1="13.5" x2="18" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconServices({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="5"  cy="5"  r="3" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="15" cy="5"  r="3" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="5"  cy="15" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="15" cy="15" r="3" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )
}

function IconGooglePlay() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
      <path d="M3 3.5L13.5 12 3 20.5V3.5Z" fill="currentColor" opacity="0.7"/>
      <path d="M3 3.5l10.5 8.5L21 7.5 3 3.5Z" fill="currentColor" opacity="0.9"/>
      <path d="M3 20.5l10.5-8.5L21 16.5 3 20.5Z" fill="currentColor" opacity="0.9"/>
      <path d="M21 7.5L13.5 12 21 16.5V7.5Z" fill="currentColor"/>
    </svg>
  )
}

function IconLibby() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 8h10M7 12h7M7 16h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
