import React, { useState, useEffect, useCallback } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import FlagGatedPage from '../components/FlagGatedPage.jsx'

/**
 * ComparePage — Q3#12.
 *
 * Blind A/B model comparison. The UI shows two unlabeled responses
 * side-by-side. Voting reveals which model produced which response.
 */

export default function ComparePage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [prompt,      setPrompt]      = useState('')
  const [modelA,      setModelA]      = useState({ provider: 'ollama', model: '' })
  const [modelB,      setModelB]      = useState({ provider: 'ollama', model: '' })
  const [run,         setRun]         = useState(null)
  const [revealed,    setRevealed]    = useState(null)
  const [running,     setRunning]     = useState(false)
  const [voting,      setVoting]      = useState(false)
  const [error,       setError]       = useState('')
  const [disabled,    setDisabled]    = useState(null)
  const [history,     setHistory]     = useState([])
  const [board,       setBoard]       = useState([])

  const refresh = useCallback(async () => {
    try {
      const [h, b] = await Promise.all([
        fetch(`${API_BASE}/api/compare/history`,     { headers: authHeaders() }),
        fetch(`${API_BASE}/api/compare/leaderboard`, { headers: authHeaders() }),
      ])
      if (h.status === 404) { setDisabled(true); return }
      setDisabled(false)
      if (h.ok) { const d = await h.json(); setHistory(d.runs || []) }
      if (b.ok) { const d = await b.json(); setBoard(d.leaderboard || []) }
    } catch {
      setDisabled(false)
    }
  }, [authHeaders])

  useEffect(() => { refresh() }, [refresh])

  const submit = async () => {
    if (!prompt.trim() || !modelA.model.trim() || !modelB.model.trim()) {
      setError('Need a prompt and both model ids.')
      return
    }
    setRunning(true); setError(''); setRun(null); setRevealed(null)
    try {
      const res = await fetch(`${API_BASE}/api/compare/run`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          prompt,
          model_a: { provider: modelA.provider, model: modelA.model },
          model_b: { provider: modelB.provider, model: modelB.model },
        }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Run failed.') }
      const data = await res.json()
      setRun(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  const vote = async (winner) => {
    if (!run) return
    setVoting(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/api/compare/${run.id}/vote`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ winner }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Vote failed.') }
      const data = await res.json()
      setRevealed(data)
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setVoting(false)
    }
  }

  useEffect(() => {
    setAction(
      <button className="rs-pill" onClick={submit} disabled={running || !prompt.trim()}>
        {running ? 'RUNNING…' : 'COMPARE'}
      </button>
    )
  }, [setAction, submit, running, prompt])

  if (disabled === true) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Blind Compare</h1>
          <div className="rs-greeting-sub">Disabled. Ask the admin to enable it in settings.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Blind Compare</h1>
        <div className="rs-greeting-sub">Two models, same prompt, identities hidden until you vote.</div>
      </div>

      <div className="rs-card is-wide" style={{ padding: 16, marginBottom: 16 }}>
        <div className="rs-card-label" style={{ marginBottom: 8 }}>SETUP</div>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
          placeholder="Prompt to send to both models…"
          style={inputStyle}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <ModelInput label="MODEL A" value={modelA} onChange={setModelA} />
          <ModelInput label="MODEL B" value={modelB} onChange={setModelB} />
        </div>
        {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem', marginTop: 10 }}>{error.toUpperCase()}</div>}
      </div>

      {run && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <ResponseCard
            label={revealed ? `${revealed.model_a.provider} · ${revealed.model_a.model}` : 'A'}
            body={run.response_a}
            chosen={revealed?.winner === 'a'}
          />
          <ResponseCard
            label={revealed ? `${revealed.model_b.provider} · ${revealed.model_b.model}` : 'B'}
            body={run.response_b}
            chosen={revealed?.winner === 'b'}
          />
        </div>
      )}

      {run && !revealed && (
        <div className="rs-card is-wide" style={{ padding: 12, marginBottom: 16 }}>
          <div className="rs-card-label" style={{ marginBottom: 8, textAlign: 'center' }}>YOUR VOTE</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="rs-pill is-active" disabled={voting} onClick={() => vote('a')}>← A WINS</button>
            <button className="rs-pill"           disabled={voting} onClick={() => vote('tie')}>TIE</button>
            <button className="rs-pill is-active" disabled={voting} onClick={() => vote('b')}>B WINS →</button>
          </div>
        </div>
      )}

      {board.length > 0 && (
        <div className="rs-card is-wide" style={{ padding: 16, marginBottom: 16 }}>
          <div className="rs-card-label" style={{ marginBottom: 8 }}>LEADERBOARD (YOUR VOTES)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {board.slice(0, 8).map((row, i) => (
              <div key={`${row.provider}:${row.model}:${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>{row.provider} · {row.model}</span>
                <span style={{ opacity: 0.7 }}>{row.wins}W · {row.ties}T · {row.losses}L · {(row.win_rate * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rs-card is-wide" style={{ padding: 16 }}>
          <div className="rs-card-label" style={{ marginBottom: 8 }}>RECENT RUNS</div>
          {history.slice(0, 6).map(h => (
            <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{h.prompt}</span>
              <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>{h.winner ? h.winner.toUpperCase() : 'OPEN'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelInput({ label, value, onChange }) {
  return (
    <div>
      <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={value.provider}
          onChange={e => onChange({ ...value, provider: e.target.value })}
          placeholder="provider"
          style={{ ...inputStyle, flex: '0 0 110px' }}
        />
        <input
          type="text"
          value={value.model}
          onChange={e => onChange({ ...value, model: e.target.value })}
          placeholder="model id"
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
    </div>
  )
}

function ResponseCard({ label, body, chosen }) {
  return (
    <div className="rs-card" style={{ padding: 14, border: chosen ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.08)' }}>
      <div className="rs-card-label" style={{ marginBottom: 8 }}>{label}</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>{body || '(empty)'}</pre>
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
