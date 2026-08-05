// =============================================================================
// src/pages/settings/AdminFamilySection.jsx
//
// NOTE: not currently rendered by SettingsPage (same as before the split).
// =============================================================================

import React, { useState } from 'react'
import { Section } from './shared.jsx'

// =============================================================================
// AdminFamilySection — admin assigns parent-child relationships
// =============================================================================

export default function AdminFamilySection({ data, token, onChanged }) {
  const [parentSel, setParentSel] = useState('')
  const [childSel,  setChildSel]  = useState('')
  const [working,   setWorking]   = useState(false)
  const [err,       setErr]       = useState('')

  const users    = data.users    || []
  const links    = data.links    || []
  const parents  = users.filter(u => ['parent', 'user', 'admin'].includes(u.role))
  const children = users.filter(u => u.role === 'child')

  const linked = (parentId, childId) =>
    links.some(l => l.parent_id === parentId && l.child_id === childId)

  const addLink = async () => {
    if (!parentSel || !childSel) return
    setWorking(true); setErr('')
    try {
      const res = await fetch('/api/admin/family', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ parent_id: parentSel, child_id: childSel }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      const r = await fetch('/api/admin/family', { headers: { Authorization: `Bearer ${token}` } })
      onChanged(await r.json())
      setParentSel(''); setChildSel('')
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const removeLink = async (parentId, childId) => {
    setWorking(true); setErr('')
    try {
      await fetch(`/api/admin/family/${parentId}/${childId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const r = await fetch('/api/admin/family', { headers: { Authorization: `Bearer ${token}` } })
      onChanged(await r.json())
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  return (
    <Section title="PARENTAL CONTROLS">
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        Link parent accounts to child accounts to control which features children
        can access. This is separate from Family Groups — parental controls manage
        feature visibility only, not shared data.
      </p>

      {/* Add link */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select className="settings-select" value={parentSel} onChange={e => setParentSel(e.target.value)}>
          <option value="">— select parent —</option>
          {parents.map(u => (
            <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
          ))}
        </select>
        <span style={{ color: 'var(--md-outline)', fontSize: '0.85rem' }}>→</span>
        <select className="settings-select" value={childSel} onChange={e => setChildSel(e.target.value)}>
          <option value="">— select child —</option>
          {children.map(u => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
        <button
          className="rs-btn-primary"
          onClick={addLink}
          disabled={!parentSel || !childSel || working}
          style={{ padding: '6px 16px', fontSize: '0.8rem' }}
        >
          {working ? 'Saving…' : 'Link'}
        </button>
      </div>
      {err && <p style={{ color: 'var(--md-error)', fontSize: '0.8rem', marginBottom: 8 }}>{err}</p>}

      {/* Existing links */}
      {links.length === 0 && (
        <p className="rs-card-meta">No parent-child links yet.</p>
      )}
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {links.map(l => {
            const parent = users.find(u => u.id === l.parent_id)
            const child  = users.find(u => u.id === l.child_id)
            return (
              <div key={`${l.parent_id}-${l.child_id}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px',
                background: 'var(--md-surface-container)',
                borderRadius: 8, fontSize: '0.82rem',
              }}>
                <span style={{ flex: 1 }}>
                  <strong>{parent?.display_name || l.parent_id}</strong>
                  <span style={{ color: 'var(--md-outline)', margin: '0 6px' }}>→</span>
                  <strong>{child?.display_name || l.child_id}</strong>
                </span>
                <button
                  onClick={() => removeLink(l.parent_id, l.child_id)}
                  disabled={working}
                  style={{ fontSize: '0.72rem', color: 'var(--md-error)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
