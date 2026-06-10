// =============================================================================
// src/pages/settings/AdminModelFamiliesSection.jsx
// =============================================================================

import React, { useState, useEffect } from 'react'
import { MODEL_FAMILIES, TIER_ORDER, TIER_META } from '../../utils/modelFamilies.js'
import { Section, Toggle } from './shared.jsx'

// =============================================================================
// AdminModelFamiliesSection — Phase B: toggle / rename / remap families that
// appear in the Chat picker. Defaults live in utils/modelFamilies.js; overrides
// persist to admin_config["model_families"] and ride along with /api/models.
// =============================================================================

export default function AdminModelFamiliesSection({ token }) {
  const [overrides, setOverrides] = useState({})
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState('')

  useEffect(() => {
    fetch('/api/settings/model-families', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { families: {} })
      .then(data => {
        setOverrides(data.families || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [token])

  const update = (familyId, patch) => {
    setOverrides(prev => ({
      ...prev,
      [familyId]: { ...(prev[familyId] || {}), ...patch },
    }))
  }
  const updateTier = (familyId, tier, value) => {
    setOverrides(prev => ({
      ...prev,
      [familyId]: {
        ...(prev[familyId] || {}),
        tiers: { ...(prev[familyId]?.tiers || {}), [tier]: value || null },
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/settings/model-families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ families: overrides }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMsg('Saved. Reload Chat to see updates.')
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Section title="MODEL FAMILIES">
      <p className="rs-card-meta" style={{ marginBottom: 12 }}>
        Toggle which families appear in the Chat picker, give them quirky names, and
        override the model_id each tier maps to. Leave any field blank to use the default.
        Overrides are not validated against the registry — invalid model_ids just show
        as unavailable in the picker.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {MODEL_FAMILIES.map(family => {
          const ov = overrides[family.id] || {}
          const enabled = ov.enabled !== false  // default true
          return (
            <div
              key={family.id}
              style={{ padding: 12, opacity: enabled ? 1 : 0.55, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {family.displayName}
                    {ov.quirky_name && (
                      <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: 'var(--md-primary)' }}>
                        → {ov.quirky_name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--md-outline)' }}>
                    {family.provider} · {family.blurb}
                  </div>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={v => update(family.id, { enabled: v })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                <label style={{ fontSize: '0.72rem' }}>
                  <span style={{ display: 'block', color: 'var(--md-outline)', marginBottom: 2 }}>
                    Quirky name
                  </span>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder={family.displayName}
                    value={ov.quirky_name || ''}
                    onChange={e => update(family.id, { quirky_name: e.target.value || null })}
                    style={{ width: '100%' }}
                    disabled={!enabled}
                  />
                </label>

                {TIER_ORDER.map(tier => (
                  <label key={tier} style={{ fontSize: '0.72rem' }}>
                    <span style={{ display: 'block', color: 'var(--md-outline)', marginBottom: 2 }}>
                      {TIER_META[tier].label} model_id
                    </span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={family.tiers[tier] || '(not mapped)'}
                      value={ov.tiers?.[tier] || ''}
                      onChange={e => updateTier(family.id, tier, e.target.value)}
                      style={{ width: '100%' }}
                      disabled={!enabled}
                    />
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button className="rs-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'SAVING…' : 'SAVE FAMILY OVERRIDES'}
        </button>
        {msg && <span className="rs-card-meta" style={{ margin: 0 }}>{msg}</span>}
      </div>
    </Section>
  )
}
