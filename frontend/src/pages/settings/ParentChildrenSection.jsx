// =============================================================================
// src/pages/settings/ParentChildrenSection.jsx
// =============================================================================

import React, { useState } from 'react'
import { Section, Toggle } from './shared.jsx'

export default function ParentChildrenSection({ data, token, onChanged }) {
  const [saving, setSaving] = useState(null)

  const toggle = async (child, featureKey) => {
    const current  = child.enabled_features || []
    const updated  = current.includes(featureKey)
      ? current.filter(k => k !== featureKey)
      : [...current, featureKey]

    const newChildren = data.children.map(c =>
      c.id === child.id ? { ...c, enabled_features: updated } : c
    )
    onChanged({ ...data, children: newChildren })
    setSaving(child.id)

    try {
      await fetch(`/api/parent/children/${child.id}/features`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ enabled_features: updated }),
      })
    } catch (e) {
      onChanged(data)
    } finally {
      setSaving(null)
    }
  }

  const globallyOn = new Set(data.globally_on || [])

  return (
    <Section title="MY CHILDREN">
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        Enable features for each child.
      </p>
      {(data.children || []).length === 0 && (
        <p className="rs-card-meta">No children linked yet.</p>
      )}
      {(data.children || []).map(child => (
        <div key={child.id} className="rs-card" style={{ background: 'var(--md-surface-container-low)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{child.display_name}</div>
            {saving === child.id && <span className="rs-card-label" style={{ color: 'var(--primary)' }}>SAVING…</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {(data.globally_on || []).map(key => {
              const enabled  = (child.enabled_features || []).includes(key)
              const locked   = !globallyOn.has(key)
              return (
                <div key={key} style={{ opacity: locked ? 0.4 : 1 }}>
                  <Toggle
                    id={`child-${child.id}-${key}`}
                    label={key.replace('_', ' ').toLowerCase()}
                    checked={enabled}
                    onChange={() => !locked && toggle(child, key)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Section>
  )
}
