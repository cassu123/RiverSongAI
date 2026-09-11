import React, { useState } from 'react'
import { useAuth } from '@context/AuthContext.jsx'

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
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 420, padding: '2.5rem 1.5rem' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="rs-flex rs-items-center rs-gap-3 rs-justify-center rs-mb-2">
            <span className="rs-pill is-active" style={{ fontSize: 'var(--rs-fs-body)', padding: '8px 12px' }}>RS</span>
            <span style={{ fontFamily: 'var(--font-mood)', fontSize: 'var(--rs-fs-h3)', letterSpacing: '0.12em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>NEW OPERATOR REGISTRATION</div>
        </div>

        <form onSubmit={handleSubmit} className="rs-flex rs-flex-col rs-gap-4">
          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 4, fontSize: 'var(--rs-fs-nano)' }}>CALL-SIGN</div>
            <input
              type="text"
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', fontSize: 'var(--rs-fs-small)', background: 'var(--md-surface-container)' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 4, fontSize: 'var(--rs-fs-nano)' }}>IDENTIFIER (EMAIL)</div>
            <input
              type="email"
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', fontSize: 'var(--rs-fs-small)', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 4, fontSize: 'var(--rs-fs-nano)' }}>ENCRYPTION KEY</div>
            <input
              type="password"
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', fontSize: 'var(--rs-fs-small)', background: 'var(--md-surface-container)' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div style={{ color: 'var(--md-error)', fontSize: 'var(--rs-fs-micro)', textAlign: 'center' }}>{error.toUpperCase()}</div>}

          <button className="rs-btn-primary rs-mt-1 rs-w-full" type="submit" disabled={loading}>
            {loading ? 'INITIALIZING...' : 'AUTHORIZE ACCOUNT'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button type="button" className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 'var(--rs-fs-nano)' }} onClick={onSwitchToLogin}>
            ALREADY AUTHORIZED? SIGN IN
          </button>
        </div>
      </div>
    </div>

  )
}
