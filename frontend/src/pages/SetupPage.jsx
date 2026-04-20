import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './LoginPage.css'

export default function SetupPage() {
  const { setupAdmin } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setError('')
    setLoading(true)
    try {
      await setupAdmin(email, password, displayName)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-badge">RS</span>
          <span className="auth-logo-name">RIVER SONG</span>
        </div>

        <p className="auth-tagline">First-Time Setup</p>

        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#93c5fd', lineHeight: 1.5 }}>
          No admin account exists yet. Create the master admin account to get started.
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. River Song"
              required
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>

          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="auth-field">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-btn auth-btn--primary" type="submit" disabled={loading}>
            {loading ? 'CREATING ADMIN...' : 'CREATE ADMIN ACCOUNT'}
          </button>
        </form>
      </div>
    </div>
  )
}
