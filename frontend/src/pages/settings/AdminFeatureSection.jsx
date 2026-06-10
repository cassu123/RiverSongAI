// =============================================================================
// src/pages/settings/AdminFeatureSection.jsx
// =============================================================================

import React, { useState } from 'react'
import { Section, Toggle } from './shared.jsx'

export default function AdminFeatureSection({ featureVis, token, onChanged }) {
  const [saving, setSaving] = useState(false)

  const toggle = async (key) => {
    const current = featureVis.hidden_features || []
    const updated = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key]

    const next = {
      ...featureVis,
      hidden_features: updated,
      all_features: featureVis.all_features.map(f =>
        f.key === key ? { ...f, hidden: !f.hidden } : f
      ),
    }
    onChanged(next)
    setSaving(true)
    try {
      await fetch('/api/admin/feature-visibility', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ hidden_features: updated }),
      })
    } catch (e) {
      onChanged(featureVis)
    } finally {
      setSaving(false)
      window.dispatchEvent(new Event('rs-features-changed'))
    }
  }

  return (
    <Section title="FEATURE VISIBILITY">
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        Hide features globally. Admin always sees everything.
        {saving && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>SAVING…</span>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {(featureVis.all_features || []).map(f => (
          <div key={f.key} style={{ background: 'var(--md-surface-container-low)', padding: 12, border: '1px solid var(--md-outline-variant)', borderRadius: 10 }}>
            <Toggle
              id={`feat-vis-${f.key}`}
              label={f.label}
              checked={!f.hidden}
              onChange={() => toggle(f.key)}
            />
          </div>
        ))}
      </div>
    </Section>
  )
}
