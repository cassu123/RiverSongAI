import React, { useState, useEffect, useCallback } from 'react'
import './ReadingPage.css'

const API = '/api/reading'

const SERVICES = [
  { key: 'all',         label: 'All Books',      color: 'var(--primary)' },
  { key: 'kindle',      label: 'Kindle',         color: '#ff9900' },
  { key: 'google_play', label: 'Google Play',    color: '#4285f4' },
  { key: 'audible',     label: 'Audible',        color: '#ff9900' },
  { key: 'libby',       label: 'Libby',          color: '#00aaff' },
  { key: 'kobo',        label: 'Kobo',           color: '#e8a020' },
  { key: 'apple_books', label: 'Apple Books',    color: '#fc3c44' },
  { key: 'other',       label: 'Other',          color: 'var(--text-dim)' },
]

const SERVICE_LAUNCH = {
  kindle:      'https://read.amazon.com',
  google_play: 'https://play.google.com/books',
  audible:     'https://www.audible.com/library',
  libby:       'https://libbyapp.com',
  kobo:        'https://www.kobo.com/ebooks',
  apple_books: 'https://books.apple.com',
}

const STATUSES = [
  { key: 'reading',      label: 'Reading' },
  { key: 'finished',     label: 'Finished' },
  { key: 'want_to_read', label: 'Want to Read' },
  { key: 'dnf',          label: 'DNF' },
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
  const [shelf, setShelf] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeService, setActiveService] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')
  const [showModal, setShowModal] = useState(false)
  const [editBook, setEditBook] = useState(null)
  const [libbyTab, setLibbyTab] = useState('loans')
  const [libbyLoans, setLibbyLoans] = useState(null)
  const [libbyHolds, setLibbyHolds] = useState(null)
  const [libbyLoading, setLibbyLoading] = useState(false)
  const [libbyError, setLibbyError] = useState('')

  const loadShelf = useCallback(() => {
    setLoading(true)
    apiFetch('/shelf')
      .then(setShelf)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadShelf() }, [loadShelf])

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
    try {
      if (editBook) {
        const updated = await apiFetch(`/shelf/${editBook.id}`, { method: 'PATCH', body: JSON.stringify(data) })
        setShelf(s => s.map(b => b.id === updated.id ? updated : b))
      } else {
        const created = await apiFetch('/shelf', { method: 'POST', body: JSON.stringify(data) })
        setShelf(s => [created, ...s])
      }
      setShowModal(false)
      setEditBook(null)
    } catch (e) {
      throw e
    }
  }

  const handleDelete = async (book) => {
    if (!confirm(`Remove "${book.title}" from your shelf?`)) return
    try {
      await apiFetch(`/shelf/${book.id}`, { method: 'DELETE' })
      setShelf(s => s.filter(b => b.id !== book.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const openEdit = (book) => { setEditBook(book); setShowModal(true) }
  const openAdd = () => { setEditBook(null); setShowModal(true) }

  const filtered = shelf.filter(b => {
    const svcMatch = activeService === 'all' || b.service === activeService
    const stMatch = activeStatus === 'all' || b.status === activeStatus
    return svcMatch && stMatch
  })

  const counts = {}
  SERVICES.forEach(s => {
    counts[s.key] = s.key === 'all' ? shelf.length : shelf.filter(b => b.service === s.key).length
  })

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

      {error && <div className="reading-error">{error}</div>}

      {/* Service tabs */}
      <div className="reading-service-tabs">
        {SERVICES.map(s => (
          <button
            key={s.key}
            className={`reading-service-tab${activeService === s.key ? ' reading-service-tab--active' : ''}`}
            style={activeService === s.key ? { '--tab-color': s.color } : {}}
            onClick={() => setActiveService(s.key)}
          >
            <span className="reading-service-dot" style={{ background: s.color }} />
            {s.label}
            {counts[s.key] > 0 && <span className="reading-service-count">{counts[s.key]}</span>}
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
                : libbyError
              }
            </div>
          )}

          {!libbyLoading && !libbyError && libbyTab === 'loans' && libbyLoans && (
            libbyLoans.length === 0
              ? <div className="reading-empty">No active loans right now.</div>
              : <div className="reading-libby-grid">
                  {libbyLoans.map((loan, i) => <LibbyLoanCard key={i} loan={loan} />)}
                </div>
          )}

          {!libbyLoading && !libbyError && libbyTab === 'holds' && libbyHolds && (
            libbyHolds.length === 0
              ? <div className="reading-empty">No holds in queue.</div>
              : <div className="reading-libby-grid">
                  {libbyHolds.map((hold, i) => <LibbyHoldCard key={i} hold={hold} />)}
                </div>
          )}
        </div>
      )}

      {/* Status filter */}
      <div className="reading-status-filter">
        <button
          className={`reading-status-btn${activeStatus === 'all' ? ' reading-status-btn--active' : ''}`}
          onClick={() => setActiveStatus('all')}
        >
          All
        </button>
        {STATUSES.map(s => (
          <button
            key={s.key}
            className={`reading-status-btn${activeStatus === s.key ? ' reading-status-btn--active' : ''}`}
            onClick={() => setActiveStatus(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Shelf */}
      {loading && <div className="reading-loading">Loading shelf…</div>}

      {!loading && filtered.length === 0 && (
        <div className="reading-empty">
          {shelf.length === 0
            ? 'Your shelf is empty. Add a book to get started.'
            : 'No books match this filter.'
          }
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="reading-shelf-grid">
          {filtered.map(book => (
            <BookCard
              key={book.id}
              book={book}
              onEdit={() => openEdit(book)}
              onDelete={() => handleDelete(book)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <BookModal
          book={editBook}
          defaultService={activeService !== 'all' && activeService !== 'libby' ? activeService : 'kindle'}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditBook(null) }}
        />
      )}
    </div>
  )
}

// =============================================================================
// Book card
// =============================================================================

function BookCard({ book, onEdit, onDelete }) {
  const svc = SERVICES.find(s => s.key === book.service) || SERVICES[SERVICES.length - 1]
  const launchUrl = book.launch_url || SERVICE_LAUNCH[book.service] || null

  return (
    <div className="reading-book-card">
      <div className="reading-book-cover">
        {book.cover_url
          ? <img src={book.cover_url} alt={book.title} className="reading-book-cover-img" />
          : <div className="reading-book-cover-placeholder"><IconBook /></div>
        }
        <div className="reading-book-service-badge" style={{ background: svc.color }}>
          {svc.label}
        </div>
      </div>

      <div className="reading-book-info">
        <div className="reading-book-title">{book.title}</div>
        {book.author && <div className="reading-book-author">{book.author}</div>}

        <div className="reading-book-status-row">
          <span className={`reading-book-status reading-book-status--${book.status}`}>
            {STATUSES.find(s => s.key === book.status)?.label || book.status}
          </span>
          {book.rating && (
            <span className="reading-book-rating">{'★'.repeat(book.rating)}{'☆'.repeat(5 - book.rating)}</span>
          )}
        </div>

        {book.status === 'reading' && (
          <div className="reading-progress-wrap">
            <div className="reading-progress-bar">
              <div className="reading-progress-fill" style={{ width: `${book.progress_pct}%` }} />
            </div>
            <span className="reading-progress-label">{Math.round(book.progress_pct)}%</span>
          </div>
        )}

        {book.notes && <div className="reading-book-notes">{book.notes}</div>}

        <div className="reading-book-actions">
          {launchUrl && (
            <a
              href={launchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="reading-launch-btn"
            >
              Open {svc.label} ↗
            </a>
          )}
          <button className="reading-edit-btn" onClick={onEdit}>Edit</button>
          <button className="reading-delete-btn" onClick={onDelete}>✕</button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Libby cards
// =============================================================================

function LibbyLoanCard({ loan }) {
  return (
    <div className="reading-libby-card">
      {loan.cover_url && <img src={loan.cover_url} alt={loan.title} className="reading-libby-cover" />}
      <div className="reading-libby-card-info">
        <div className="reading-libby-card-title">{loan.title}</div>
        <div className="reading-libby-card-author">{loan.author}</div>
        <div className="reading-libby-card-meta">
          {loan.days_remaining >= 0
            ? <span className={loan.days_remaining <= 3 ? 'reading-libby-urgent' : ''}>
                Due in {loan.days_remaining} day{loan.days_remaining !== 1 ? 's' : ''}
              </span>
            : <span>Expiry unknown</span>
          }
          {loan.percent_complete >= 0 && (
            <span> · {Math.round(loan.percent_complete)}% read</span>
          )}
        </div>
        {loan.percent_complete >= 0 && (
          <div className="reading-progress-wrap" style={{ marginTop: 6 }}>
            <div className="reading-progress-bar">
              <div className="reading-progress-fill reading-progress-fill--libby" style={{ width: `${loan.percent_complete}%` }} />
            </div>
          </div>
        )}
        <a href="https://libbyapp.com" target="_blank" rel="noopener noreferrer" className="reading-launch-btn" style={{ marginTop: 8 }}>
          Open in Libby ↗
        </a>
      </div>
    </div>
  )
}

function LibbyHoldCard({ hold }) {
  return (
    <div className="reading-libby-card">
      {hold.cover_url && <img src={hold.cover_url} alt={hold.title} className="reading-libby-cover" />}
      <div className="reading-libby-card-info">
        <div className="reading-libby-card-title">{hold.title}</div>
        <div className="reading-libby-card-author">{hold.author}</div>
        <div className="reading-libby-card-meta">
          {hold.queue_position > 0
            ? <span>#{hold.queue_position} of {hold.queue_size} in line</span>
            : <span>Position unknown</span>
          }
          {hold.estimated_wait_days >= 0 && (
            <span> · ~{hold.estimated_wait_days} day{hold.estimated_wait_days !== 1 ? 's' : ''} wait</span>
          )}
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
  const [err, setErr] = useState('')

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

  return (
    <div className="reading-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="reading-modal">
        <div className="reading-modal-header">
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

          <div className="reading-form-row">
            <label className="reading-form-label">Title *</label>
            <input className="reading-form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Book title" />
          </div>

          <div className="reading-form-row">
            <label className="reading-form-label">Author</label>
            <input className="reading-form-input" value={form.author} onChange={e => set('author', e.target.value)} placeholder="Author name" />
          </div>

          <div className="reading-form-row">
            <label className="reading-form-label">Cover URL</label>
            <input className="reading-form-input" value={form.cover_url} onChange={e => set('cover_url', e.target.value)} placeholder="https://…" />
          </div>

          <div className="reading-form-row">
            <label className="reading-form-label">Status</label>
            <select className="reading-form-select" value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {form.status === 'reading' && (
            <div className="reading-form-row">
              <label className="reading-form-label">Progress %</label>
              <div className="reading-form-progress-row">
                <input
                  type="range" min="0" max="100" step="1"
                  value={form.progress_pct}
                  onChange={e => set('progress_pct', e.target.value)}
                  className="reading-form-range"
                />
                <span className="reading-form-progress-val">{Math.round(form.progress_pct)}%</span>
              </div>
            </div>
          )}

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

          <div className="reading-form-row">
            <label className="reading-form-label">Launch URL</label>
            <input className="reading-form-input" value={form.launch_url} onChange={e => set('launch_url', e.target.value)} placeholder="Direct link to this book (optional)" />
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
