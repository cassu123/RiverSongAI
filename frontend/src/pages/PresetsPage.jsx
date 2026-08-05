import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '../components/FlagGatedPage.jsx'

/**
 * PresetsPage — Q2#9. CRUD UI for saved session presets.
 */

const THINKING_OPTIONS = ['', 'off', 'thinking', 'pro']

export default function PresetsPage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [presets,  setPresets]  = useState([])
  const [draft,    setDraft]    = useState(null)
  const [editId,   setEditId]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [disabled, setDisabled] = useState(false)
  const [error,    setError]    = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/presets`, { headers: authHeaders() })
      if (res.status === 404) { setDisabled(true); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load presets.')
      const data = await res.json()
      setPresets(data.presets || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { refresh() }, [refresh])

  const startNew = () => {
    setEditId(null)
    setDraft({
      name: '',
      config: {
        provider: '', model: '', voice_id: '',
        thinking_mode: '', web_search: false, tool_use_enabled: false,
        system_prompt_addendum: '',
      },
    })
    setError('')
  }

  const editExisting = (p) => {
    setEditId(p.id)
    setDraft({
      name: p.name,
      is_default: p.is_default,
      config: { ...p.config },
    })
    setError('')
  }

  const cancel = () => { setEditId(null); setDraft(null); setError('') }

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) { setError('Name is required.'); return }
    try {
      const method = editId ? 'PUT' : 'POST'
      const url    = editId ? `${API_BASE}/api/presets/${editId}` : `${API_BASE}/api/presets`
      // Strip empty strings so the backend can leave the field untouched.
      const cleanConfig = Object.fromEntries(
        Object.entries(draft.config || {}).filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      )
      const body = editId
        ? { name: draft.name, config: cleanConfig, is_default: !!draft.is_default }
        : { name: draft.name, config: cleanConfig }
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Save failed.') }
      await refresh()
      cancel()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this preset?')) return
    try {
      const res = await fetch(`${API_BASE}/api/presets/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok && res.status !== 204) throw new Error('Delete failed.')
      await refresh()
      if (editId === id) cancel()
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    setAction(<button className="rs-pill" onClick={startNew}>+ NEW PRESET</button>)
  }, [setAction])

  if (loading) return <div className="rs-foyer animate-fade-in"><div className="rs-card-meta">LOADING PRESETS…</div></div>

  if (disabled) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Session Presets</h1>
          <div className="rs-greeting-sub">Disabled. Ask the admin to enable it in settings.</div>
        </div>
      </div>
    )
  }

  const set = (k, v) => setDraft(d => ({ ...d, config: { ...d.config, [k]: v } }))

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Session Presets</h1>
        <div className="rs-greeting-sub">Snapshots of (model · voice · thinking · web · tools) — apply one to switch context fast.</div>
      </div>

      {draft && (
        <div className="rs-card is-wide" style={{ padding: 16, marginBottom: 16 }}>
          <div className="rs-card-label" style={{ marginBottom: 10 }}>{editId ? 'EDIT PRESET' : 'NEW PRESET'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="Preset name (e.g. Deep dive, Quick draft)"
              style={inputStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input type="text" value={draft.config.provider || ''} onChange={e => set('provider', e.target.value)} placeholder="Provider (ollama, claude…)" style={inputStyle} />
              <input type="text" value={draft.config.model    || ''} onChange={e => set('model',    e.target.value)} placeholder="Model id"                        style={inputStyle} />
              <input type="text" value={draft.config.voice_id || ''} onChange={e => set('voice_id', e.target.value)} placeholder="Voice id"                        style={inputStyle} />
              <select
                value={draft.config.thinking_mode || ''}
                onChange={e => set('thinking_mode', e.target.value)}
                style={inputStyle}
              >
                {THINKING_OPTIONS.map(o => <option key={o} value={o}>{o || '(thinking mode)'}</option>)}
              </select>
            </div>
            <textarea
              value={draft.config.system_prompt_addendum || ''}
              onChange={e => set('system_prompt_addendum', e.target.value)}
              placeholder="Optional system prompt addendum…"
              rows={3}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={checkLabel}>
                <input type="checkbox" checked={!!draft.config.web_search} onChange={e => set('web_search', e.target.checked)} /> Web search
              </label>
              <label style={checkLabel}>
                <input type="checkbox" checked={!!draft.config.tool_use_enabled} onChange={e => set('tool_use_enabled', e.target.checked)} /> Tool use
              </label>
              {editId && (
                <label style={checkLabel}>
                  <input type="checkbox" checked={!!draft.is_default} onChange={e => setDraft(d => ({ ...d, is_default: e.target.checked }))} /> Default
                </label>
              )}
            </div>
            {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem' }}>{error.toUpperCase()}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="rs-pill is-active" onClick={save}>{editId ? 'UPDATE' : 'CREATE'}</button>
              <button className="rs-pill" onClick={cancel}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      <div className="rs-card-flow">
        {presets.length === 0 && !draft && <div className="rs-card-meta">No presets yet. Tap + NEW PRESET.</div>}
        {presets.map(p => (
          <div key={p.id} className="rs-card is-wide" style={{ padding: 16 }}>
            <div className="rs-card-head">
              <span className="rs-card-label">
                {p.is_default && <span style={{ marginRight: 4 }}>★</span>}
                {p.name?.toUpperCase()}
              </span>
              <span className="rs-card-label" style={{ opacity: 0.4 }}>{new Date(p.updated_at).toLocaleDateString()}</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {Object.entries(p.config || {}).map(([k, v]) => (
                <span key={k} className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                  {k.toUpperCase()}: {String(v).slice(0, 30).toUpperCase()}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="rs-pill" onClick={() => editExisting(p)}>EDIT</button>
              <button className="rs-pill" onClick={() => remove(p.id)} style={{ opacity: 0.6 }}>DELETE</button>
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
  fontSize: '0.85rem',
  outline: 'none',
  fontFamily: 'inherit',
}

const checkLabel = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer',
}
