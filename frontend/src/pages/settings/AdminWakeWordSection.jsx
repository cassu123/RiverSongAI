// =============================================================================
// src/pages/settings/AdminWakeWordSection.jsx
// =============================================================================

import React, { useState, useEffect } from 'react'
import { Section, Toggle } from './shared.jsx'

export default function AdminWakeWordSection({ token }) {
  const [form, setForm] = useState({ enabled: false, phrase: 'hey_river', sensitivity: 0.5 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    fetch('/api/settings/wake-word', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setForm({ enabled: data.enabled, phrase: data.phrase, sensitivity: data.sensitivity })
        setInstalled(data.installed)
        setLoading(false)
      })
  }, [token])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/settings/wake-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      })
      if (!res.ok) throw new Error('Save failed')
      setMsg('Settings saved. Refresh required for some changes.')
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Section title="AMBIENT LISTENING">
      {!installed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', background: 'color-mix(in srgb, var(--md-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 35%, transparent)', borderRadius: 8 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--md-error)', flexShrink: 0 }}>cloud_off</span>
          <span className="rs-card-meta" style={{ margin: 0, color: 'var(--md-error)' }}>
            The local ambient detection engine is currently offline. River cannot hear you until it is restored.
          </span>
        </div>
      )}

      <Toggle 
        id="ww-admin-enabled"
        label="Enable Ambient Detection"
        checked={form.enabled}
        onChange={v => setForm({ ...form, enabled: v })}
      />

      <div style={{ marginTop: 20 }}>
        <div className="rs-card-label" style={{ marginBottom: 6 }}>WAKE PHRASE</div>
        <select
          className="settings-select"
          value={form.phrase}
          onChange={e => setForm({ ...form, phrase: e.target.value })}
        >
          <option value="hey_river">Hey River (Default)</option>
          <option value="alexa">Alexa</option>
          <option value="hey_jarvis">Hey Jarvis</option>
          <option value="hey_mycroft">Hey Mycroft</option>
        </select>
        <p className="rs-card-meta" style={{ marginTop: 6 }}>Select the phrase River will listen for in ambient mode.</p>
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="rs-card-label" style={{ marginBottom: 6 }}>
          SENSITIVITY: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{form.sensitivity}</span>
        </div>
        <input
          type="range" min="0.1" max="0.95" step="0.05"
          value={form.sensitivity}
          onChange={e => setForm({ ...form, sensitivity: Number(e.target.value) })}
          style={{ width: '100%', marginTop: 8 }}
        />
        <p className="rs-card-meta" style={{ marginTop: 6 }}>Higher = more sensitive, but more false positives.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
        <button className="rs-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'SAVING…' : 'SAVE WAKE WORD CONFIG'}
        </button>
        {msg && <span className="rs-card-meta" style={{ margin: 0 }}>{msg}</span>}
      </div>
    </Section>
  )
}
