import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '../components/FlagGatedPage.jsx'

/**
 * ResearchPage — Q3#11.
 *
 * Single textarea + Go button. The orchestrator runs server-side and
 * the result is saved as a research-kind document via Q2#6 — this page
 * displays the body inline and links to the saved doc.
 */

export default function ResearchPage({ setAction, onNavigate }) {
  const authHeaders = useAuthHeaders()
  const [query,    setQuery]    = useState('')
  const [running,  setRunning]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState('')
  const [disabled, setDisabled] = useState(null)

  // Probe the flag on mount via a HEAD-like dry call.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/research/run`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query: 'probe' }),
    }).then(async r => {
      if (cancelled) return
      if (r.status === 404) { setDisabled(true); return }
      setDisabled(false)
      // We don't keep the probe result; this was just discovery.
    }).catch(() => {
      if (!cancelled) setDisabled(false)
    })
    return () => { cancelled = true }
  }, [authHeaders])

  const run = async () => {
    const q = query.trim()
    if (!q) return
    setRunning(true); setError(''); setResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/research/run`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ query: q }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Research failed.') }
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    setAction(
      <button className="rs-pill" disabled={running || !query.trim()} onClick={run} style={{ opacity: running ? 0.7 : 1 }}>
        {running ? 'RESEARCHING…' : 'RUN'}
      </button>
    )
  }, [setAction, run, running, query])

  if (disabled === true) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Deep Research</h1>
          <div className="rs-greeting-sub">Disabled. Ask the admin to enable it (and Documents) in settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Deep Research</h1>
        <div className="rs-greeting-sub">Decompose · search · fetch · synthesize. The report is saved to Documents.</div>
      </div>

      <div className="rs-card is-wide" style={{ padding: 16, marginBottom: 16 }}>
        <div className="rs-card-label" style={{ marginBottom: 8 }}>QUESTION</div>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={3}
          placeholder="What do you want River to dig into?"
          disabled={running}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            padding: '12px 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            color: 'var(--md-on-surface)',
            fontSize: '0.92rem',
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem', marginTop: 10 }}>{error.toUpperCase()}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="rs-pill is-active" onClick={run} disabled={running || !query.trim()}>
            {running ? 'WORKING…' : 'RESEARCH'}
          </button>
          {result && (
            <button className="rs-pill" onClick={() => onNavigate && onNavigate('documents')}>OPEN IN DOCS</button>
          )}
        </div>
      </div>

      {result && (
        <div className="rs-card is-wide" style={{ padding: 16 }}>
          <div className="rs-card-head">
            <span className="rs-card-label">{(result.title || 'REPORT').toUpperCase()}</span>
            <span className="rs-card-label" style={{ opacity: 0.4 }}>{result.sources?.length || 0} SOURCES</span>
          </div>
          {result.sub_queries?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 12 }}>
              {result.sub_queries.map((q, i) => (
                <span key={i} className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>{q}</span>
              ))}
            </div>
          )}
          <pre style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            fontSize: '0.88rem',
            lineHeight: 1.55,
            margin: 0,
          }}>{result.report}</pre>
        </div>
      )}
    </div>
  )
}
