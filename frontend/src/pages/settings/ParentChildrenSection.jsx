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
      const res = await fetch(`/api/parent/children/${child.id}/features`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ enabled_features: updated }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      console.error('Failed to update child features:', e)
      onChanged(data)
    } finally {
      setSaving(null)
    }
  }

  const globallyOn = new Set(data.globally_on || [])

  return (
    <Section title="MY CHILDREN">
      <p className="rs-card-meta rs-mb-4">
        Enable features for each child.
      </p>
      {(data.children || []).length === 0 && (
        <p className="rs-card-meta">No children linked yet.</p>
      )}
      {(data.children || []).map(child => (
        <div key={child.id} className="rs-card rs-mb-3" style={{ background: 'var(--md-surface-container-low)' }}>
          <div className="rs-flex rs-justify-between rs-items-center rs-mb-3">
            <div className="rs-fw-600">{child.display_name}</div>
            {saving === child.id && <span className="rs-card-label rs-c-accent">SAVING…</span>}
          </div>
          <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
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
