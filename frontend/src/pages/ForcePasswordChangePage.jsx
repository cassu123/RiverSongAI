import React, { useState } from 'react'
import { useAuth } from '@context/AuthContext'

/**
 * ForcePasswordChangePage — Mandatory security update screen.
 * Replaces the entire app UI when force_password_change is active.
 */
export default function ForcePasswordChangePage() {
  const { token, logout } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/force-change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ new_password: newPassword })
      })
      
      if (res.ok) {
        setSuccess(true)
        // Auto-logout after 2 seconds to force a fresh login with the new password
        setTimeout(() => {
          logout()
        }, 2000)
      } else {
        const data = await res.json()
        setError(data.detail || 'Failed to update password.')
      }
    } catch (err) {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rs-root rs-flex rs-items-center rs-justify-center" style={{ background: 'var(--bg-base)' }}>
      <div className="rs-card animate-fade-in" style={{ maxWidth: 400, width: '90%' }}>
        <header className="rs-card-head">
          <span className="rs-card-label" style={{ color: 'var(--md-error)' }}>SECURITY UPDATE REQUIRED</span>
        </header>
        
        <h1 className="rs-greeting rs-mb-3" style={{ fontSize: '1.5rem' }}>New Credentials</h1>
        <p className="rs-card-meta rs-mb-5">An administrator has requested a mandatory password update for your account.</p>

        {success ? (
          <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
            <div className="rs-status-dot rs-flex rs-items-center rs-justify-center" style={{ width: 48, height: 48, margin: '0 auto 16px', background: '#4ade80', animation: 'none', borderRadius: '50%' }}>
              <span className="material-symbols-rounded" style={{ color: 'var(--bg-base)' }}>check</span>
            </div>
            <div className="rs-card-value rs-type-h3">Update Complete</div>
            <div className="rs-card-meta">Re-authenticating...</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rs-flex rs-flex-col rs-gap-5">
            <div>
              <div className="rs-card-label rs-mb-2">NEW PASSWORD</div>
              <input 
                type="password"
                className="rs-chat-textarea rs-w-full"
                style={{
                  background: 'var(--md-surface-container-low)',
                  border: '1px solid var(--md-outline-variant)',
                  borderRadius: 'var(--md-shape-md)',
                  padding: 'var(--rs-space-3) var(--rs-space-4)',
                  boxSizing: 'border-box',
                }}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min 12 characters"
                disabled={loading}
                autoFocus
              />
            </div>

            <div>
              <div className="rs-card-label rs-mb-2">CONFIRM PASSWORD</div>
              <input 
                type="password"
                className="rs-chat-textarea rs-w-full"
                style={{
                  background: 'var(--md-surface-container-low)',
                  border: '1px solid var(--md-outline-variant)',
                  borderRadius: 'var(--md-shape-md)',
                  padding: 'var(--rs-space-3) var(--rs-space-4)',
                  boxSizing: 'border-box',
                }}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                disabled={loading}
              />
            </div>

            {error && <div className="rs-type-tiny" style={{ color: 'var(--md-error)' }}>{error}</div>}

            <div className="rs-flex rs-gap-3 rs-mt-3">
              <button type="submit" className="rs-btn-primary rs-grow" disabled={loading}>
                {loading ? 'PROCESSING...' : 'UPDATE & LOGIN'}
              </button>
              <button type="button" className="rs-pill" onClick={logout} disabled={loading} style={{ height: 44 }}>LOGOUT</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
