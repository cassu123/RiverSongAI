import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '@components/FlagGatedPage.jsx'

/**
 * SkillsPage — Q2#7.
 *
 * User-editable skill library. Each skill is a name + (optional)
 * trigger phrases + a prompt body. Skills are vector-retrieved at
 * conversation time and prepended to the system prompt.
 */

export default function SkillsPage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [skills,   setSkills]   = useState([])
  const [activeId, setActiveId] = useState(null)
  const [draft,    setDraft]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [disabled, setDisabled] = useState(false)
  const [saving,   setSaving]   = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/skills`, { headers: authHeaders() })
      if (res.status === 404) { setDisabled(true); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load skills.')
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { refresh() }, [refresh])

  const startNew = () => {
    setActiveId(null)
    setDraft({ name: '', prompt: '', trigger_phrases: '', is_active: true })
    setError('')
  }

  const editExisting = (s) => {
    setActiveId(s.id)
    setDraft({ ...s })
    setError('')
  }

  const cancel = () => {
    setActiveId(null)
    setDraft(null)
    setError('')
  }

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.prompt.trim()) {
      setError('Topic and details are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const method = activeId ? 'PUT' : 'POST'
      const url    = activeId ? `${API_BASE}/api/skills/${activeId}` : `${API_BASE}/api/skills`
      const body   = activeId
        ? { name: draft.name, prompt: draft.prompt, trigger_phrases: draft.trigger_phrases, is_active: draft.is_active }
        : { name: draft.name, prompt: draft.prompt, trigger_phrases: draft.trigger_phrases }
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Save failed.') }
      await refresh()
      cancel()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this skill?')) return
    try {
      const res = await fetch(`${API_BASE}/api/skills/${id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok && res.status !== 204) throw new Error('Delete failed.')
      await refresh()
      if (activeId === id) cancel()
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleActive = async (s) => {
    try {
      const res = await fetch(`${API_BASE}/api/skills/${s.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ is_active: !s.is_active }),
      })
      if (!res.ok) throw new Error('Toggle failed.')
      await refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    setAction(
      <div className="rs-flex rs-gap-2">
        <button className="rs-pill" onClick={startNew}>+ ADD</button>
      </div>
    )
  }, [setAction])

  if (loading) {
    return <div className="rs-foyer animate-fade-in"><div className="rs-card-meta">LOADING…</div></div>
  }

  if (disabled) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">About You</h1>
          <div className="rs-greeting-sub">This is disabled. Ask the admin to enable it in settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">About You</h1>
        <div className="rs-greeting-sub">What River knows about you. It matches these to your messages and folds them into how it responds — add anything you want it to remember and use.</div>
      </div>

      {draft && (
        <div className="rs-card is-wide rs-p-4 rs-mb-4">
          <div className="rs-card-label rs-mb-3">
            {activeId ? 'EDIT' : 'NEW'}
          </div>
          <div className="rs-flex rs-flex-col rs-gap-3">
            <input
              type="text"
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="Topic — e.g. My work, My family, How I like answers"
              style={inputStyle}
            />
            <input
              type="text"
              value={draft.trigger_phrases}
              onChange={e => setDraft(d => ({ ...d, trigger_phrases: e.target.value }))}
              placeholder="When to recall this (optional keywords, comma-separated)"
              style={inputStyle}
            />
            <textarea
              value={draft.prompt}
              onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))}
              placeholder="What River should know — e.g. I'm a night-shift nurse; keep answers short and practical."
              rows={6}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            {error && <div className="rs-type-micro rs-c-error">{error.toUpperCase()}</div>}
            <div className="rs-flex rs-gap-3">
              <button className="rs-pill is-active" onClick={save} disabled={saving}>
                {saving ? 'SAVING…' : (activeId ? 'UPDATE' : 'CREATE')}
              </button>
              <button className="rs-pill" onClick={cancel} disabled={saving}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      <div className="rs-card-flow">
        {skills.length === 0 && !draft && (
          <div className="rs-card-meta">Nothing yet. Tap + ADD to tell River about you.</div>
        )}
        {skills.map(s => (
          <div key={s.id} className="rs-card is-wide rs-p-4" style={{ opacity: s.is_active ? 1 : 0.55 }}>
            <div className="rs-card-head">
              <span className="rs-card-label">{s.name?.toUpperCase()}</span>
              <span className="rs-card-label" style={{ opacity: 0.4 }}>
                {s.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>
            {s.trigger_phrases && (
              <div className="rs-mt-2 rs-mb-2 rs-flex rs-flex-wrap rs-gap-2">
                {s.trigger_phrases.split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
                  <span key={i} className="rs-pill rs-type-nano" style={{ padding: '2px 8px' }}>{t}</span>
                ))}
              </div>
            )}
            <div className="rs-mt-2 rs-type-small" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap', opacity: 0.9 }}>
              {s.prompt}
            </div>
            <div className="rs-mt-3 rs-flex rs-gap-2">
              <button className="rs-pill" onClick={() => editExisting(s)}>EDIT</button>
              <button className="rs-pill" onClick={() => toggleActive(s)}>
                {s.is_active ? 'DEACTIVATE' : 'ACTIVATE'}
              </button>
              <button className="rs-pill" onClick={() => remove(s.id)} style={{ opacity: 0.6 }}>DELETE</button>
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
  fontSize: 'var(--rs-fs-small)',
  outline: 'none',
  fontFamily: 'inherit',
}
