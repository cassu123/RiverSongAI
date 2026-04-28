import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './MemoryPage.css'

const TABS = ['FACTS', 'PREFERENCES', 'SUMMARIES']

const CONFIDENCE_COLOR = {
  high:   'var(--secondary)',
  medium: 'var(--warn)',
  low:    'var(--text-muted)',
}

const TTL_LABEL = {
  short:    '7d',
  standard: '30d',
  long:     '90d',
  forever:  '∞',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtExpiry(iso) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diff = Math.ceil((d - Date.now()) / 86400000)
  if (diff < 0)  return 'expired'
  if (diff === 0) return 'today'
  return `${diff}d`
}

export default function MemoryPage() {
  const { token } = useAuth()
  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token}`,
  }), [token])

  const [tab,      setTab]      = useState('FACTS')
  const [facts,    setFacts]    = useState([])
  const [prefs,    setPrefs]    = useState([])
  const [summaries,setSummaries]= useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [selected,    setSelected]    = useState(new Set())
  const [deleting,    setDeleting]    = useState(false)
  const [showAddFact, setShowAddFact] = useState(false)
  const [newKey,      setNewKey]      = useState('')
  const [newValue,    setNewValue]    = useState('')
  const [addingFact,  setAddingFact]  = useState(false)
  const [addError,    setAddError]    = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const headers = authHeaders()
      const [f, p, s] = await Promise.all([
        fetch('/api/memory/facts',       { headers }).then(r => r.json()),
        fetch('/api/memory/preferences', { headers }).then(r => r.json()),
        fetch('/api/memory/summaries',   { headers }).then(r => r.json()),
      ])
      setFacts(Array.isArray(f) ? f : [])
      setPrefs(Array.isArray(p) ? p : [])
      setSummaries(Array.isArray(s) ? s : [])
    } catch {
      setFacts([]); setPrefs([]); setSummaries([])
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Clear selection when tab changes
  useEffect(() => { setSelected(new Set()); setSearch('') }, [tab])

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const ids = filtered().map(x => x.id)
    setSelected(prev => {
      const allSelected = ids.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }

  const deleteFacts = async () => {
    if (!selected.size || tab !== 'FACTS') return
    setDeleting(true)
    try {
      await Promise.all(
        [...selected].map(id =>
          fetch(`/api/memory/facts/${id}`, { method: 'DELETE', headers: authHeaders() })
        )
      )
      setFacts(prev => prev.filter(f => !selected.has(f.id)))
      setSelected(new Set())
    } finally {
      setDeleting(false)
    }
  }

  const addFact = async (e) => {
    e.preventDefault()
    if (!newKey.trim() || !newValue.trim()) return
    setAddingFact(true)
    setAddError('')
    try {
      const res = await fetch('/api/memory/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim() }),
      })
      if (!res.ok) throw new Error('Failed')
      const created = await res.json()
      if (created?.id) setFacts(prev => [...prev, created])
      else await fetchAll()
      setNewKey('')
      setNewValue('')
      setShowAddFact(false)
    } catch {
      setAddError('Failed to save fact. Try again.')
    } finally {
      setAddingFact(false)
    }
  }

  const q = search.toLowerCase()

  const filtered = () => {
    if (tab === 'FACTS')       return facts.filter(f => !q || f.key.includes(q) || f.value.toLowerCase().includes(q))
    if (tab === 'PREFERENCES') return prefs.filter(p => !q || p.category.includes(q) || p.value.toLowerCase().includes(q))
    return summaries.filter(s => !q || s.summary.toLowerCase().includes(q))
  }

  const items = filtered()
  const allSelected = items.length > 0 && items.every(x => selected.has(x.id))

  return (
    <div className="page-wrap memory-page-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>EPISODIC STORE</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>READABLE</span>
          </div>
          <h1 className="page-title">Memory</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            River remembers what matters.
          </div>
        </div>

        {/* Stats */}
        <div className="mem-page-stats">
          <div className="mem-page-stat">
            <span className="mem-page-stat-val">{facts.length}</span>
            <span className="mem-page-stat-label">FACTS</span>
          </div>
          <div className="mem-page-stat">
            <span className="mem-page-stat-val">{prefs.length}</span>
            <span className="mem-page-stat-label">PREFS</span>
          </div>
          <div className="mem-page-stat">
            <span className="mem-page-stat-val">{summaries.length}</span>
            <span className="mem-page-stat-label">SESSIONS</span>
          </div>
        </div>
      </div>

      {/* Tabs + search row */}
      <div className="mem-page-toolbar">
        <div className="mem-page-tabs">
          {TABS.map(t => (
            <button
              key={t}
              className={`mem-page-tab ${tab === t ? 'mem-page-tab--on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mem-page-search-row">
          <input
            className="mem-page-search"
            placeholder="search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {tab === 'FACTS' && (
            <button
              className="btn mem-page-add-btn"
              onClick={() => { setShowAddFact(v => !v); setAddError('') }}
            >
              {showAddFact ? 'CANCEL' : '+ ADD FACT'}
            </button>
          )}
          {tab === 'FACTS' && selected.size > 0 && (
            <button
              className="btn mem-page-forget-btn"
              disabled={deleting}
              onClick={deleteFacts}
            >
              {deleting ? 'REMOVING...' : `FORGET (${selected.size})`}
            </button>
          )}
        </div>
      </div>

      {/* Add Fact inline form */}
      {tab === 'FACTS' && showAddFact && (
        <form className="mem-add-fact-form" onSubmit={addFact}>
          <input
            className="mem-add-fact-input"
            placeholder="key  (e.g. job, city, favourite_food)"
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            required
          />
          <input
            className="mem-add-fact-input mem-add-fact-input--wide"
            placeholder="value"
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            required
          />
          <button className="btn mem-add-fact-submit" type="submit" disabled={addingFact}>
            {addingFact ? 'SAVING…' : 'SAVE'}
          </button>
          {addError && <span className="mem-add-fact-error">{addError}</span>}
        </form>
      )}

      {/* Table */}
      <div className="card mem-page-card">
        {loading ? (
          <div className="mem-page-empty">
            <span className="dot dot--standby" /> Loading memory…
          </div>
        ) : items.length === 0 ? (
          <div className="mem-page-empty">
            {search ? 'No matches.' : 'Nothing stored yet.'}
          </div>
        ) : (
          <>
            {/* Column header */}
            <div className={`mem-row mem-row--header mem-row--${tab.toLowerCase()}`}>
              {tab === 'FACTS' && (
                <>
                  <span className="mem-col-check">
                    <input type="checkbox" checked={allSelected} onChange={selectAll} />
                  </span>
                  <span className="mem-col-key">KEY</span>
                  <span className="mem-col-value">VALUE</span>
                  <span className="mem-col-badge">SOURCE</span>
                  <span className="mem-col-date">UPDATED</span>
                </>
              )}
              {tab === 'PREFERENCES' && (
                <>
                  <span className="mem-col-key">CATEGORY</span>
                  <span className="mem-col-value">VALUE</span>
                  <span className="mem-col-badge">CONFIDENCE</span>
                  <span className="mem-col-date">UPDATED</span>
                </>
              )}
              {tab === 'SUMMARIES' && (
                <>
                  <span className="mem-col-date">DATE</span>
                  <span className="mem-col-summary">SUMMARY</span>
                  <span className="mem-col-badge">TTL</span>
                  <span className="mem-col-badge">EXPIRES</span>
                </>
              )}
            </div>

            {/* Rows */}
            <div className="mem-rows">
              {items.map(item => (
                tab === 'FACTS' ? (
                  <div
                    key={item.id}
                    className={`mem-row mem-row--facts ${selected.has(item.id) ? 'mem-row--selected' : ''}`}
                    onClick={() => toggleSelect(item.id)}
                  >
                    <span className="mem-col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        onClick={e => e.stopPropagation()}
                      />
                    </span>
                    <span className="mem-col-key">{item.key}</span>
                    <span className="mem-col-value">{item.value}</span>
                    <span className="mem-col-badge">
                      <span className={`mem-badge mem-badge--${item.source}`}>{item.source}</span>
                    </span>
                    <span className="mem-col-date">{fmtDate(item.updated_at)}</span>
                  </div>
                ) : tab === 'PREFERENCES' ? (
                  <div key={item.id} className="mem-row mem-row--preferences">
                    <span className="mem-col-key">{item.category}</span>
                    <span className="mem-col-value">{item.value}</span>
                    <span className="mem-col-badge">
                      <span
                        className="mem-badge"
                        style={{ borderColor: CONFIDENCE_COLOR[item.confidence], color: CONFIDENCE_COLOR[item.confidence] }}
                      >
                        {item.confidence}
                      </span>
                    </span>
                    <span className="mem-col-date">{fmtDate(item.last_updated)}</span>
                  </div>
                ) : (
                  <div key={item.id} className="mem-row mem-row--summaries">
                    <span className="mem-col-date">{fmtDate(item.created_at)}</span>
                    <span className="mem-col-summary">{item.summary}</span>
                    <span className="mem-col-badge">
                      <span className="mem-badge">{TTL_LABEL[item.ttl_setting] || item.ttl_setting}</span>
                    </span>
                    <span className="mem-col-badge">
                      <span className={`mem-badge ${fmtExpiry(item.expires_at) === 'expired' ? 'mem-badge--expired' : ''}`}>
                        {fmtExpiry(item.expires_at)}
                      </span>
                    </span>
                  </div>
                )
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
