import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * UsersPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Operator management and clearance levels.
 */

export default function UsersPage() {
  const { token } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        setUsers(data)
        setLoading(false)
      })
  }, [token])

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Personnel</h1>
        <div className="rs-greeting-sub">Manage authorized operators and identity profiles.</div>
      </div>

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">QUERYING DIRECTORY...</div>
        ) : (
          users.map(u => (
            <div key={u.id} className="rs-card">
              <div className="rs-card-head">
                <span className="rs-card-label">OPERATOR</span>
                <span className={`rs-pill ${u.is_admin ? 'is-active' : ''}`} style={{ fontSize: '0.6rem' }}>
                  {u.is_admin ? 'ADMIN' : 'USER'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="rs-status-dot" style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: 'var(--bg-base)', fontWeight: 900, fontSize: '1rem', animation: 'none' }}>
                  {u.display_name?.[0] || '?'}
                </div>
                <div>
                  <div className="rs-card-value" style={{ fontSize: '1.2rem' }}>{u.display_name}</div>
                  <div className="rs-card-meta">{u.email}</div>
                </div>
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button className="rs-pill" onClick={() => alert('Clearance adjustment locked.')}>PERMISSIONS</button>
                <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={() => alert('Account termination required Phase 4 clearance.')}>TERMINATE</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
