import React, { useState } from 'react'
import './UsersPage.css'

const ROLES = ['admin', 'user', 'child']

const ROLE_LABEL = { admin: 'ADMIN', user: 'USER', child: 'CHILD' }

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?'
}

function loadUsers() {
  try {
    const v = localStorage.getItem('rs-users')
    return v ? JSON.parse(v) : []
  } catch { return [] }
}

function saveUsers(users) {
  try { localStorage.setItem('rs-users', JSON.stringify(users)) } catch {}
}

const BLANK_FORM = { displayName: '', role: 'user', note: '' }

export default function UsersPage() {
  const [users,   setUsers]   = useState(loadUsers)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState(BLANK_FORM)
  const [confirm, setConfirm] = useState(null)   // id to confirm delete

  const saveAndSet = (next) => { setUsers(next); saveUsers(next) }

  const handleAdd = (e) => {
    e.preventDefault()
    if (!form.displayName.trim()) return
    const next = [...users, {
      id:          crypto.randomUUID(),
      displayName: form.displayName.trim(),
      role:        form.role,
      note:        form.note.trim(),
      addedAt:     new Date().toISOString(),
    }]
    saveAndSet(next)
    setForm(BLANK_FORM)
    setAdding(false)
  }

  const handleDelete = (id) => {
    saveAndSet(users.filter(u => u.id !== id))
    setConfirm(null)
  }

  const fmtDate = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const adminCount = users.filter(u => u.role === 'admin').length

  return (
    <div className="page-wrap users-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>ADMIN</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>OPERATORS &amp; CLEARANCE</span>
          </div>
          <h1 className="page-title">Users</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            {users.length} operator{users.length !== 1 ? 's' : ''} registered.
          </div>
        </div>

        <div className="page-header-actions">
          <button className="btn btn--cta" onClick={() => { setAdding(true); setForm(BLANK_FORM) }}>
            + ADD USER
          </button>
        </div>
      </div>

      {/* Add user form */}
      {adding && (
        <div className="card users-add-card">
          <div className="card-title">NEW OPERATOR</div>
          <form className="users-form" onSubmit={handleAdd}>
            <div className="users-form-row">
              <label className="users-form-label">DISPLAY NAME</label>
              <input
                className="users-form-input"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="e.g. Jamie W."
                autoFocus
                required
              />
            </div>
            <div className="users-form-row">
              <label className="users-form-label">ROLE</label>
              <div className="users-role-group">
                {ROLES.map(r => (
                  <button
                    key={r}
                    type="button"
                    className={`users-role-btn ${form.role === r ? 'users-role-btn--on' : ''}`}
                    onClick={() => setForm(f => ({ ...f, role: r }))}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            </div>
            <div className="users-form-row">
              <label className="users-form-label">NOTE <span className="users-form-optional">(optional)</span></label>
              <input
                className="users-form-input"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="e.g. Primary admin, family member…"
              />
            </div>
            <div className="users-form-actions">
              <button className="btn btn--primary" type="submit">ADD OPERATOR</button>
              <button className="btn" type="button" onClick={() => setAdding(false)}>CANCEL</button>
            </div>
          </form>
        </div>
      )}

      {/* User list */}
      {users.length === 0 ? (
        <div className="card users-empty">
          <div className="users-empty-text">No operators registered yet. Add your first user above.</div>
        </div>
      ) : (
        <div className="users-grid">
          {users.map(u => (
            <div key={u.id} className="card users-card">
              <div className="users-card-top">
                <div className={`users-avatar users-avatar--${u.role}`}>
                  {initials(u.displayName)}
                </div>
                <div className="users-card-info">
                  <div className="users-card-name">{u.displayName}</div>
                  <span className={`users-role-badge users-role-badge--${u.role}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                </div>
                {confirm === u.id ? (
                  <div className="users-confirm-row">
                    <span className="users-confirm-text">Remove?</span>
                    <button className="btn users-confirm-yes" onClick={() => handleDelete(u.id)}>YES</button>
                    <button className="btn" onClick={() => setConfirm(null)}>NO</button>
                  </div>
                ) : (
                  <button
                    className="btn users-remove-btn"
                    onClick={() => setConfirm(u.id)}
                    title="Remove user"
                  >
                    ✕
                  </button>
                )}
              </div>
              {u.note && <div className="users-card-note">{u.note}</div>}
              <div className="users-card-meta">Added {fmtDate(u.addedAt)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Footer note */}
      <div className="users-footer-note">
        User profiles are stored locally. Full authentication and per-user data isolation
        will be added in a future phase. Admin role grants access to all admin-only pages.
      </div>
    </div>
  )
}
