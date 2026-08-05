import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '../components/FlagGatedPage.jsx'
import { useBreakpoint } from '../hooks/useBreakpoint'

/**
 * DocumentsPage — Q2#6.
 *
 * Multi-document workspace. Left rail lists the user's documents (pinned
 * first), right side is the editor. Auto-save with a 700 ms debounce.
 *
 * Backed by /api/documents (flag-gated by settings.documents_enabled).
 */

const KINDS = [
  { value: 'markdown', label: 'MD' },
  { value: 'text',     label: 'TXT' },
  { value: 'csv',      label: 'CSV' },
  { value: 'html',     label: 'HTML' },
  { value: 'research', label: 'REPORT' },
]

export default function DocumentsPage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const { isPhone } = useBreakpoint()
  const [docs,        setDocs]        = useState([])
  const [activeId,    setActiveId]    = useState(null)
  const [activeDoc,   setActiveDoc]   = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [disabled,    setDisabled]    = useState(false)

  const saveTimer = useRef(null)
  const dirtyRef  = useRef(null)

  const refreshList = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API_BASE}/api/documents`, { headers: authHeaders(), signal })
      if (res.status === 404) { setDisabled(true); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load documents.')
      const data = await res.json()
      setDocs(data.documents || [])
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => {
    const controller = new AbortController()
    refreshList(controller.signal)
    return () => controller.abort()
  }, [refreshList])

  const openDoc = useCallback(async (id) => {
    // Cancel any pending debounced save and drop its dirty patch BEFORE
    // we switch docs — otherwise the timer would persist edits made to
    // the previous doc against the new doc's id (and silently overwrite
    // both: doc A loses its change, doc B gets it). See code review #3.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    dirtyRef.current = null
    setError('')
    setActiveId(id)
    try {
      const res = await fetch(`${API_BASE}/api/documents/${id}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Document not found.')
      const doc = await res.json()
      setActiveDoc(doc)
    } catch (e) {
      setError(e.message)
      setActiveDoc(null)
      setActiveId(null)
    }
  }, [authHeaders])

  const createDoc = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/documents`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: 'Untitled', kind: 'markdown', body: '' }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Create failed.') }
      const doc = await res.json()
      setActiveDoc(doc)
      setActiveId(doc.id)
      await refreshList()
    } catch (e) {
      setError(e.message)
    }
  }, [authHeaders, refreshList])

  const persist = useCallback(async (patch) => {
    if (!activeId) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/documents/${activeId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Save failed.') }
      const doc = await res.json()
      setActiveDoc(doc)
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, title: doc.title, kind: doc.kind, pinned: doc.pinned, updated_at: doc.updated_at, size: (doc.body || '').length } : d))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [activeId, authHeaders])

  // Debounced save — fires 700 ms after the last edit.
  const scheduleSave = useCallback((patch) => {
    dirtyRef.current = { ...(dirtyRef.current || {}), ...patch }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const pending = dirtyRef.current
      dirtyRef.current = null
      if (pending) persist(pending)
    }, 700)
  }, [persist])

  const onChangeBody = (e) => {
    const body = e.target.value
    setActiveDoc(d => d ? { ...d, body } : d)
    scheduleSave({ body })
  }

  const onChangeTitle = (e) => {
    const title = e.target.value
    setActiveDoc(d => d ? { ...d, title } : d)
    scheduleSave({ title })
  }

  const onChangeKind = (e) => {
    const kind = e.target.value
    setActiveDoc(d => d ? { ...d, kind } : d)
    persist({ kind })
  }

  const togglePin = async () => {
    if (!activeDoc) return
    await persist({ pinned: !activeDoc.pinned })
    await refreshList()
  }

  const deleteDoc = async () => {
    if (!activeId) return
    if (!window.confirm('Delete this document?')) return
    try {
      const res = await fetch(`${API_BASE}/api/documents/${activeId}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok && res.status !== 204) throw new Error('Delete failed.')
      setActiveId(null)
      setActiveDoc(null)
      await refreshList()
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    setAction(
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="rs-pill" onClick={createDoc}>+ NEW</button>
        {saving && <span className="rs-card-label" style={{ opacity: 0.55 }}>SAVING…</span>}
      </div>
    )
  }, [setAction, createDoc, saving])

  if (loading) {
    return <div className="rs-foyer animate-fade-in"><div className="rs-card-meta">LOADING DOCUMENTS…</div></div>
  }

  if (disabled) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Documents</h1>
          <div className="rs-greeting-sub">Workspace is disabled. Ask the admin to enable it in settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in" style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'minmax(220px, 280px) 1fr', gap: 16, alignItems: 'stretch' }}>
      {/* Left rail — document list */}
      <div className="rs-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' }}>
        <div className="rs-card-label" style={{ marginBottom: 6 }}>DOCUMENTS · {docs.length}</div>
        {docs.length === 0 && <div className="rs-card-meta" style={{ padding: 12 }}>Nothing yet. Tap + NEW.</div>}
        {docs.map(d => (
          <button
            key={d.id}
            className={`rs-drawer-item ${activeId === d.id ? 'is-active' : ''}`}
            onClick={() => openDoc(d.id)}
            style={{ textAlign: 'left', padding: '8px 10px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
              {d.pinned && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>★</span>}
              <span style={{ fontWeight: 700, fontSize: '0.78rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.title || 'Untitled'}
              </span>
              <span className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.5 }}>{d.kind?.toUpperCase()}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="rs-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!activeDoc ? (
          <div className="rs-card-meta" style={{ padding: 24 }}>Select a document or create a new one.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="text"
                value={activeDoc.title}
                onChange={onChangeTitle}
                placeholder="Title"
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--md-on-surface)',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <select
                value={activeDoc.kind}
                onChange={onChangeKind}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: '9px 10px',
                  color: 'var(--md-on-surface)',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              >
                {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button className="rs-pill" onClick={togglePin} title="Pin">
                {activeDoc.pinned ? '★ PINNED' : 'PIN'}
              </button>
              <button className="rs-pill" onClick={deleteDoc} style={{ opacity: 0.7 }}>DELETE</button>
            </div>

            <textarea
              value={activeDoc.body}
              onChange={onChangeBody}
              placeholder="Type here. Auto-saves."
              spellCheck={true}
              style={{
                flex: 1,
                minHeight: 'calc(100dvh - 300px)',
                background: 'rgba(0,0,0,0.18)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: 14,
                color: 'var(--md-on-surface)',
                fontFamily: activeDoc.kind === 'markdown' || activeDoc.kind === 'csv' || activeDoc.kind === 'html'
                  ? 'ui-monospace, SFMono-Regular, Menlo, monospace'
                  : 'inherit',
                fontSize: '0.88rem',
                lineHeight: 1.55,
                outline: 'none',
                resize: 'vertical',
              }}
            />

            {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem' }}>{error.toUpperCase()}</div>}
          </>
        )}
      </div>
    </div>
  )
}
