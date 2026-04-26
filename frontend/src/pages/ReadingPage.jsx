import React, { useState, useEffect, useCallback, useRef } from 'react'
import './ReadingPage.css'

const API = '/api/reading'

const SERVICES = [
  { key: 'all',         label: 'All Books',   color: '#00aaff',  bg: 'rgba(0,170,255,0.10)' },
  { key: 'kindle',      label: 'Kindle',      color: '#ff9900',  bg: 'rgba(255,153,0,0.10)' },
  { key: 'google_play', label: 'Google Play', color: '#4285f4',  bg: 'rgba(66,133,244,0.10)' },
  { key: 'audible',     label: 'Audible',     color: '#f58220',  bg: 'rgba(245,130,32,0.10)' },
  { key: 'libby',       label: 'Libby',       color: '#00aaff',  bg: 'rgba(0,170,255,0.10)' },
  { key: 'kobo',        label: 'Kobo',        color: '#e8a020',  bg: 'rgba(232,160,32,0.10)' },
  { key: 'apple_books', label: 'Apple Books', color: '#fc3c44',  bg: 'rgba(252,60,68,0.10)' },
  { key: 'other',       label: 'Other',       color: '#8888aa',  bg: 'rgba(136,136,170,0.10)' },
]

const SERVICE_MAP = Object.fromEntries(SERVICES.map(s => [s.key, s]))

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

export default function ReadingPage() {
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
  const [connectModal, setConnectModal] = useState(null)   // 'libby' | 'audible' | null
  const [importTarget, setImportTarget] = useState(null)   // svc object for CSV import modal

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

  // Stats from full shelf
  const stats = {
    reading:      shelf.filter(b => b.status === 'reading').length,
    finished:     shelf.filter(b => b.status === 'finished').length,
    want_to_read: shelf.filter(b => b.status === 'want_to_read').length,
    dnf:          shelf.filter(b => b.status === 'dnf').length,
  }

  const counts = Object.fromEntries(
    SERVICES.map(s => [s.key, s.key === 'all' ? shelf.length : shelf.filter(b => b.service === s.key).length])
  )

  const activeSvc = SERVICE_MAP[activeService] || SERVICES[0]

  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>INTEGRATIONS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>READING</span>
      </div>

      <div className="page-header-row">
        <div>
          <h1 className="page-title">Reading</h1>
          <p className="page-subtitle">All your books in one place. Track progress, launch apps, browse Libby.</p>
        </div>
        <button className="btn btn--primary" onClick={openAdd}>+ Add Book</button>
      </div>

      {error && <div className="reading-error">{error}<button className="reading-error-close" onClick={() => setError('')}>✕</button></div>}

      {/* Stats bar */}
      {!loading && shelf.length > 0 && (
        <div className="reading-stats-bar">
          <StatPill label="Reading"      count={stats.reading}      color="var(--primary)"   onClick={() => setActiveStatus('reading')}      active={activeStatus === 'reading'} />
          <StatPill label="Finished"     count={stats.finished}     color="var(--secondary)" onClick={() => setActiveStatus('finished')}     active={activeStatus === 'finished'} />
          <StatPill label="Want to Read" count={stats.want_to_read} color="var(--warn)"      onClick={() => setActiveStatus('want_to_read')} active={activeStatus === 'want_to_read'} />
          <StatPill label="DNF"          count={stats.dnf}          color="var(--text-muted)" onClick={() => setActiveStatus('dnf')}         active={activeStatus === 'dnf'} />
          <button
            className="reading-stat-clear"
            style={{ visibility: activeStatus !== 'all' ? 'visible' : 'hidden' }}
            onClick={() => setActiveStatus('all')}
          >
            ✕ Clear filter
          </button>
        </div>
      )}

      {/* Connected services panel */}
      <ConnectedServices
        connections={connections}
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

      {/* Service tabs */}
      <div className="reading-service-tabs">
        {SERVICES.map(s => (
          <button
            key={s.key}
            className={`reading-service-tab${activeService === s.key ? ' reading-service-tab--active' : ''}`}
            style={activeService === s.key ? { '--tab-color': s.color, '--tab-bg': s.bg } : {}}
            onClick={() => setActiveService(s.key)}
          >
            <span className="reading-service-dot" style={{ background: s.color }} />
            {s.label}
            {counts[s.key] > 0 && (
              <span className="reading-service-count" style={activeService === s.key ? { background: s.color, color: '#000' } : {}}>
                {counts[s.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Libby live section */}
      {activeService === 'libby' && (
        <div className="reading-libby-live">
          <div className="reading-libby-header">
            <span className="reading-libby-title">LIVE LIBRARY DATA</span>
            <div className="reading-libby-tabs">
              {['loans', 'holds'].map(t => (
                <button
                  key={t}
                  className={`reading-libby-tab${libbyTab === t ? ' reading-libby-tab--active' : ''}`}
                  onClick={() => setLibbyTab(t)}
                >
                  {t === 'loans' ? 'Current Loans' : 'Holds Queue'}
                </button>
              ))}
            </div>
            <button className="reading-libby-refresh" onClick={() => loadLibby(libbyTab)}>↻ Refresh</button>
          </div>

          {libbyLoading && <div className="reading-loading">Fetching from Libby…</div>}
          {libbyError && (
            <div className="reading-libby-error">
              {libbyError.includes('not set up')
                ? <>Libby not connected. Run <code>python -m providers.reading.libby --setup</code> to link your library card.</>
                : libbyError}
            </div>
          )}

          {!libbyLoading && !libbyError && libbyTab === 'loans' && libbyLoans && (
            libbyLoans.length === 0
              ? <div className="reading-empty">No active loans right now.</div>
              : <div className="reading-cover-grid reading-cover-grid--libby">
                  {libbyLoans.map((loan, i) => <LibbyLoanCard key={i} loan={loan} />)}
                </div>
          )}

          {!libbyLoading && !libbyError && libbyTab === 'holds' && libbyHolds && (
            libbyHolds.length === 0
              ? <div className="reading-empty">No holds in queue.</div>
              : <div className="reading-cover-grid reading-cover-grid--libby">
                  {libbyHolds.map((hold, i) => <LibbyHoldCard key={i} hold={hold} />)}
                </div>
          )}
        </div>
      )}

      {/* Search bar */}
      <div className="reading-toolbar">
        <div className="reading-search-wrap">
          <IconSearch />
          <input
            className="reading-search"
            placeholder="Search title or author…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="reading-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <span className="reading-result-count">
          {filtered.length} {filtered.length === 1 ? 'book' : 'books'}
        </span>
      </div>

      {/* Shelf */}
      {loading && <div className="reading-loading">Loading shelf…</div>}

      {!loading && filtered.length === 0 && (
        <div className="reading-empty">
          {shelf.length === 0
            ? <>Your shelf is empty.<br /><button className="reading-empty-add" onClick={openAdd}>+ Add your first book</button></>
            : 'No books match this filter.'
          }
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="reading-cover-grid">
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
          defaultService={activeService !== 'all' && activeService !== 'libby' ? activeService : 'kindle'}
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
// Stats pill
// =============================================================================

function StatPill({ label, count, color, onClick, active }) {
  return (
    <button
      className={`reading-stat-pill${active ? ' reading-stat-pill--active' : ''}`}
      style={{ '--pill-color': color }}
      onClick={onClick}
    >
      <span className="reading-stat-num">{count}</span>
      <span className="reading-stat-label">{label}</span>
    </button>
  )
}

// =============================================================================
// Book card (cover-forward)
// =============================================================================

function BookCard({ book, onEdit, onDelete }) {
  const svc      = SERVICE_MAP[book.service] || SERVICE_MAP['other']
  const launchUrl = book.launch_url || SERVICE_LAUNCH[book.service] || null
  const statusObj = STATUSES.find(s => s.key === book.status)

  return (
    <div className="reading-book-card">
      {/* Cover */}
      <div className="reading-book-cover">
        {book.cover_url
          ? <img src={book.cover_url} alt={book.title} className="reading-book-cover-img" />
          : <div className="reading-book-cover-placeholder">
              <IconBook />
              <span className="reading-book-cover-placeholder-title">{book.title}</span>
            </div>
        }

        {/* Status badge */}
        <div className={`reading-cover-status reading-cover-status--${book.status}`}>
          {statusObj?.label || book.status}
        </div>

        {/* Service badge */}
        <div className="reading-cover-service" style={{ background: svc.color }}>
          {svc.label}
        </div>

        {/* Progress overlay on cover */}
        {book.status === 'reading' && (
          <div className="reading-cover-progress">
            <div className="reading-cover-progress-fill" style={{ width: `${book.progress_pct}%`, background: svc.color }} />
          </div>
        )}

        {/* Hover actions overlay */}
        <div className="reading-book-overlay">
          <div className="reading-overlay-actions">
            {launchUrl && (
              <a href={launchUrl} target="_blank" rel="noopener noreferrer" className="reading-overlay-btn reading-overlay-btn--launch">
                Open ↗
              </a>
            )}
            <button className="reading-overlay-btn" onClick={onEdit}>Edit</button>
            <button className="reading-overlay-btn reading-overlay-btn--delete" onClick={onDelete}>Delete</button>
          </div>
        </div>
      </div>

      {/* Info below cover */}
      <div className="reading-book-meta">
        <div className="reading-book-title">{book.title}</div>
        {book.author && <div className="reading-book-author">{book.author}</div>}

        {book.rating && (
          <div className="reading-book-rating">
            {'★'.repeat(book.rating)}<span className="reading-book-rating-empty">{'★'.repeat(5 - book.rating)}</span>
          </div>
        )}

        {book.status === 'reading' && (
          <div className="reading-book-pct">{Math.round(book.progress_pct)}%</div>
        )}

        {book.notes && (
          <div className="reading-book-notes">{book.notes}</div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Libby cards (cover-forward)
// =============================================================================

function LibbyLoanCard({ loan }) {
  return (
    <div className="reading-book-card">
      <div className="reading-book-cover">
        {loan.cover_url
          ? <img src={loan.cover_url} alt={loan.title} className="reading-book-cover-img" />
          : <div className="reading-book-cover-placeholder"><IconBook /></div>
        }
        <div className={`reading-cover-status reading-cover-status--reading${loan.days_remaining >= 0 && loan.days_remaining <= 3 ? ' reading-cover-status--urgent' : ''}`}>
          {loan.days_remaining >= 0 ? `${loan.days_remaining}d left` : 'Active'}
        </div>
        {loan.percent_complete >= 0 && (
          <div className="reading-cover-progress">
            <div className="reading-cover-progress-fill" style={{ width: `${loan.percent_complete}%`, background: '#00aaff' }} />
          </div>
        )}
        <div className="reading-book-overlay">
          <div className="reading-overlay-actions">
            <a href="https://libbyapp.com" target="_blank" rel="noopener noreferrer" className="reading-overlay-btn reading-overlay-btn--launch">
              Open Libby ↗
            </a>
          </div>
        </div>
      </div>
      <div className="reading-book-meta">
        <div className="reading-book-title">{loan.title}</div>
        <div className="reading-book-author">{loan.author}</div>
        {loan.percent_complete >= 0 && (
          <div className="reading-book-pct">{Math.round(loan.percent_complete)}% read</div>
        )}
      </div>
    </div>
  )
}

function LibbyHoldCard({ hold }) {
  return (
    <div className="reading-book-card">
      <div className="reading-book-cover">
        {hold.cover_url
          ? <img src={hold.cover_url} alt={hold.title} className="reading-book-cover-img" />
          : <div className="reading-book-cover-placeholder"><IconBook /></div>
        }
        <div className="reading-cover-status reading-cover-status--want_to_read">
          {hold.queue_position > 0 ? `#${hold.queue_position}` : 'Hold'}
        </div>
      </div>
      <div className="reading-book-meta">
        <div className="reading-book-title">{hold.title}</div>
        <div className="reading-book-author">{hold.author}</div>
        {hold.queue_position > 0 && (
          <div className="reading-book-pct">#{hold.queue_position} of {hold.queue_size}</div>
        )}
        {hold.estimated_wait_days >= 0 && (
          <div className="reading-book-author">~{hold.estimated_wait_days}d wait</div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Connected services panel
// =============================================================================

const CONNECTABLE = [
  {
    key: 'libby',
    label: 'Libby',
    color: '#00aaff',
    type: 'live',
    description: 'Public library loans & holds — no password needed.',
    syncs: 'Current loans · Holds queue · Reading progress',
  },
  {
    key: 'audible',
    label: 'Audible',
    color: '#f58220',
    type: 'live',
    description: 'Audiobook library via Amazon account.',
    syncs: 'Full library · Listening progress',
    caveat: 'Accounts with 2-step verification may need it temporarily disabled during setup.',
  },
  {
    key: 'kindle',
    label: 'Kindle',
    color: '#ff9900',
    type: 'sync',
    description: 'Kindle e-book library — shared with your Audible/Amazon account.',
    syncs: 'Full library · Reading progress',
    requires: 'audible',
    requiresLabel: 'Requires Audible to be connected first',
  },
  {
    key: 'kobo',
    label: 'Kobo',
    color: '#e8a020',
    type: 'import',
    description: 'Import via Goodreads export. Kobo syncs to Goodreads natively.',
    syncs: 'Library · Reading status · Ratings',
    importService: 'kobo',
    importInstructions: [
      'Open Kobo app or kobobooks.com',
      'Go to Settings → Goodreads and link your account',
      'Go to goodreads.com → My Books → Import/Export → Export Library',
      'Upload the goodreads_library_export.csv file here',
    ],
  },
  {
    key: 'google_play',
    label: 'Google Play',
    color: '#4285f4',
    type: 'import',
    description: 'Import via Google Takeout — Google\'s official data export.',
    syncs: 'Library · Reading status · Progress · Ratings',
    importService: 'google_play',
    importInstructions: [
      'Go to takeout.google.com',
      'Deselect all, then select "Play Books"',
      'Create export and download the zip',
      'Find the CSV file inside and upload it here',
    ],
  },
  {
    key: 'apple_books',
    label: 'Apple Books',
    color: '#fc3c44',
    type: 'import',
    description: 'Import via Goodreads — Apple Books supports Goodreads reading history.',
    syncs: 'Library · Reading status · Ratings',
    importService: 'apple_books',
    importInstructions: [
      'Open the Books app on your iPhone or iPad',
      'Tap your profile → Goodreads → Connect',
      'Go to goodreads.com → My Books → Import/Export → Export Library',
      'Upload the goodreads_library_export.csv file here',
    ],
  },
]

function ConnectedServices({ connections, onConnect, onDisconnect, onSync, onImport }) {
  const [open, setOpen]               = useState(false)
  const [disconnecting, setDisconnecting] = useState(null)
  const [syncing, setSyncing]         = useState(null)
  const [syncResult, setSyncResult]   = useState({})   // { kindle: {added,skipped} }

  const handleDisconnect = async (key) => {
    setDisconnecting(key)
    try { await onDisconnect(key) } finally { setDisconnecting(null) }
  }

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

  const liveCount = CONNECTABLE.filter(s => s.type === 'live' && connections[s.key]).length
  const syncCount = CONNECTABLE.filter(s => s.type === 'sync' && connections[s.key]).length
  const linkedCount = liveCount + syncCount

  return (
    <div className="reading-integrations">
      <button className="reading-integrations-toggle" onClick={() => setOpen(o => !o)}>
        <span className="reading-integrations-title">
          <IconPlug />
          CONNECTED SERVICES
        </span>
        <span className="reading-integrations-summary">
          {linkedCount} live · {CONNECTABLE.filter(s => s.type === 'import').length} via import
        </span>
        <span className="reading-integrations-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="reading-integrations-body">
          <div className="reading-integrations-grid">
            {CONNECTABLE.map(svc => {
              const connected = !!connections[svc.key]
              const blockedBy = svc.requires && !connections[svc.requires]
              const res = syncResult[svc.key]

              return (
                <div
                  key={svc.key}
                  className={`reading-svc-card${connected ? ' reading-svc-card--connected' : ''}`}
                  style={{ '--svc-color': svc.color }}
                >
                  <div className="reading-svc-card-top">
                    <span className="reading-svc-dot" style={{ background: svc.color }} />
                    <span className="reading-svc-name">{svc.label}</span>
                    <span className={`reading-svc-type-pill reading-svc-type-pill--${svc.type}`}>
                      {svc.type === 'live' ? 'LIVE' : svc.type === 'sync' ? 'SYNC' : 'IMPORT'}
                    </span>
                    {connected && svc.type !== 'import' &&
                      <span className="reading-svc-badge reading-svc-badge--on">LINKED</span>
                    }
                  </div>

                  <p className="reading-svc-desc">{svc.description}</p>
                  <p className="reading-svc-syncs">{svc.syncs}</p>
                  {svc.caveat && !connected && <p className="reading-svc-caveat">{svc.caveat}</p>}
                  {blockedBy && <p className="reading-svc-caveat">{svc.requiresLabel}</p>}

                  {/* Sync result feedback */}
                  {res && !res.error && (
                    <p className="reading-svc-result">
                      ✓ {res.added} added · {res.skipped} already on shelf
                    </p>
                  )}
                  {res?.error && <p className="reading-svc-caveat">✗ {res.error}</p>}

                  <div className="reading-svc-actions">
                    {/* LIVE: connect / disconnect */}
                    {svc.type === 'live' && (
                      connected ? (
                        <button className="reading-svc-btn reading-svc-btn--disconnect"
                          onClick={() => handleDisconnect(svc.key)} disabled={disconnecting === svc.key}>
                          {disconnecting === svc.key ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      ) : (
                        <button className="reading-svc-btn reading-svc-btn--connect"
                          style={{ '--svc-color': svc.color }} onClick={() => onConnect(svc.key)}>
                          Connect {svc.label}
                        </button>
                      )
                    )}

                    {/* SYNC (Kindle): sync library / disconnect */}
                    {svc.type === 'sync' && (
                      <div className="reading-svc-action-row">
                        {!blockedBy && (
                          <button className="reading-svc-btn reading-svc-btn--connect"
                            style={{ '--svc-color': svc.color }}
                            onClick={() => handleSync(svc.key)} disabled={syncing === svc.key}>
                            {syncing === svc.key ? 'Syncing…' : '↻ Sync Library'}
                          </button>
                        )}
                        {blockedBy && (
                          <button className="reading-svc-btn reading-svc-btn--connect"
                            style={{ '--svc-color': '#f58220' }} onClick={() => onConnect('audible')}>
                            Connect Audible First
                          </button>
                        )}
                      </div>
                    )}

                    {/* IMPORT: CSV upload */}
                    {svc.type === 'import' && (
                      <button className="reading-svc-btn reading-svc-btn--connect"
                        style={{ '--svc-color': svc.color }}
                        onClick={() => onImport(svc)}>
                        Import from {svc.label}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Libby connect modal (2-step chip pairing)
// =============================================================================

function LibbyConnectModal({ onDone, onClose }) {
  const [step, setStep]       = useState(1)   // 1 = start, 2 = enter code
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
              <div className="reading-connect-icon" style={{ color: '#00aaff' }}>
                <IconLibby />
              </div>
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
              <div className="reading-connect-icon" style={{ color: '#00aaff' }}>
                <IconLibby />
              </div>
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
// CSV Import modal (Kobo via Goodreads, Google Play Takeout, Apple Books)
// =============================================================================

function CsvImportModal({ svc, onDone, onClose }) {
  const [file, setFile]       = useState(null)
  const [busy, setBusy]       = useState(false)
  const [result, setResult]   = useState(null)
  const [err, setErr]         = useState('')
  const inputRef              = useRef(null)

  const submit = async () => {
    if (!file) { setErr('Choose a CSV file first.'); return }
    setBusy(true); setErr(''); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('service', svc.importService || svc.key)
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

          {/* Step-by-step instructions */}
          <div className="reading-connect-steps">
            {svc.importInstructions.map((step, i) => (
              <div key={i} className="reading-connect-step">
                <span style={{ background: `color-mix(in srgb, ${svc.color} 18%, transparent)`, color: svc.color }}>{i + 1}</span>
                {step}
              </div>
            ))}
          </div>

          {/* File picker */}
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
                <button className="reading-svc-btn reading-svc-btn--disconnect"
                  onClick={() => setFile(null)}>Clear</button>
              )}
            </div>
          )}

          {err && <div className="reading-form-error">{err}</div>}

          {/* Success result */}
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
              <div className="reading-import-result-format">
                Format detected: {result.format_detected}
              </div>
            </div>
          )}

          <div className="reading-modal-actions">
            {result
              ? <button className="btn btn--primary" onClick={onDone}>Done</button>
              : <>
                  <button className="btn" onClick={onClose}>Cancel</button>
                  <button
                    className="btn btn--primary"
                    onClick={submit}
                    disabled={busy || !file}
                  >
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
// Delete confirm modal
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

function BookModal({ book, defaultService, onSave, onClose }) {
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

  const svc = SERVICE_MAP[form.service] || SERVICE_MAP['other']

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
              {SERVICES.filter(s => s.key !== 'all').map(s => (
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

function IconPlug() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 2v4M13 2v4M5 6h10l-1 8H6L5 6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <line x1="10" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
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
