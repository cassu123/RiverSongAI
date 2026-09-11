import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '@components/FlagGatedPage.jsx'

/**
 * WebhookTokensPage — Q2#10 admin UI.
 *
 * Mirrors RemoteOllamaPage chrome: drawer entry under Admin, no new CSS,
 * reuses `rs-pill` / `rs-card` / `rs-foyer`.
 *
 * Plaintext token is returned ONCE on creation by the API; we display it in
 * a one-shot panel and never store it client-side.
 */

const SCOPE_SUGGESTIONS = ['routines.run', 'killswitch.activate', 'commerce.write', 'memory.read']

export default function WebhookTokensPage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [tokens,        setTokens]        = useState([])
  const [draft,         setDraft]         = useState(null)
  const [freshlyMinted, setFreshlyMinted] = useState(null)
  const [audit,         setAudit]         = useState({ open: false, entries: [], tokenId: null, loading: false })
  const [includeRevoked, setIncludeRevoked] = useState(false)
  const [loading,       setLoading]       = useState(true)
  const [disabled,      setDisabled]      = useState(false)
  const [error,         setError]         = useState('')

  const refresh = useCallback(async () => {
    try {
      const qs  = includeRevoked ? '?include_revoked=true' : ''
      const res = await fetch(`${API_BASE}/api/webhook-tokens${qs}`, { headers: authHeaders() })
      if (res.status === 404) { setDisabled(true); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load webhook tokens.')
      const data = await res.json()
      setTokens(data.tokens || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [authHeaders, includeRevoked])

  useEffect(() => { refresh() }, [refresh])

  const startNew = () => {
    setError('')
    setFreshlyMinted(null)
    setDraft({ label: '', scopes: '', expires_at: '' })
  }
  const cancel = () => { setDraft(null); setError('') }

  const create = async () => {
    if (!draft) return
    if (!draft.label.trim()) { setError('Label is required.'); return }
    try {
      const body = {
        label:      draft.label.trim(),
        scopes:     draft.scopes.split(',').map(s => s.trim()).filter(Boolean),
        expires_at: draft.expires_at.trim() || null,
      }
      const res = await fetch(`${API_BASE}/api/webhook-tokens`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.detail || 'Create failed.')
      }
      const row = await res.json()
      setFreshlyMinted(row)
      setDraft(null)
      await refresh()
    } catch (e) { setError(e.message) }
  }

  const revoke = async (id) => {
    if (!window.confirm('Revoke this token? Existing webhook callers using it will start failing immediately.')) return
    try {
      const res = await fetch(`${API_BASE}/api/webhook-tokens/${id}/revoke`, {
        method: 'POST', headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Revoke failed.')
      await refresh()
    } catch (e) { setError(e.message) }
  }

  const openAudit = async (id) => {
    setAudit({ open: true, entries: [], tokenId: id, loading: true })
    try {
      const url = id
        ? `${API_BASE}/api/webhook-tokens/${id}/audit?limit=100`
        : `${API_BASE}/api/webhook-tokens/audit?limit=100`
      const res = await fetch(url, { headers: authHeaders() })
      if (!res.ok) throw new Error('Failed to load audit log.')
      const data = await res.json()
      setAudit({ open: true, entries: data.entries || [], tokenId: id, loading: false })
    } catch (e) {
      setAudit({ open: true, entries: [], tokenId: id, loading: false })
      setError(e.message)
    }
  }
  const closeAudit = () => setAudit({ open: false, entries: [], tokenId: null, loading: false })

  useEffect(() => {
    setAction(<button className="rs-pill" onClick={startNew}>+ ISSUE TOKEN</button>)
  }, [setAction])

  return (
    <FlagGatedPage
      title="Webhook Tokens"
      loading={loading}
      disabled={disabled}
      loadingLabel="LOADING TOKENS…"
      disabledMessage="Disabled. Set WEBHOOK_TOKENS_ENABLED=true and restart."
    >
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Webhook Tokens</h1>
        <div className="rs-greeting-sub">
          Scoped tokens for external services (n8n, Zapier, ntfy callbacks).
          Plaintext is shown once on creation — capture it then.
        </div>
      </div>

      {/* Freshly-minted plaintext — shown once, only this page render */}
      {freshlyMinted && (
        <div className="rs-card is-wide rs-p-4 rs-mb-4" style={{ borderLeft: '3px solid var(--md-secondary)' }}>
          <div className="rs-card-label rs-mb-2">NEW TOKEN — COPY NOW</div>
          <div className="rs-p-3" style={{ fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all', background: 'rgba(0,0,0,0.35)', borderRadius: 'var(--md-shape-xs)' }}>
            {freshlyMinted.token}
          </div>
          <div className="rs-mt-3 rs-flex rs-gap-2">
            <button
              className="rs-pill is-active"
              onClick={() => navigator.clipboard?.writeText(freshlyMinted.token)}
            >COPY</button>
            <button className="rs-pill" onClick={() => setFreshlyMinted(null)}>DISMISS</button>
          </div>
          <div className="rs-mt-2 rs-muted rs-type-nano">
            This is the only time the plaintext is shown. Only a sha256 digest is stored.
          </div>
        </div>
      )}

      {/* Create form */}
      {draft && (
        <div className="rs-card is-wide rs-p-4 rs-mb-4">
          <div className="rs-card-label rs-mb-3">NEW TOKEN</div>
          <div className="rs-flex rs-flex-col rs-gap-3">
            <input
              type="text"
              value={draft.label}
              onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
              placeholder="Label — e.g. n8n-routine-trigger"
              style={inputStyle}
            />
            <input
              type="text"
              value={draft.scopes}
              onChange={e => setDraft(d => ({ ...d, scopes: e.target.value }))}
              placeholder={`Scopes (comma-separated) — e.g. ${SCOPE_SUGGESTIONS.slice(0, 2).join(', ')}`}
              style={inputStyle}
            />
            <input
              type="text"
              value={draft.expires_at}
              onChange={e => setDraft(d => ({ ...d, expires_at: e.target.value }))}
              placeholder="Expires at (ISO-8601 UTC, optional) — e.g. 2026-12-31T23:59:59Z"
              style={inputStyle}
            />
            {error && <div className="rs-type-micro rs-c-error">{error.toUpperCase()}</div>}
            <div className="rs-flex rs-gap-3">
              <button className="rs-pill is-active" onClick={create}>ISSUE</button>
              <button className="rs-pill" onClick={cancel}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rs-flex rs-gap-3 rs-mb-3 rs-items-center">
        <button
          className={`rs-pill${includeRevoked ? ' is-active' : ''}`}
          onClick={() => setIncludeRevoked(v => !v)}
        >{includeRevoked ? 'HIDE REVOKED' : 'SHOW REVOKED'}</button>
        <button className="rs-pill" onClick={() => openAudit(null)}>FULL AUDIT LOG</button>
      </div>

      {/* Token list */}
      <div className="rs-card-flow">
        {tokens.length === 0 && !draft && (
          <div className="rs-card-meta">No tokens issued yet.</div>
        )}
        {tokens.map(t => {
          const revoked = !!t.revoked_at
          const expired = t.expires_at && new Date(t.expires_at) < new Date()
          const dim     = revoked || expired
          return (
            <div key={t.id} className="rs-card is-wide rs-p-4" style={{ opacity: dim ? 0.55 : 1 }}>
              <div className="rs-card-head">
                <span className="rs-card-label">{t.label?.toUpperCase()}</span>
                <span className="rs-pill rs-type-nano" style={{
                  background: revoked ? 'var(--md-error)' : expired ? 'rgba(255,255,255,0.15)' : 'var(--md-secondary)',
                  color: 'var(--bg-base)',
                }}>{revoked ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE'}</span>
              </div>
              <div className="rs-mt-1 rs-muted rs-type-nano">
                ID {t.id} · USES {t.use_count}{t.last_used_at ? ` · LAST ${t.last_used_at}` : ''}
              </div>
              {(t.scopes || []).length > 0 && (
                <div className="rs-flex rs-flex-wrap rs-gap-1 rs-mt-2">
                  {t.scopes.map((s, i) => (
                    <span key={i} className="rs-pill rs-type-nano" style={{ padding: '1px 6px' }}>{s}</span>
                  ))}
                </div>
              )}
              {t.expires_at && (
                <div className="rs-mt-2 rs-muted rs-type-nano">
                  EXPIRES {t.expires_at}
                </div>
              )}
              <div className="rs-mt-3 rs-flex rs-gap-2">
                <button className="rs-pill" onClick={() => openAudit(t.id)}>AUDIT</button>
                {!revoked && (
                  <button className="rs-pill" onClick={() => revoke(t.id)} style={{ opacity: 0.7 }}>REVOKE</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Audit drawer */}
      {audit.open && (
        <div
          onClick={closeAudit}
          className="rs-flex rs-justify-end" style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 100,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="rs-p-5 rs-h-full" style={{
              width: 'min(520px, 100vw)',
              overflowY: 'auto',
              background: 'var(--bg-surface, #1a1a1a)',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div className="rs-flex rs-justify-between rs-items-center rs-mb-3">
              <div className="rs-card-label">{audit.tokenId ? 'TOKEN AUDIT' : 'FULL AUDIT LOG'}</div>
              <button className="rs-pill" onClick={closeAudit}>CLOSE</button>
            </div>
            {audit.loading && <div className="rs-card-meta">LOADING…</div>}
            {!audit.loading && audit.entries.length === 0 && (
              <div className="rs-card-meta">No audit entries.</div>
            )}
            {!audit.loading && audit.entries.map(e => (
              <div key={e.id} className="rs-p-3 rs-mb-2 rs-type-micro" style={{
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 'var(--md-shape-xs)',
              }}>
                <div className="rs-flex rs-justify-between rs-mb-1">
                  <span className="rs-fw-600">{e.action?.toUpperCase()}</span>
                  <span style={{ opacity: 0.6 }}>{e.ts}</span>
                </div>
                <div style={{ opacity: 0.7, marginBottom: 2 }}>ACTOR {e.actor || '—'}</div>
                {!audit.tokenId && (
                  <div className="rs-muted rs-type-nano">TOKEN {e.token_id}</div>
                )}
                {e.detail && (
                  <pre className="rs-muted rs-type-nano" style={{
                    margin: 'var(--rs-space-1) 0 0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>{e.detail}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </FlagGatedPage>
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
