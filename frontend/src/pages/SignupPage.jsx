import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * SignupPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Chromeless glass card for new operators.
 */

export default function SignupPage({ onSwitchToLogin }) {
  const { signup } = useAuth()
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error,       setError]       = useState('')
  const [loading,     setLoading]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signup(email, password, displayName)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rs-foyer" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 420, padding: '3rem 2.5rem' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', marginBottom: 8 }}>
            <span className="rs-pill is-active" style={{ fontSize: '1.1rem', padding: '10px 14px' }}>RS</span>
            <span style={{ fontFamily: 'var(--font-mood)', fontSize: '1.5rem', letterSpacing: '0.15em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ opacity: 0.5 }}>NEW OPERATOR REGISTRATION</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>CALL-SIGN</div>
            <input
              type="text"
              className="rs-pill"
              style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', background: 'var(--md-surface-container)' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>IDENTIFIER (EMAIL)</div>
            <input
              type="email"
              className="rs-pill"
              style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>ENCRYPTION KEY</div>
            <input
              type="password"
              className="rs-pill"
              style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', background: 'var(--md-surface-container)' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div style={{ color: 'var(--md-error)', fontSize: '0.8rem', textAlign: 'center' }}>{error.toUpperCase()}</div>}

          <button className="rs-btn-primary" type="submit" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'INITIALIZING...' : 'AUTHORIZE ACCOUNT'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button type="button" className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={onSwitchToLogin}>
            ALREADY AUTHORIZED? SIGN IN
          </button>
        </div>
      </div>
    </div>
  )
}
