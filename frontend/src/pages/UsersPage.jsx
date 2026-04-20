import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './UsersPage.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const ROLES = ['admin', 'user', 'child', 'guest']
const ROLE_LABEL = { admin: 'ADMIN', user: 'USER', child: 'CHILD', guest: 'GUEST' }

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?'
}

export default function UsersPage() {
  const { token, user: me } = useAuth()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load users.')
      setUsers(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const patch = async (userId, body) => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Update failed.') }
    const updated = await res.json()
    setUsers(u => u.map(x => x.id === userId ? updated : x))
  }

  const handleApprove = (userId) => patch(userId, { is_approved: true })
  const handleRoleChange = (userId, role) => patch(userId, { role })

  const fmtDate = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const pending = users.filter(u => !u.is_approved)
  const approved = users.filter(u => u.is_approved)

  return (
    <div className="page-wrap users-wrap">
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
            {approved.length} approved · {pending.length} pending
          </div>
        </div>
        <button className="btn" onClick={fetchUsers} disabled={loading}>
          {loading ? 'LOADING...' : 'REFRESH'}
        </button>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      {/* Pending approvals */}
      {pending.length > 0 && (
        <>
          <div className="card-title" style={{ marginBottom: 10, color: '#f59e0b' }}>PENDING APPROVAL</div>
          <div className="users-grid" style={{ marginBottom: 24 }}>
            {pending.map(u => (
              <div key={u.id} className="card users-card" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
                <div className="users-card-top">
                  <div className="users-avatar users-avatar--user" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                    {initials(u.display_name)}
                  </div>
                  <div className="users-card-info">
                    <div className="users-card-name">{u.display_name}</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{u.email}</div>
                    <span className="users-role-badge" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>PENDING</span>
                  </div>
                  <button className="btn btn--cta" style={{ fontSize: 11 }} onClick={() => handleApprove(u.id)}>APPROVE</button>
                </div>
                <div className="users-card-meta">Registered {fmtDate(u.created_at)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Approved users */}
      <div className="card-title" style={{ marginBottom: 10 }}>OPERATORS</div>
      {approved.length === 0 ? (
        <div className="card users-empty">
          <div className="users-empty-text">No approved operators yet.</div>
        </div>
      ) : (
        <div className="users-grid">
          {approved.map(u => (
            <div key={u.id} className="card users-card">
              <div className="users-card-top">
                <div className={`users-avatar users-avatar--${u.role}`}>
                  {initials(u.display_name)}
                </div>
                <div className="users-card-info">
                  <div className="users-card-name">{u.display_name}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{u.email}</div>
                  <span className={`users-role-badge users-role-badge--${u.role}`}>
                    {ROLE_LABEL[u.role] || u.role.toUpperCase()}
                  </span>
                </div>
              </div>
              {u.id !== me?.id && (
                <div className="users-form-row" style={{ marginTop: 10, alignItems: 'center' }}>
                  <label className="users-form-label" style={{ fontSize: 10 }}>ROLE</label>
                  <div className="users-role-group">
                    {ROLES.map(r => (
                      <button
                        key={r}
                        type="button"
                        className={`users-role-btn ${u.role === r ? 'users-role-btn--on' : ''}`}
                        onClick={() => u.role !== r && handleRoleChange(u.id, r)}
                      >
                        {ROLE_LABEL[r]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="users-card-meta">Joined {fmtDate(u.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
