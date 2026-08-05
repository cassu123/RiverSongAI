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

export default function TokenUsageSection({ token }) {
  const [data,    setData]    = useState(null)
  const [days,    setDays]    = useState(30)
  const [loading, setLoading] = useState(true)
  const [openSource, setOpenSource] = useState(null)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/usage/tokens?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, days])

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
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="rs-card-label">PERIOD</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              className={`rs-pill ${days === d ? 'is-active' : ''}`}
              style={{ fontSize: '0.7rem' }}
              onClick={() => setDays(d)}
            >{d}D</button>
          ))}
        </div>
      </div>

      {loading && <p className="rs-card-meta">Loading usage statistics…</p>}

      {!loading && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 24, marginBottom: 24 }}>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>INPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_input)}</div>
            </div>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>OUTPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_output)}</div>
            </div>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>EST. COST</div>
              <div className="rs-card-value" style={{ color: data.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)' }}>
                {fmtCostUsd(data.estimated_cost_usd)}
              </div>
            </div>
          </div>

          {/* WHERE the tokens went — per feature, tap a row for its model mix */}
          {bySource.length > 0 && (
            <>
              <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 8 }}>WHERE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
                {bySource.map(src => {
                  const meta = SOURCE_LABELS[src.source] || { label: src.source.toUpperCase(), icon: 'more_horiz' }
                  const total = src.input_tokens + src.output_tokens
                  const pct = maxSourceTokens ? Math.max(3, (total / maxSourceTokens) * 100) : 0
                  const open = openSource === src.source
                  return (
                    <div key={src.source}
                      onClick={() => setOpenSource(open ? null : src.source)}
                      style={{
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        background: 'var(--md-surface-container-low)',
                        border: '1px solid var(--md-outline-variant)',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.7 }}>{meta.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.06em', flex: 1, minWidth: 120 }}>{meta.label}</span>
                        <span className="rs-card-meta" style={{ fontSize: '0.65rem', fontVariantNumeric: 'tabular-nums' }}>
                          {src.calls} calls · {fmtTokens(total)}
                        </span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: src.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)' }}>
                          {fmtCostUsd(src.estimated_cost_usd)}
                        </span>
                      </div>
                      <div style={{ height: 4, borderRadius: 2, marginTop: 8, background: 'var(--md-surface-container-high)' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: 'var(--primary)', opacity: 0.85 }} />
                      </div>
                      {open && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {src.models.map((m, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.68rem', opacity: 0.85, flexWrap: 'wrap' }}>
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
              <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 8 }}>BY MODEL</div>
              <div className="rs-table-wrap" style={{ padding: 0, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--md-surface-container-high)' }}>
                      <th style={{ textAlign: 'left', padding: '12px 16px' }} className="rs-card-label">MODEL</th>
                      <th style={{ textAlign: 'right', padding: '12px 16px' }} className="rs-card-label">CALLS</th>
                      <th style={{ textAlign: 'right', padding: '12px 16px' }} className="rs-card-label">COST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_model.map((row, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 600 }}>{row.model}</div>
                          <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{row.provider.toUpperCase()}</div>
                        </td>
                        <td style={{ textAlign: 'right', padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>{row.calls}</td>
                        <td style={{ textAlign: 'right', padding: '12px 16px', color: row.estimated_cost_usd > 0 ? 'var(--primary)' : 'var(--rs-status-nominal)', fontWeight: 600 }}>
                          {fmtCostUsd(row.estimated_cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="rs-card-meta" style={{ marginTop: 12 }}>
            Cost estimates use public list prices. Ollama (local) is always free.
          </p>
        </>
      )}
    </Section>
  )
}
