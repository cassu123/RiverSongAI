import React, { useState, useEffect } from 'react'
import { useAuth } from '@context/AuthContext'
import Sheet from '../chrome/Sheet'

/**
 * UsersPage — Admin user management
 */

export default function UsersPage({ embedded = false }) {
  const { token, user: currentUser, impersonate } = useAuth()
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

  const toggleSuspend = async (targetUser) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ is_suspended: !targetUser.is_suspended })
      })
      if (res.ok) {
        setUsers(users.map(u => u.id === targetUser.id ? { ...u, is_suspended: !u.is_suspended } : u))
      }
    } catch (err) {
      console.error('Failed to suspend user', err)
    }
  }

  const toggleFreeModelsOnly = async (targetUser) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ free_models_only: !targetUser.free_models_only })
      })
      if (res.ok) {
        setUsers(users.map(u => u.id === targetUser.id ? { ...u, free_models_only: !u.free_models_only } : u))
      }
    } catch (err) {
      console.error('Failed to update free models only', err)
    }
  }

  const updateRole = async (targetUser, newRole) => {
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      })
      if (res.ok) {
        setUsers(users.map(u => u.id === targetUser.id ? { ...u, role: newRole } : u))
      } else {
        const data = await res.json()
        alert(data.detail || 'Failed to update role')
      }
    } catch (err) {
      console.error('Failed to update role', err)
      alert('Network error')
    }
  }

  const handleForceLogout = async (targetUser) => {
    if (!window.confirm(`Force logout ${targetUser.display_name} from all devices?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/force-logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) alert('All active sessions invalidated.');
      else alert('Failed to force logout.');
    } catch (err) {
      alert('Network error.');
    }
  }

  const handleImpersonate = async (targetUser) => {
    if (!window.confirm(`Login as ${targetUser.display_name}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/impersonate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json();
        impersonate(data.access_token, data.impersonated_user);
      } else {
        alert('Failed to impersonate user.');
      }
    } catch (err) {
      alert('Network error.');
    }
  }

  const handleTerminate = async (targetUser) => {
    if (!window.confirm(`Are you sure you want to terminate ${targetUser.display_name}? This action cannot be undone.`)) {
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== targetUser.id));
      } else {
        const data = await res.json();
        alert(data.detail || 'Failed to terminate user.');
      }
    } catch (err) {
      console.error('Failed to terminate user', err);
      alert('Network error.');
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
        // Refresh user list to fetch the updated force_password_change state
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

  if (currentUser?.role !== 'admin') {
    return (
      <div className="rs-card rs-text-center" style={{ padding: '48px 24px', background: '#151c27', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 24 }}>
        <span className="material-symbols-rounded rs-mb-4" style={{ fontSize: '3.2rem', color: 'var(--rs-status-critical)', display: 'block' }}>
          admin_panel_settings
        </span>
        <h3 style={{ margin: '0 0 10px', fontSize: '1.4rem', color: 'var(--fg)' }}>Administrator Clearance Required</h3>
        <p className="rs-muted rs-type-body" style={{ margin: 0, maxWidth: 500, marginInline: 'auto' }}>
          Household member and user account administration is strictly restricted to administrator profiles.
        </p>
      </div>
    )
  }

  return (
    <div className={`rs-foyer animate-fade-in ${embedded ? 'embedded-users' : ''}`}>
      {!embedded && (
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Family & Household</h1>
          <div className="rs-greeting-sub">Manage authorized members, security clearances, and model permissions.</div>
        </div>
      )}

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta rs-type-body" style={{ padding: '24px 0' }}>LOADING DIRECTORY...</div>
        ) : (
          users.map(u => (
            <div key={u.id} className="rs-card">
              <div className="rs-card-head rs-mb-4">
                <span className="rs-card-label rs-type-tiny" style={{ letterSpacing: '0.08em' }}>
                  MEMBER {u.is_suspended && <span style={{ color: 'var(--md-error)', fontWeight: 700 }}>(SUSPENDED)</span>}
                </span>
                {u.id === currentUser.id ? (
                  <span className={`rs-pill ${u.role === 'admin' ? 'is-active' : ''}`} style={{ fontSize: 'var(--rs-fs-tiny)', padding: '6px 14px' }}>
                    {u.role.toUpperCase()} (YOU)
                  </span>
                ) : (
                  <select 
                    className={`rs-pill ${u.role === 'admin' ? 'is-active' : ''}`}
                    style={{ fontSize: 'var(--rs-fs-tiny)', padding: '6px 14px', outline: 'none', border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer', textAlign: 'center', background: '#1b2432', color: '#fff' }}
                    value={u.role}
                    onChange={(e) => updateRole(u, e.target.value)}
                  >
                    <option value="admin">ADMIN</option>
                    <option value="parent">PARENT</option>
                    <option value="user">USER</option>
                    <option value="child">CHILD</option>
                    <option value="guest">GUEST</option>
                  </select>
                )}
              </div>
              <div className="rs-flex rs-items-center rs-gap-4">
                <div className="rs-status-dot rs-flex rs-items-center rs-justify-center rs-type-h3" style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--primary)', color: '#0d1219', fontWeight: 900, animation: 'none' }}>
                  {u.display_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="rs-card-value rs-type-h3" style={{ fontWeight: 700 }}>{u.display_name}</div>
                  <div className="rs-card-meta rs-type-small rs-muted">{u.email}</div>
                </div>
              </div>
              
              <div className="rs-mt-5 rs-flex rs-flex-col rs-gap-4">
                <div className="rs-flex rs-justify-between rs-items-center" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <span className="rs-card-label rs-type-tiny" style={{ color: 'var(--fg)' }}>FORCE PASSWORD CHANGE</span>
                    <span className="rs-type-tiny rs-muted" style={{ display: 'block', marginTop: 2 }}>Requires changing password on next sign-in</span>
                  </div>
                  <button 
                    className={`rs-pill ${u.force_password_change ? 'is-active' : ''}`}
                    onClick={() => toggleForceChange(u)}
                    style={{ minWidth: 70, justifyContent: 'center', padding: '8px 16px', fontSize: 'var(--rs-fs-small)' }}
                  >
                    {u.force_password_change ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="rs-flex rs-justify-between rs-items-center" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <span className="rs-card-label rs-type-tiny" style={{ color: 'var(--fg)' }}>SUSPEND ACCOUNT</span>
                    <span className="rs-type-tiny rs-muted" style={{ display: 'block', marginTop: 2 }}>Block sign-in and API access immediately</span>
                  </div>
                  <button 
                    className={`rs-pill ${u.is_suspended ? 'is-active' : ''}`}
                    onClick={() => toggleSuspend(u)}
                    style={{ minWidth: 70, justifyContent: 'center', padding: '8px 16px', fontSize: 'var(--rs-fs-small)' }}
                  >
                    {u.is_suspended ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="rs-flex rs-justify-between rs-items-center" style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <span className="rs-card-label rs-type-tiny" style={{ color: 'var(--fg)' }}>
                      FREE MODELS ONLY
                    </span>
                    <span className="rs-type-tiny rs-muted" style={{ display: 'block', marginTop: 2 }}>
                      Restricts "Let River Decide" to local + free-tier models
                    </span>
                  </div>
                  <button
                    className={`rs-pill ${u.free_models_only ? 'is-active' : ''}`}
                    onClick={() => toggleFreeModelsOnly(u)}
                    style={{ minWidth: 70, justifyContent: 'center', padding: '8px 16px', fontSize: 'var(--rs-fs-small)' }}
                  >
                    {u.free_models_only ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="rs-flex rs-gap-3 rs-flex-wrap rs-mt-2">
                  <button className="rs-pill rs-type-tiny" style={{ padding: '8px 16px' }} onClick={() => { setResetTarget(u); setNewPassword(''); setResetError(''); }}>RESET PASSWORD</button>
                  <button className="rs-pill rs-type-tiny" style={{ padding: '8px 16px' }} onClick={() => handleForceLogout(u)}>REVOKE SESSIONS</button>
                  {u.id !== currentUser.id && (
                    <>
                      <button className="rs-pill rs-type-tiny" style={{ padding: '8px 16px' }} onClick={() => handleImpersonate(u)}>IMPERSONATE</button>
                      <button className="rs-pill rs-type-tiny" style={{ color: 'var(--md-error)', padding: '8px 16px' }} onClick={() => handleTerminate(u)}>DELETE USER</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Sheet open={!!resetTarget} onClose={() => setResetTarget(null)} title={`Set Temporary Password: ${resetTarget?.display_name}`}>
        <form onSubmit={handleResetPassword} style={{ padding: '0 16px 16px' }}>
          <div className="rs-mb-5">
            <div className="rs-card-label rs-mb-2">NEW PASSWORD</div>
            <input 
              type="password"
              className="rs-chat-textarea rs-w-full"
              style={{
                background: 'var(--md-surface-container-low)',
                border: '1px solid var(--md-outline-variant)',
                borderRadius: 12,
                padding: '12px 16px',
                boxSizing: 'border-box',
              }}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Min 12 characters"
              autoFocus
            />
          </div>

          {resetError && <div className="rs-mb-4 rs-type-tiny" style={{ color: 'var(--md-error)' }}>{resetError}</div>}
          {resetSuccess && <div className="rs-mb-4 rs-type-tiny" style={{ color: 'var(--rs-status-nominal)' }}>{resetSuccess}</div>}

          <div className="rs-flex rs-gap-3">
            <button type="submit" className="rs-btn-primary rs-grow">SET PASSWORD</button>
            <button type="button" className="rs-pill" onClick={() => setResetTarget(null)} style={{ height: 44 }}>CANCEL</button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}
