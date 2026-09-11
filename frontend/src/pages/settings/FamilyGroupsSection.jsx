// =============================================================================
// src/pages/settings/FamilyGroupsSection.jsx
// =============================================================================

import React, { useState } from 'react'
import { Section } from './shared.jsx'

// =============================================================================
// FamilyGroupsSection — admin manages shared-module family groups
// =============================================================================

const ALL_MODULES = [
  { key: 'culinary',    label: 'Culinary' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'store',       label: 'Store' },
  { key: 'maintenance', label: 'Garage' },
  { key: 'home_node',   label: 'Home Node' },
  { key: 'environment', label: 'Environment' },
]

const RELATIONSHIPS = ['member', 'parent', 'child', 'spouse', 'guardian', 'other']

export default function FamilyGroupsSection({ data, token, onChanged }) {
  const groups = data.groups || []
  const users  = data.users  || []

  const [newName,      setNewName]      = useState('')
  const [creating,     setCreating]     = useState(false)
  const [working,      setWorking]      = useState(false)
  const [err,          setErr]          = useState('')
  const [expandedId,   setExpandedId]   = useState(null)
  const [confirmDelId, setConfirmDelId] = useState(null)
  const [heirId,       setHeirId]       = useState('')  // who inherits on dissolve

  const reload = async () => {
    const r = await fetch('/api/admin/family-groups', {
      headers: { Authorization: `Bearer ${token}` },
    })
    onChanged(await r.json())
  }

  const createGroup = async () => {
    if (!newName.trim()) return
    setWorking(true); setErr('')
    try {
      const res = await fetch('/api/admin/family-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setNewName(''); setCreating(false)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  // A group that still owns shared data is refused with the counts and a
  // pointer to reassign_to. That refusal used to be dropped on the floor --
  // the response was never checked, so the list just reloaded unchanged and
  // the group looked like it had failed to delete for no reason.
  const deleteGroup = async (id, reassignTo = null) => {
    setWorking(true); setErr('')
    try {
      const res = await fetch(
        `/api/admin/family-groups/${id}`
        + (reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : ''),
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || 'Failed to delete group.')
      }
      setConfirmDelId(null)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const toggleModule = async (group, mod) => {
    const current = group.shared_modules || []
    const next = current.includes(mod) ? current.filter(m => m !== mod) : [...current, mod]
    setWorking(true); setErr('')
    try {
      const res = await fetch(`/api/admin/family-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shared_modules: next }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const renameGroup = async (group, name) => {
    if (!name.trim() || name.trim() === group.name) return
    setWorking(true); setErr('')
    try {
      await fetch(`/api/admin/family-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      })
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  return (
    <Section title="FAMILY GROUPS">
      <p className="rs-card-meta rs-mb-4">
        Family groups give multiple profiles shared data access to selected modules
        (culinary, inventory, store, maintenance). All members see and edit the
        same records. For controlling which features children can access, use
        Parental Controls below.
      </p>

      {err && <p className="rs-mb-3 rs-type-tiny" style={{ color: 'var(--md-error)' }}>{err}</p>}

      {/* Group list */}
      <div className="rs-flex rs-flex-col rs-gap-3 rs-mb-4">
        {groups.length === 0 && !creating && (
          <p className="settings-hint">No family groups yet.</p>
        )}
        {groups.map(group => (
          <div key={group.id}>
            <FamilyGroupCard
              group={group}
              users={users}
              token={token}
              expanded={expandedId === group.id}
              onToggleExpand={() => setExpandedId(expandedId === group.id ? null : group.id)}
              onDelete={() => { setHeirId(''); setConfirmDelId(group.id) }}
              onToggleModule={(mod) => toggleModule(group, mod)}
              onRename={(name) => renameGroup(group, name)}
              onMemberChange={reload}
              working={working}
            />
            {confirmDelId === group.id && (
              <div className="rs-flex rs-flex-col rs-gap-3 rs-mt-1 rs-type-tiny" style={{
                padding: '10px 14px',
                background: 'color-mix(in srgb, var(--md-error) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--md-error) 35%, transparent)',
                borderRadius: 8,
              }}>
                <div className="rs-flex rs-items-center rs-gap-3">
                  <span className="material-symbols-rounded rs-no-shrink" style={{ fontSize: '1rem', color: 'var(--md-error)' }}>warning</span>
                  <span className="rs-grow" style={{ color: 'var(--md-on-surface)' }}>
                    Delete <strong>{group.name}</strong>? Whatever the group holds has to go
                    to someone — nothing records who contributed which row, so it moves
                    as one piece or not at all.
                  </span>
                </div>
                {/* Naming an heir is what lets the backend proceed when the
                    group still owns data; without one it refuses, and the
                    error below says by how much. */}
                <div className="rs-flex rs-gap-2 rs-items-center rs-flex-wrap">
                  <select
                    className="settings-select"
                    value={heirId}
                    onChange={e => setHeirId(e.target.value)}
                  >
                    <option value="">— give its data to —</option>
                    {(group.members || []).map(m => (
                      <option key={m.profile_id} value={m.profile_id}>{m.display_name}</option>
                    ))}
                  </select>
                  <button className="rs-pill rs-pointer" style={{ color: 'var(--md-error)', borderColor: 'color-mix(in srgb, var(--md-error) 50%, transparent)' }}
                    onClick={() => deleteGroup(group.id, heirId || null)} disabled={working}>
                    DELETE
                  </button>
                  <button className="rs-pill rs-pointer" onClick={() => { setConfirmDelId(null); setHeirId('') }}>CANCEL</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create new group */}
      {creating ? (
        <div className="rs-flex rs-gap-2 rs-items-center rs-flex-wrap">
          <input
            className="settings-input"
            placeholder="Group name (e.g. Smith Family)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGroup()}
            autoFocus
          />
          <button className="rs-btn-primary rs-type-tiny" onClick={createGroup} disabled={working || !newName.trim()}
            style={{ padding: '8px 16px' }}>
            {working ? 'Creating…' : 'Create'}
          </button>
          <button className="rs-pill rs-pointer" onClick={() => { setCreating(false); setNewName('') }}
           >
            Cancel
          </button>
        </div>
      ) : (
        <button className="rs-pill rs-items-center rs-gap-2 rs-pointer" onClick={() => setCreating(true)}
          style={{ display: 'inline-flex' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>add</span>
          New Family Group
        </button>
      )}
    </Section>
  )
}

function FamilyGroupCard({ group, users, token, expanded, onToggleExpand, onDelete, onToggleModule, onRename, onMemberChange, working }) {
  const [editName,    setEditName]    = useState(group.name)
  const [addUserId,   setAddUserId]   = useState('')
  const [addRelation, setAddRelation] = useState('member')
  const [addWorking,  setAddWorking]  = useState(false)
  const [addErr,      setAddErr]      = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)  // {profileId, message}

  // Keep editName in sync if group.name changes from parent reload
  React.useEffect(() => { setEditName(group.name) }, [group.name])

  const memberIds = new Set((group.members || []).map(m => m.profile_id))
  const eligible  = users.filter(u => !memberIds.has(u.id))

  const addMember = async () => {
    if (!addUserId) return
    setAddWorking(true); setAddErr('')
    try {
      const res = await fetch(`/api/admin/family-groups/${group.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile_id: addUserId, relationship: addRelation }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setAddUserId('')
      await onMemberChange()
    } catch (e) { setAddErr(e.message) }
    finally { setAddWorking(false) }
  }

  // Removing a member does not hand their data back -- it stays with the
  // group. The backend refuses the first attempt and says so; `confirm` is
  // the second press, once that has actually been read.
  const removeMember = async (profileId, confirm = false) => {
    setAddWorking(true); setAddErr('')
    try {
      const res = await fetch(
        `/api/admin/family-groups/${group.id}/members/${profileId}`
        + (confirm ? '?confirm=true' : ''),
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setConfirmRemove({ profileId, message: d.detail || 'Failed to remove member.' })
        return
      }
      setConfirmRemove(null)
      await onMemberChange()
    } catch (e) { setAddErr(e.message) }
    finally { setAddWorking(false) }
  }

  return (
    <div className="rs-clip" style={{
      background: 'var(--md-surface-container)',
      border: '1px solid var(--md-outline-variant)',
      borderRadius: 10,
    }}>
      {/* Header row */}
      <div className="rs-flex rs-items-center rs-gap-3" style={{ padding: '12px 16px' }}>
        <div className="rs-grow rs-type-small" style={{ fontWeight: 600 }}>{group.name}</div>
        <div className="rs-flex rs-gap-2">
          {ALL_MODULES.map(m => (
            <span key={m.key} className="rs-type-micro" style={{
              padding: '2px 8px',
              borderRadius: 12,
              fontWeight: 600,
              background: group.shared_modules?.includes(m.key) ? 'var(--md-primary-container)' : 'var(--md-surface-container-high)',
              color: group.shared_modules?.includes(m.key) ? 'var(--md-on-primary-container)' : 'var(--md-outline)',
            }}>
              {m.label}
            </span>
          ))}
        </div>
        <span className="rs-type-micro" style={{ color: 'var(--md-outline)' }}>
          {(group.members || []).length} member{(group.members || []).length !== 1 ? 's' : ''}
        </span>
        <button onClick={onToggleExpand}
          className="rs-pointer rs-type-micro" style={{ background: 'none', border: 'none', color: 'var(--md-primary)', padding: '2px 8px' }}>
          {expanded ? 'Close' : 'Edit'}
        </button>
        <button onClick={onDelete} disabled={working}
          className="rs-pointer rs-type-micro" style={{ background: 'none', border: 'none', color: 'var(--md-error)', padding: '2px 8px' }}>
          Delete
        </button>
      </div>

      {expanded && (
        <div className="rs-flex rs-flex-col rs-gap-4" style={{ borderTop: '1px solid var(--md-outline-variant)', padding: '14px 16px' }}>

          {/* Rename */}
          <div className="rs-flex rs-gap-2 rs-items-center">
            <span className="rs-card-label" style={{ minWidth: 60 }}>NAME</span>
            <input className="settings-input rs-grow" value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => onRename(editName)}
              onKeyDown={e => e.key === 'Enter' && onRename(editName)}
            />
          </div>

          {/* Module toggles */}
          <div>
            <div className="rs-mb-2 rs-type-micro" style={{ color: 'var(--md-outline)' }}>Shared Modules</div>
            <div className="rs-flex rs-gap-2 rs-flex-wrap">
              {ALL_MODULES.map(m => {
                const on = group.shared_modules?.includes(m.key)
                return (
                  <button key={m.key} onClick={() => onToggleModule(m.key)} disabled={working}
                    className="rs-type-tiny rs-pointer" style={{
                      padding: '5px 14px',
                      borderRadius: 20,
                      border: `1px solid ${on ? 'var(--md-primary)' : 'var(--md-outline-variant)'}`,
                      background: on ? 'var(--md-primary-container)' : 'var(--md-surface-container-high)',
                      color: on ? 'var(--md-on-primary-container)' : 'var(--md-on-surface-variant)',
                      fontWeight: on ? 600 : 400,
                    }}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Members */}
          <div>
            <div className="rs-mb-2 rs-type-micro" style={{ color: 'var(--md-outline)' }}>Members</div>
            {(group.members || []).length === 0 && (
              <p className="rs-card-meta" style={{ margin: '0 0 8px' }}>No members yet.</p>
            )}
            <div className="rs-flex rs-flex-col rs-gap-1 rs-mb-3">
              {(group.members || []).map(m => (
                <div key={m.profile_id} className="rs-flex rs-items-center rs-gap-3 rs-type-tiny" style={{
                  padding: '6px 10px',
                  background: 'var(--md-surface-container-high)',
                  borderRadius: 8,
                }}>
                  <span className="rs-grow" style={{ fontWeight: 500 }}>{m.display_name}</span>
                  <span className="rs-type-micro" style={{ color: 'var(--md-outline)' }}>{m.email}</span>
                  <span className="rs-type-nano" style={{
                    padding: '1px 8px',
                    borderRadius: 12,
                    background: 'var(--md-secondary-container)',
                    color: 'var(--md-on-secondary-container)',
                  }}>{m.relationship}</span>
                  <button onClick={() => removeMember(m.profile_id)} disabled={addWorking}
                    className="rs-pointer rs-type-micro" style={{ background: 'none', border: 'none', color: 'var(--md-error)' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {confirmRemove && (
              <div className="rs-mb-3" style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)',
              }}>
                <div className="rs-mb-2 rs-type-tiny">{confirmRemove.message}</div>
                <div className="rs-flex rs-gap-2">
                  <button
                    onClick={() => removeMember(confirmRemove.profileId, true)}
                    disabled={addWorking}
                    className="rs-pointer rs-type-micro" style={{ background: 'none', border: '1px solid var(--md-error)', borderRadius: 6, padding: '4px 10px', color: 'var(--md-error)' }}>
                    Remove anyway
                  </button>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    className="rs-pointer rs-type-micro" style={{ background: 'none', border: '1px solid var(--md-outline-variant)', borderRadius: 6, padding: '4px 10px' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Add member row */}
            <div className="rs-flex rs-gap-2 rs-flex-wrap rs-items-center">
              <select className="settings-select" value={addUserId} onChange={e => setAddUserId(e.target.value)}>
                <option value="">— add member —</option>
                {eligible.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
                ))}
              </select>
              <select className="settings-select" value={addRelation} onChange={e => setAddRelation(e.target.value)}>
                {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
              </select>
              <button className="rs-btn-primary rs-type-micro" onClick={addMember} disabled={addWorking || !addUserId}
                style={{ padding: '6px 14px' }}>
                {addWorking ? 'Adding…' : 'Add'}
              </button>
            </div>
            {addErr && <p className="rs-mt-2 rs-type-micro" style={{ color: 'var(--md-error)' }}>{addErr}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
