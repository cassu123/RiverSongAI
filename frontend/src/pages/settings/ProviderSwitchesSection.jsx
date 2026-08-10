// =============================================================================
// src/pages/settings/ProviderSwitchesSection.jsx
//
// One row per provider, two working switches each:
//
//   ALLOWED       global — nobody, including admins, can use it when off
//   USERS         non-admin accounts may select its models
//
// Every provider is here, local and free ones included. Previously only the
// paid providers had a real gate and the local one had a switch that the
// auto-router walked straight past, so "off" was advice rather than a rule.
//
// The row also distinguishes "off because the admin said no" from "off
// because there is no API key" — the same switch position, two entirely
// different things to go and do about it.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react'
import { API_BASE, Section } from './shared.jsx'

const PROVIDER_LABEL = {
  ollama:     { name: 'Local (Ollama)',  note: 'Free · runs on this machine' },
  nvidia_nim: { name: 'NVIDIA NIM',      note: 'Free tier · ~40 req/min' },
  qwen:       { name: 'Qwen',            note: 'Paid · Alibaba DashScope' },
  deepseek:   { name: 'DeepSeek',        note: 'Paid · platform.deepseek.com' },
  anthropic:  { name: 'Claude',          note: 'Paid · Anthropic' },
  openai:     { name: 'OpenAI',          note: 'Paid · GPT' },
  gemini:     { name: 'Gemini',          note: 'Paid · Google' },
  mistral_ai: { name: 'Mistral AI',      note: 'Paid · Mistral' },
  bedrock:    { name: 'Amazon Bedrock',  note: 'Paid · AWS' },
}

function Switch({ on, onClick, disabled, label, labelOn = 'ON', labelOff = 'OFF' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        role="switch"
        aria-checked={on}
        // Each row renders two knob-only buttons; the provider name is a
        // sibling, so without this a screen reader announces "switch, switch"
        // with no way to tell which provider or which column.
        aria-label={label}
        disabled={disabled}
        className={`toggle-switch ${on ? 'toggle-switch--on' : ''}`}
        onClick={onClick}
        style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        <span className="toggle-knob" />
      </button>
      {/* nowrap: "ADMIN" and "VISIBLE" were breaking mid-word on phones,
          rendering as ADMI / N beside the knob. */}
      <span className="toggle-value" style={{ minWidth: 30, fontSize: '0.62rem', whiteSpace: 'nowrap' }}>
        {on ? labelOn : labelOff}
      </span>
    </div>
  )
}

export default function ProviderSwitchesSection({ token }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    if (!token) return
    fetch(`${API_BASE}/api/admin/provider-switches`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRows(d.providers || []))
      .catch(() => {})
  }, [token])

  useEffect(load, [load])

  const patch = async (provider, field, value) => {
    const previous = rows.find((r) => r.provider === provider)?.[field]
    setRows((rs) => rs.map((r) => (r.provider === provider ? { ...r, [field]: value } : r)))
    setBusy(true)
    const url =
      field === 'enabled'
        ? `${API_BASE}/api/admin/provider-switches`
        : `${API_BASE}/api/settings/provider-user-access`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, enabled: value }),
      })
      // A rejected change used to read as saved: fetch resolves on a 4xx/5xx,
      // so the catch never ran, the optimistic row stayed on screen, and the
      // reload could not correct it because load() drops a non-OK response.
      // An admin denied a change watched the switch move anyway.
      if (!res.ok) {
        let detail = `Save failed (${res.status})`
        try { detail = (await res.json())?.detail || detail } catch { /* non-JSON */ }
        setError(detail)
        setRows((rs) => rs.map((r) => (r.provider === provider ? { ...r, [field]: previous } : r)))
        return
      }
      setError('')
      window.dispatchEvent(new Event('rs-models-changed'))
      load()
    } catch (e) {
      console.error('[Admin] provider switch failed:', e)
      setError('Could not reach the server — the switch was not changed.')
      setRows((rs) => rs.map((r) => (r.provider === provider ? { ...r, [field]: previous } : r)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="PROVIDER ACCESS">
      <p className="rs-card-meta" style={{ marginBottom: 4 }}>
        <strong>Allowed</strong> is the hard gate — when off, nothing routes to that
        provider, including River&rsquo;s automatic model choice and including admins.
        <strong> Users</strong> controls whether non-admin accounts can select it.
        {busy && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>Saving…</span>}
      </p>
      <p className="rs-card-meta" style={{ marginBottom: 14, opacity: 0.75 }}>
        Local and free providers are switchable too — costing nothing is not a reason
        to be unblockable.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, marginBottom: 10,
            background: 'color-mix(in srgb, var(--md-error) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--md-error) 45%, transparent)',
            fontSize: '0.74rem',
          }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Column headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 14,
          alignItems: 'center',
          paddingBottom: 6,
          borderBottom: '1px solid var(--md-outline-variant)',
          marginBottom: 6,
        }}
      >
        <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>PROVIDER</span>
        <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>ALLOWED</span>
        <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>USERS</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => {
          const meta = PROVIDER_LABEL[r.provider] || { name: r.provider, note: '' }
          // "Off" has three causes and they need three different actions.
          // This row used to call all of them "Blocked by you", which is only
          // true when an admin actually flipped the switch — a provider still
          // sitting on its .env default is off because the server says so,
          // and flipping the toggle here is not what turns it back on.
          const blockedReason = !r.enabled
            ? r.enabled_source === 'admin'
              ? 'Blocked by you'
              : r.enabled_source === 'coarse'
                ? 'Blocked by the kill switch above'
                : `Disabled in .env — set ${r.provider.toUpperCase()}_ENABLED=true`
            : !r.has_credentials
              ? 'No API key in .env'
              : null
          return (
            <div
              key={r.provider}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 14,
                alignItems: 'center',
                padding: '8px 0',
                opacity: r.enabled ? 1 : 0.62,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.84rem' }}>{meta.name}</div>
                <div className="rs-card-meta" style={{ fontSize: '0.65rem' }}>
                  {blockedReason ? (
                    <span
                      style={{
                        color: r.enabled ? 'var(--md-error)' : 'var(--md-outline)',
                      }}
                    >
                      {blockedReason}
                    </span>
                  ) : (
                    meta.note
                  )}
                </div>
              </div>

              <Switch
                on={!!r.enabled}
                label={`Allow ${meta.name}`}
                onClick={() => patch(r.provider, 'enabled', !r.enabled)}
                labelOn="ON"
                labelOff="OFF"
              />

              <Switch
                on={!!r.user_access}
                disabled={!r.enabled}
                label={`Let all users select ${meta.name}`}
                onClick={() => patch(r.provider, 'user_access', !r.user_access)}
                // With the hard gate off this switch governs nothing, and a
                // row reading OFF / ALL invited "so is it available to
                // everyone or not?". Report no value rather than a stale one.
                labelOn={r.enabled ? 'ALL' : '—'}
                labelOff={r.enabled ? 'ADMIN' : '—'}
              />
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="rs-mpop-empty" style={{ padding: '12px 0' }}>
            Loading providers…
          </p>
        )}
      </div>
    </Section>
  )
}
