// =============================================================================
// src/pages/settings/TokenUsageSection.jsx
// =============================================================================

import React, { useState, useEffect } from 'react'
import { Section } from './shared.jsx'

export default function TokenUsageSection({ token }) {
  const [data,    setData]    = useState(null)
  const [days,    setDays]    = useState(30)
  const [loading, setLoading] = useState(true)

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

  return (
    <Section title="TOKEN USAGE">
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
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

          {data.by_model.length === 0 ? (
            <p className="rs-card-meta">No usage recorded yet.</p>
          ) : (
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
          )}

          <p className="rs-card-meta" style={{ marginTop: 12 }}>
            Cost estimates use public list prices. Ollama (local) is always free.
          </p>
        </>
      )}
    </Section>
  )
}
