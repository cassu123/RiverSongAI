import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '@components/FlagGatedPage.jsx'

/**
 * RemoteOllamaPage — Q3#14. Admin CRUD for remote Ollama rigs.
 * Reuses the existing pill/card chrome; no new CSS.
 */

export default function RemoteOllamaPage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [rigs,     setRigs]     = useState([])
  const [draft,    setDraft]    = useState(null)
  const [editId,   setEditId]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [error,    setError]    = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/remote-ollama/rigs`, { headers: authHeaders() })
      if (res.status === 404) { setDisabled(true); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load rigs.')
      const data = await res.json()
      setRigs(data.rigs || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { refresh() }, [refresh])

  const startNew = () => { setEditId(null); setDraft({ label: '', base_url: 'http://localhost:11434', notes: '' }); setError('') }
  const editOne  = (r) => { setEditId(r.id); setDraft({ label: r.label, base_url: r.base_url, notes: r.notes, is_active: r.is_active }); setError('') }
  const cancel   = () => { setEditId(null); setDraft(null); setError('') }

  const save = async () => {
    if (!draft) return
    if (!draft.label.trim() || !draft.base_url.trim()) { setError('Label and base URL are required.'); return }
    try {
      const method = editId ? 'PUT' : 'POST'
      const url    = editId ? `${API_BASE}/api/remote-ollama/rigs/${editId}` : `${API_BASE}/api/remote-ollama/rigs`
      const body   = editId
        ? { label: draft.label, base_url: draft.base_url, notes: draft.notes, is_active: !!draft.is_active }
        : { label: draft.label, base_url: draft.base_url, notes: draft.notes }
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Save failed.') }
      await refresh()
      cancel()
    } catch (e) { setError(e.message) }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this rig?')) return
    try {
      const res = await fetch(`${API_BASE}/api/remote-ollama/rigs/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok && res.status !== 204) throw new Error('Delete failed.')
      await refresh()
    } catch (e) { setError(e.message) }
  }

  const probe = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/remote-ollama/rigs/${id}/health`, { method: 'POST', headers: authHeaders() })
      if (!res.ok) throw new Error('Health probe failed.')
      await refresh()
    } catch (e) { setError(e.message) }
  }

  useEffect(() => { setAction(<button className="rs-pill" onClick={startNew}>+ ADD RIG</button>) }, [setAction])

  if (loading) return <div className="rs-foyer animate-fade-in"><div className="rs-card-meta">LOADING RIGS…</div></div>

  if (disabled) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Remote Ollama</h1>
          <div className="rs-greeting-sub">Disabled. Set REMOTE_OLLAMA_ENABLED=true and restart.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Remote Ollama Rigs</h1>
        <div className="rs-greeting-sub">SSH-tunneled rigs registered here are available as compare-page providers.</div>
      </div>

      {draft && (
        <div className="rs-card is-wide rs-p-4 rs-mb-4">
          <div className="rs-card-label rs-mb-3">{editId ? 'EDIT RIG' : 'NEW RIG'}</div>
          <div className="rs-flex rs-flex-col rs-gap-3">
            <input type="text" value={draft.label}    onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}    placeholder="Label — e.g. workstation"   style={inputStyle} />
            <input type="text" value={draft.base_url} onChange={e => setDraft(d => ({ ...d, base_url: e.target.value }))} placeholder="Base URL — e.g. http://localhost:11500" style={inputStyle} />
            <textarea          value={draft.notes}    onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}    placeholder="Notes (optional)" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            {editId && (
              <label className="rs-flex rs-items-center rs-gap-2" style={{ fontSize: 'var(--rs-fs-micro)' }}>
                <input type="checkbox" checked={!!draft.is_active} onChange={e => setDraft(d => ({ ...d, is_active: e.target.checked }))} /> Active
              </label>
            )}
            {error && <div style={{ color: 'var(--md-error)', fontSize: 'var(--rs-fs-micro)' }}>{error.toUpperCase()}</div>}
            <div className="rs-flex rs-gap-3">
              <button className="rs-pill is-active" onClick={save}>{editId ? 'UPDATE' : 'CREATE'}</button>
              <button className="rs-pill" onClick={cancel}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      <div className="rs-card-flow">
        {rigs.length === 0 && !draft && <div className="rs-card-meta">No rigs registered yet.</div>}
        {rigs.map(r => (
          <div key={r.id} className="rs-card is-wide rs-p-4" style={{ opacity: r.is_active ? 1 : 0.55 }}>
            <div className="rs-card-head">
              <span className="rs-card-label">{r.label?.toUpperCase()}</span>
              <span className="rs-pill" style={{
                fontSize: 'var(--rs-fs-nano)',
                background: r.last_health === 'ok' ? 'var(--md-secondary)' : r.last_health === 'down' ? 'var(--md-error)' : 'rgba(255,255,255,0.1)',
                color: 'var(--bg-base)',
              }}>{r.last_health?.toUpperCase() || 'UNKNOWN'}</span>
            </div>
            <div className="rs-mt-1" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-micro)' }}>{r.base_url}</div>
            {r.notes && <div className="rs-mt-2" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-micro)' }}>{r.notes}</div>}
            {(r.last_models || []).length > 0 && (
              <div className="rs-flex rs-flex-wrap rs-gap-1 rs-mt-2">
                {r.last_models.slice(0, 6).map((m, i) => (
                  <span key={i} className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '1px 6px' }}>{m}</span>
                ))}
                {r.last_models.length > 6 && (
                  <span className="rs-pill" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)', padding: '1px 6px' }}>+{r.last_models.length - 6}</span>
                )}
              </div>
            )}
            <div className="rs-mt-3 rs-flex rs-gap-2">
              <button className="rs-pill" onClick={() => probe(r.id)}>HEALTH-CHECK</button>
              <button className="rs-pill" onClick={() => editOne(r)}>EDIT</button>
              <button className="rs-pill" onClick={() => remove(r.id)} style={{ opacity: 0.6 }}>DELETE</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const inputStyle = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: 'var(--md-on-surface)',
  fontSize: 'var(--rs-fs-tiny)',
  outline: 'none',
  fontFamily: 'inherit',
}
