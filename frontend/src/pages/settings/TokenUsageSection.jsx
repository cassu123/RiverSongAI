// =============================================================================
// src/pages/settings/TokenUsageSection.jsx
// =============================================================================

import React, { useState, useEffect } from 'react'
import { Section } from './shared.jsx'

// Friendly names for the usage_source tags recorded by core/token_tracker.py
const SOURCE_LABELS = {
  voice:            { label: 'VOICE CONVERSATION', icon: 'mic' },
  chat:             { label: 'TEXT CHAT',          icon: 'chat' },
  memory:           { label: 'MEMORY EXTRACTION',  icon: 'psychology' },
  analytics:        { label: 'ANALYTICS INSIGHTS', icon: 'monitoring' },
  scribe:           { label: 'SCRIBE (NOTES)',     icon: 'edit_note' },
  vault:            { label: 'VAULT / CHRONOS',    icon: 'folder' },
  compare:          { label: 'MODEL COMPARE',      icon: 'compare' },
  research:         { label: 'DEEP RESEARCH',      icon: 'travel_explore' },
  code_interpreter: { label: 'CODE INTERPRETER',   icon: 'terminal' },
  other:            { label: 'OTHER',              icon: 'more_horiz' },
}

export default function TokenUsageSection({ token, isAdmin = false, isParent = false }) {
  const [data,    setData]    = useState(null)
  const [days,    setDays]    = useState(30)
  const [scope,   setScope]   = useState('mine')
  const [account, setAccount] = useState('')   // a named child, overrides scope
  const [children, setChildren] = useState([])
  const [loading, setLoading] = useState(true)
  const [openSource, setOpenSource] = useState(null)

  // A parent can look at one child at a time as well as at the roll-up, so
  // the picker needs their names. Admins see this too when they are also a
  // parent; the instance-wide view is a separate button.
  useEffect(() => {
    if (!token || !isParent) return
    fetch('/api/parent/children', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setChildren(d?.children || d || []))
      .catch(() => {})
  }, [token, isParent])

  useEffect(() => {
    if (!token) return
    let active = true
    setLoading(true)
    const q = account
      ? `days=${days}&user_id=${encodeURIComponent(account)}`
      : `days=${days}&scope=${scope}`
    fetch(`/api/usage/tokens?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) { setData(d); setLoading(false) } })
      .catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, days, scope, account])

  function fmtTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  function fmtCostUsd(n) {
    if (n === 0) return 'FREE'
    if (n < 0.01) return `$${n.toFixed(4)}`
    return `$${n.toFixed(2)}`
  }

  const bySource = data?.by_source || []
  const maxSourceTokens = bySource.reduce(
    (m, s) => Math.max(m, s.input_tokens + s.output_tokens), 0)

  return (
    <Section title="TOKEN USAGE">
      <div className="rs-flex rs-gap-3 rs-mb-4 rs-items-center rs-flex-wrap">
        <span className="rs-card-label">PERIOD</span>
        <div className="rs-flex rs-gap-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              className={`rs-pill ${days === d ? 'is-active' : ''}`}
              style={{ fontSize: 'var(--rs-fs-nano)' }}
              onClick={() => setDays(d)}
            >{d}D</button>
          ))}
        </div>

        {/* Whose usage. This used to be unlabelled because there was only one
            answer -- the endpoint returned the whole machine to everybody.
            Now that it depends on who is asking, the number means nothing
            unless it says who it is counting. */}
        <span className="rs-card-label">WHOSE</span>
        <div className="rs-flex rs-gap-1 rs-flex-wrap">
          {[
            { id: 'mine', label: 'ME' },
            ...(isParent && children.length ? [{ id: 'dependents', label: 'ME + KIDS' }] : []),
            ...(isAdmin ? [{ id: 'all', label: 'EVERYTHING' }] : []),
          ].map(s => (
            <button
              key={s.id}
              className={`rs-pill ${!account && scope === s.id ? 'is-active' : ''}`}
              style={{ fontSize: 'var(--rs-fs-nano)' }}
              onClick={() => { setAccount(''); setScope(s.id) }}
            >{s.label}</button>
          ))}
          {/* One child at a time: a roll-up cannot tell you which of them is
              the reason the bill moved. */}
          {children.map(c => (
            <button
              key={c.id}
              className={`rs-pill ${account === c.id ? 'is-active' : ''}`}
              style={{ fontSize: 'var(--rs-fs-nano)' }}
              onClick={() => setAccount(c.id)}
            >{(c.display_name || c.email || c.id).toUpperCase()}</button>
          ))}
        </div>
      </div>

      {!loading && data && (account || scope !== 'mine') && (
        <p className="rs-card-meta rs-mb-4" style={{ marginTop: -8 }}>
          {account
            ? 'One account. You can see this because you are recorded as their parent.'
            : scope === 'dependents'
              ? `You and ${(data.accounts_counted || 1) - 1} account${data.accounts_counted === 2 ? '' : 's'} you answer for.`
              : 'Everything on this machine, including background work that belongs to no account — so this is more than the accounts add up to.'}
        </p>
      )}

      {loading && <p className="rs-card-meta">Loading usage statistics…</p>}

      {!loading && data && (
        <>
          <div className="rs-gap-5 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
            <div>
              <div className="rs-card-label rs-type-nano">INPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_input)}</div>
            </div>
            <div>
              <div className="rs-card-label rs-type-nano">OUTPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_output)}</div>
            </div>
            <div>
              <div className="rs-card-label rs-type-nano">EST. COST</div>
              <div className="rs-card-value" style={{ color: data.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)' }}>
                {fmtCostUsd(data.estimated_cost_usd)}
              </div>
            </div>
          </div>

          {/* WHERE the tokens went — per feature, tap a row for its model mix */}
          {bySource.length > 0 && (
            <>
              <div className="rs-card-label rs-mb-2 rs-type-nano">WHERE</div>
              <div className="rs-flex rs-flex-col rs-gap-2 rs-mb-5">
                {bySource.map(src => {
                  const meta = SOURCE_LABELS[src.source] || { label: src.source.toUpperCase(), icon: 'more_horiz' }
                  const total = src.input_tokens + src.output_tokens
                  const pct = maxSourceTokens ? Math.max(3, (total / maxSourceTokens) * 100) : 0
                  const open = openSource === src.source
                  return (
                    <div key={src.source}
                      onClick={() => setOpenSource(open ? null : src.source)}
                      className="rs-pointer" style={{
                        padding: 'var(--rs-space-3) var(--rs-space-3)',
                        borderRadius: 'var(--md-shape-sm)',
                        background: 'var(--md-surface-container-low)',
                        border: '1px solid var(--md-outline-variant)',
                      }}>
                      <div className="rs-flex rs-items-center rs-gap-3 rs-flex-wrap">
                        <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.7 }}>{meta.icon}</span>
                        <span className="rs-grow rs-type-micro rs-fw-700" style={{ letterSpacing: '0.06em', minWidth: 120 }}>{meta.label}</span>
                        <span className="rs-card-meta rs-type-nano" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {src.calls} calls · {fmtTokens(total)}
                        </span>
                        <span className="rs-type-nano rs-fw-700" style={{ fontVariantNumeric: 'tabular-nums', color: src.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)' }}>
                          {fmtCostUsd(src.estimated_cost_usd)}
                        </span>
                      </div>
                      <div className="rs-mt-2" style={{ height: 4, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-surface-container-high)' }}>
                        <div className="rs-h-full" style={{ width: `${pct}%`, borderRadius: 'var(--md-shape-xs)', background: 'var(--primary)', opacity: 0.85 }} />
                      </div>
                      {open && (
                        <div className="rs-mt-3 rs-flex rs-flex-col rs-gap-1">
                          {src.models.map((m, i) => (
                            <div key={i} className="rs-flex rs-justify-between rs-gap-2 rs-flex-wrap rs-type-nano" style={{ opacity: 0.85 }}>
                              <span>{m.model} <span style={{ opacity: 0.5 }}>({m.provider})</span></span>
                              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {m.calls} calls · {fmtTokens(m.input_tokens + m.output_tokens)} · {fmtCostUsd(m.estimated_cost_usd)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {data.by_model.length === 0 ? (
            <p className="rs-card-meta">No usage recorded yet.</p>
          ) : (
            <>
              <div className="rs-card-label rs-mb-2 rs-type-nano">BY MODEL</div>
              <div className="rs-table-wrap" style={{ padding: 0, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
                <table className="rs-w-full rs-type-tiny" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--md-surface-container-high)' }}>
                      <th style={{ textAlign: 'left', padding: 'var(--rs-space-3) var(--rs-space-4)' }} className="rs-card-label">MODEL</th>
                      <th style={{ textAlign: 'right', padding: 'var(--rs-space-3) var(--rs-space-4)' }} className="rs-card-label">CALLS</th>
                      <th style={{ textAlign: 'right', padding: 'var(--rs-space-3) var(--rs-space-4)' }} className="rs-card-label">COST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.map((row, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
                        <td style={{ padding: 'var(--rs-space-3) var(--rs-space-4)' }}>
                          <div className="rs-fw-600">{row.model}</div>
                          <div className="rs-muted rs-type-nano">{row.provider.toUpperCase()}</div>
                        </td>
                        <td className="rs-text-right" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', fontVariantNumeric: 'tabular-nums' }}>{row.calls}</td>
                        <td className="rs-text-right rs-fw-600" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', color: row.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)' }}>
                          {fmtCostUsd(row.estimated_cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="rs-card-meta rs-mt-3">
            Cost estimates use public list prices. Ollama (local) is always free.
          </p>
        </>
      )}
    </Section>
  )
}
