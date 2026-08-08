// =============================================================================
// src/pages/settings/MeteredProviderSection.jsx
//
// Admin panel for a PAID cloud LLM provider: connection state, the two admin
// switches, and a spend tracker.
//
// One component drives both DeepSeek and Qwen. NimSection is a near-identical
// panel that stayed as it is — it is a free tier, so its headline number is
// "requests against the rate limit" where these two want "money spent". That
// difference is the whole reason this is a separate component rather than a
// prop on that one.
//
// The spend figures are ESTIMATES computed from the rate table in
// providers/llm/registry.py against tokens the providers actually reported.
// The token counts are real; the dollars are only as current as that table.
// The panel says so rather than implying it is reading a live invoice.
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react'
import { API_BASE, Section, Toggle } from './shared.jsx'

export const METERED_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    tagline: 'Full-size hosted DeepSeek · metered',
    envKey: 'DEEPSEEK_API_KEY',
    console: 'platform.deepseek.com',
    flagKey: 'deepseek_enabled',
    models: [
      { name: 'deepseek-chat',     tag: 'General'   },
      { name: 'deepseek-reasoner', tag: 'Reasoning' },
    ],
    // Shown under the toggle so the cheaper route is never a surprise.
    freeAlternative:
      'Free alternatives already configured: local Ollama deepseek-r1, and DeepSeek R1 on the NVIDIA NIM free tier.',
  },
  qwen: {
    label: 'Qwen',
    tagline: 'Alibaba Model Studio · metered',
    envKey: 'QWEN_API_KEY',
    console: 'bailian.console.alibabacloud.com',
    flagKey: 'qwen_enabled',
    models: [
      { name: 'qwen-turbo', tag: 'Cheapest'  },
      { name: 'qwen-plus',  tag: 'Balanced'  },
      { name: 'qwen-max',   tag: 'Most able' },
    ],
    freeAlternative:
      'Free alternative already configured: local Ollama qwen2.5. Note qwen-max has no local equivalent.',
  },
}

const fmtUsd = (n) => (n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0.00')
const fmtTokens = (n) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n)

export default function MeteredProviderSection({ provider, enabled, token }) {
  const meta = METERED_PROVIDERS[provider]
  const [globalOn, setGlobalOn] = useState(false)
  const [userAccess, setUserAccess] = useState(null)
  const [usage, setUsage] = useState(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')

  // Both switches read from /api/admin/provider-switches — the same endpoint
  // and the same `provider_enabled` key the Provider Access matrix writes.
  //
  // This panel used to drive its global toggle through llm-routing-flags,
  // which persists `{provider}_enabled_global`. Routing resolves
  // `provider_enabled` first, so once an admin had touched the matrix the
  // toggle here silently stopped affecting anything while still moving.
  // Two panels, two keys, one of them a lie.
  const loadSwitches = useCallback(() => {
    if (!token) return
    const ctrl = new AbortController()
    fetch(`${API_BASE}/api/admin/provider-switches`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const row = (d.providers || []).find((x) => x.provider === provider)
        if (!row) return
        setGlobalOn(!!row.enabled)
        setUserAccess(!!row.user_access)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [token, provider])

  useEffect(() => loadSwitches(), [loadSwitches])

  const loadUsage = useCallback(() => {
    if (!token) return
    fetch(`${API_BASE}/api/usage/tokens?days=${days}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsage(d))
      .catch(() => {})
  }, [token, days])

  useEffect(() => {
    loadUsage()
    const id = setInterval(loadUsage, 30000)
    return () => clearInterval(id)
  }, [loadUsage])

  // Both writes go through the same helper so a rejection restores the
  // previous position. Treating every fetch outcome as success left an
  // access control showing a state the server never agreed to.
  const save = async (field, val) => {
    const url =
      field === 'enabled'
        ? `${API_BASE}/api/admin/provider-switches`
        : `${API_BASE}/api/settings/provider-user-access`
    const setter = field === 'enabled' ? setGlobalOn : setUserAccess
    const previous = field === 'enabled' ? globalOn : userAccess
    setter(val)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, enabled: val }),
      })
      if (!res.ok) {
        let detail = `Save failed (${res.status})`
        try { detail = (await res.json())?.detail || detail } catch { /* non-JSON */ }
        setError(detail)
        setter(previous)
        return
      }
      setError('')
      window.dispatchEvent(new Event('rs-models-changed'))
      loadSwitches()
    } catch {
      setError('Could not reach the server — nothing was changed.')
      setter(previous)
    }
  }

  const saveGlobal = (val) => save('enabled', val)
  const saveUserAccess = (val) => save('user_access', val)

  // Roll up every model belonging to this provider.
  const rows = (usage?.by_model || []).filter((r) => r.provider === provider)
  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + (r.calls || 0),
      tokens: acc.tokens + r.input_tokens + r.output_tokens,
      cost: acc.cost + (r.estimated_cost_usd || 0),
    }),
    { calls: 0, tokens: 0, cost: 0 },
  )

  const statusLabel = enabled
    ? 'LIVE'
    : globalOn
      ? 'NO KEY'
      : 'OFF'
  const statusColor = enabled ? 'var(--primary)' : 'var(--md-error)'

  return (
    <Section title={`${meta.label} (paid)`}>
      {/* Connection status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="material-symbols-rounded"
          style={{ fontSize: '1.4rem', color: statusColor }}
        >
          {enabled ? 'paid' : 'cloud_off'}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{meta.tagline}</div>
          <div className="rs-card-meta">
            {enabled
              ? 'Connected · billed per token'
              : globalOn
                ? `Missing ${meta.envKey} in .env — get a key at ${meta.console}`
                : 'Disabled globally by the switch below.'}
          </div>
        </div>
        <span
          className="rs-pill"
          style={{
            fontSize: '0.65rem',
            background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
            color: statusColor,
            border: `1px solid ${statusColor}`,
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10,
            background: 'color-mix(in srgb, var(--md-error) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--md-error) 45%, transparent)',
            fontSize: '0.72rem',
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Cost warning — this is the one thing that separates these two panels
          from every other provider section. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'color-mix(in srgb, var(--md-sys-color-tertiary) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--md-sys-color-tertiary) 40%, transparent)',
        }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>
          info
        </span>
        <div className="rs-card-meta" style={{ fontSize: '0.7rem', lineHeight: 1.5 }}>
          Every message sent to {meta.label} is billed to your account.{' '}
          {meta.freeAlternative}
        </div>
      </div>

      <Toggle
        id={`${provider}-global`}
        label={`Globally enable ${meta.label}`}
        checked={globalOn}
        onChange={saveGlobal}
      />
      <p className="rs-card-meta" style={{ marginTop: -8 }}>
        When off, {meta.label} models are unavailable to everyone, including admins.
      </p>

      <Toggle
        id={`${provider}-user-access`}
        label={`Allow all users to select ${meta.label} models`}
        checked={userAccess ?? true}
        onChange={saveUserAccess}
        disabled={!globalOn}
      />
      <p className="rs-card-meta" style={{ marginTop: -8 }}>
        When off, {meta.label} models are hidden from non-admin accounts — they cannot
        spend on it. Admins always retain access. Accounts restricted to free models are
        excluded regardless of this switch.
      </p>

      {/* Spend tracker */}
      <div
        style={{
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--md-surface-container-low)',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>
              savings
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.8rem', letterSpacing: '0.06em' }}>
              SPEND TRACKER
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="rs-pill"
                style={{
                  fontSize: '0.65rem',
                  padding: '2px 10px',
                  cursor: 'pointer',
                  background:
                    days === d ? 'color-mix(in srgb, var(--primary) 20%, transparent)' : 'transparent',
                  color: days === d ? 'var(--primary)' : 'inherit',
                  border: `1px solid ${days === d ? 'var(--primary)' : 'var(--md-outline-variant)'}`,
                }}
              >
                {d === 1 ? '24h' : `${d}d`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { value: totals.calls.toLocaleString(), label: 'requests', icon: 'bolt' },
            { value: fmtTokens(totals.tokens), label: 'tokens', icon: 'token' },
            {
              value: fmtUsd(totals.cost),
              label: 'estimated spend',
              icon: 'payments',
              color: totals.cost > 0 ? 'var(--md-sys-color-tertiary)' : 'inherit',
            },
          ].map(({ value, label, icon, color }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '0.8rem', opacity: 0.6 }}>
                  {icon}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    fontVariantNumeric: 'tabular-nums',
                    color: color || 'inherit',
                  }}
                >
                  {value}
                </span>
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.63rem' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Per-model breakdown — which model is actually costing the money */}
        {rows.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              paddingTop: 8,
              borderTop: '1px solid var(--md-sys-color-outline-variant)',
            }}
          >
            {rows
              .slice()
              .sort((a, b) => (b.estimated_cost_usd || 0) - (a.estimated_cost_usd || 0))
              .map((r) => (
                <div
                  key={r.model}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}
                >
                  <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', opacity: 0.85 }}>
                    {r.model}
                  </span>
                  <span className="rs-card-meta" style={{ fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                    {fmtTokens(r.input_tokens + r.output_tokens)} ·{' '}
                    <strong style={{ color: 'var(--md-sys-color-tertiary)' }}>
                      {fmtUsd(r.estimated_cost_usd || 0)}
                    </strong>
                  </span>
                </div>
              ))}
          </div>
        )}

        <div className="rs-card-meta" style={{ fontSize: '0.63rem', opacity: 0.75 }}>
          Token counts are reported by {meta.label}. Dollar figures are estimates from the
          rate table in the model registry — check {meta.console} for the authoritative bill.
        </div>
      </div>

      {/* Model pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {meta.models.map(({ name, tag }) => (
          <div
            key={name}
            className="rs-pill"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', padding: '3px 10px' }}
          >
            <span style={{ fontFamily: 'monospace' }}>{name}</span>
            <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>· {tag}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
