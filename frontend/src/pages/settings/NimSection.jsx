// =============================================================================
// src/pages/settings/NimSection.jsx
//
// NIM Rate Monitor — live req/min gauge + global enable toggle
// =============================================================================

import React, { useState, useEffect } from 'react'
import { API_BASE, Section, Toggle } from './shared.jsx'

const NIM_RATE_LIMIT = 40  // NVIDIA free tier cap

export default function NimSection({ enabled, token, llmRoutingFlags, saveLlmRoutingFlags }) {
  const [rate, setRate]         = useState(null)
  const [dayUsage, setDay]      = useState(null)
  const [nimOn, setNimOn]       = useState(llmRoutingFlags?.nvidia_enabled ?? true)
  const [userAccess, setAccess] = useState(true)

  useEffect(() => {
    if (llmRoutingFlags?.nvidia_enabled !== undefined) {
      setNimOn(llmRoutingFlags.nvidia_enabled)
    }
  }, [llmRoutingFlags?.nvidia_enabled])

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/settings/nvidia-nim-access`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => setAccess(d.enabled ?? true)).catch(() => {})
  }, [token])

  const saveUserAccess = async (val) => {
    setAccess(val)
    await fetch(`${API_BASE}/api/settings/nvidia-nim-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled: val }),
    }).catch(() => {})
  }

  // Poll rate every 15 s when section is mounted
  useEffect(() => {
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    const fetchRate = () =>
      Promise.all([
        fetch(`${API_BASE}/api/usage/rate/nvidia_nim?window=60`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/usage/tokens?days=1`, { headers }).then(r => r.json()).catch(() => null),
      ]).then(([rateData, dayData]) => {
        if (rateData) setRate(rateData)
        if (dayData)  setDay(dayData)
      })
    fetchRate()
    const id = setInterval(fetchRate, 15000)
    return () => clearInterval(id)
  }, [token])

  const nimCalls  = rate?.calls  ?? 0
  const pct       = Math.min(100, Math.round((nimCalls / NIM_RATE_LIMIT) * 100))
  const barColor  = pct >= 90 ? 'var(--md-error)' : pct >= 60 ? 'var(--md-sys-color-tertiary)' : 'var(--primary)'

  const nimDayData = dayData => {
    if (!dayData?.by_model) return { calls: 0, tokens: 0, cost: 0 }
    const rows = dayData.by_model.filter(r => r.provider === 'nvidia_nim')
    return {
      calls:  rows.reduce((s, r) => s + r.calls, 0),
      tokens: rows.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0),
      cost:   rows.reduce((s, r) => s + (r.estimated_cost_usd || 0), 0)
    }
  }
  const day = nimDayData(dayUsage)

  const saveNimEnabled = async (val) => {
    setNimOn(val)
    saveLlmRoutingFlags({ nvidia_enabled: val })
  }

  return (
    <Section title="NVIDIA NIM">

      {/* Connection status row — read-only, reflects .env */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          className="material-symbols-rounded"
          style={{ fontSize: '1.4rem', color: enabled ? 'var(--primary)' : 'var(--md-error)' }}
        >
          {enabled ? 'cloud_done' : 'cloud_off'}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Free cloud inference · 100+ models</div>
          <div className="rs-card-meta">
            {enabled
              ? 'Connected · ~40 req/min free tier'
              : nimOn
                ? 'Offline — Missing NVIDIA_API_KEY in .env'
                : 'Disabled globally by admin switch below.'}
          </div>
        </div>
        <span
          className="rs-pill"
          style={{
            fontSize: '0.65rem',
            background: enabled ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'color-mix(in srgb, var(--md-error) 15%, transparent)',
            color: enabled ? 'var(--primary)' : 'var(--md-error)',
            border: `1px solid ${enabled ? 'var(--primary)' : 'var(--md-error)'}`,
            flexShrink: 0,
          }}
        >
          {enabled ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      {/* Global toggle */}
      <Toggle
        id="nim-global-access"
        label="Globally Enable NVIDIA NIM"
        checked={nimOn}
        onChange={saveNimEnabled}
      />
      <p className="rs-card-meta" style={{ marginTop: -8 }}>
        When disabled, NVIDIA NIM models are completely unavailable to all users, including admins.
      </p>

      {/* User access toggle — this is the real admin control */}
      <Toggle
        id="nim-user-access"
        label="Allow all users to select NIM models"
        checked={userAccess}
        onChange={saveUserAccess}
      />
      <p className="rs-card-meta" style={{ marginTop: -8 }}>
        When off, NIM models are hidden from non-admin accounts. Admins always retain access.
      </p>

      {/* Rate monitor */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>monitoring</span>
            <span style={{ fontWeight: 600, fontSize: '0.8rem', letterSpacing: '0.06em' }}>RATE MONITOR</span>
          </div>
          <span className="rs-card-meta" style={{ fontSize: '0.68rem' }}>auto-refreshes · 15s</span>
        </div>

        {/* Req/min gauge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="rs-card-meta">Requests this minute</span>
            <span style={{ fontWeight: 700, color: barColor, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>
              {nimCalls}<span style={{ opacity: 0.5, fontWeight: 400 }}> / {NIM_RATE_LIMIT}</span>
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--md-sys-color-surface-variant)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, background: barColor,
              borderRadius: 4, transition: 'width 0.4s ease-out',
              boxShadow: pct > 0 ? `0 0 8px ${barColor}60` : 'none',
            }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="rs-card-meta">
            <span className="material-symbols-rounded" style={{
              fontSize: '0.85rem',
              color: pct >= 90 ? 'var(--md-error)' : pct >= 60 ? 'var(--md-sys-color-tertiary)' : 'var(--primary)',
            }}>
              {pct >= 90 ? 'warning' : pct >= 60 ? 'info' : 'check_circle'}
            </span>
            <span style={{ fontSize: '0.68rem' }}>
              {pct >= 90 ? 'Near rate limit — requests may queue' : pct >= 60 ? 'Moderate usage' : 'Healthy'}
            </span>
          </div>
        </div>

        {/* Today's stats — 3-column grid with tabular nums */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ paddingTop: 4, borderTop: '1px solid var(--md-sys-color-outline-variant)' }}>
          {[
            { value: day.calls.toLocaleString(), label: 'requests today',  icon: 'bolt' },
            { value: `${(day.tokens / 1000).toFixed(1)}K`, label: 'tokens today', icon: 'token' },
            { value: `$${day.cost.toFixed(2)}`, label: 'cost accrued', icon: 'savings', color: 'var(--primary)' },
          ].map(({ value, label, icon, color }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '0.8rem', opacity: 0.6 }}>{icon}</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', fontVariantNumeric: 'tabular-nums', color: color || 'inherit' }}>{value}</span>
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.63rem' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Model pill grid */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { name: 'Kimi K2.6',          tag: 'Creative' },
          { name: 'Nemotron 253B',       tag: 'Reasoning' },
          { name: 'Nemotron 49B',        tag: 'Reasoning' },
          { name: 'DeepSeek R1',         tag: 'Reasoning' },
          { name: 'Llama 3.1 70B',       tag: 'General' },
          { name: 'Mistral Large',       tag: 'General' },
        ].map(({ name, tag }) => (
          <div key={name} className="rs-pill" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', padding: '3px 10px' }}>
            <span>{name}</span>
            <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>· {tag}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}
