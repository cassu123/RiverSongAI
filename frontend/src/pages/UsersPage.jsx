import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import Sheet from '../chrome/Sheet'

/**
 * UsersPage — Admin user management
 */

export default function UsersPage() {
  const { token, user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  
  // Password reset state
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')

  const fetchUsers = () => {
    setLoading(true)
    fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        setUsers(data)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchUsers()
  }, [token])

  const toggleForceChange = async (targetUser) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ force_password_change: !targetUser.force_password_change })
      })
      if (res.ok) {
        setUsers(users.map(u => u.id === targetUser.id ? { ...u, force_password_change: !u.force_password_change } : u))
      }
    } catch (err) {
      console.error('Failed to update user', err)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setResetError('')
    setResetSuccess('')
    
    if (newPassword.length < 12) {
      setResetError('Password must be at least 12 characters.')
      return
    }

    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ new_password: newPassword })
      })
      
      if (res.ok) {
        setResetSuccess('Password updated successfully.')
        setNewPassword('')
        // Refresh user list because server resets force_password_change to 0
        setTimeout(() => {
          setResetTarget(null)
          setResetSuccess('')
          fetchUsers()
        }, 1500)
      } else {
        const data = await res.json()
        setResetError(data.detail || 'Failed to update password.')
      }
    } catch (err) {
      setResetError('Network error.')
    }
  }

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
                <span className={`rs-pill ${u.role === 'admin' ? 'is-active' : ''}`} style={{ fontSize: '0.6rem' }}>
                  {u.role.toUpperCase()}
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
              
              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="rs-card-label" style={{ opacity: 0.8 }}>FORCE PASSWORD CHANGE</span>
                  <button 
                    className={`rs-pill ${u.force_password_change ? 'is-active' : ''}`}
                    onClick={() => toggleForceChange(u)}
                    style={{ minWidth: 60, justifyContent: 'center' }}
                  >
                    {u.force_password_change ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="rs-pill" onClick={() => { setResetTarget(u); setNewPassword(''); setResetError(''); }}>RESET PASSWORD</button>
                  {u.id !== currentUser.id && (
                    <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={() => alert('Phase 4 clearance required for termination.')}>TERMINATE</button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Sheet open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Reset Password: ${resetTarget?.display_name}`}>
        <form onSubmit={handleResetPassword} style={{ padding: '0 16px 16px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className="rs-card-label" style={{ marginBottom: 8 }}>NEW PASSWORD</div>
            <input 
              type="password"
              className="rs-chat-textarea"
              style={{ 
                background: 'var(--md-surface-container-low)', 
                border: '1px solid var(--md-outline-variant)',
                borderRadius: 12,
                padding: '12px 16px',
                width: '100%',
                boxSizing: 'border-box'
              }}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min 12 characters"
              autoFocus
            />
          </div>

          {resetError && <div style={{ color: 'var(--md-error)', fontSize: '0.8rem', marginBottom: 16 }}>{resetError}</div>}
          {resetSuccess && <div style={{ color: '#4ade80', fontSize: '0.8rem', marginBottom: 16 }}>{resetSuccess}</div>}

          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" className="rs-btn-primary" style={{ flex: 1 }}>UPDATE PASSWORD</button>
            <button type="button" className="rs-pill" onClick={() => setResetTarget(null)} style={{ height: 44 }}>CANCEL</button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}
