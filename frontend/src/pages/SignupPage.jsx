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
    <div className="rs-flex rs-items-center rs-justify-center rs-relative" style={{ zIndex: 1, minHeight: '100dvh', padding: 'var(--rs-space-4)' }}>
      <div className="rs-card is-elev rs-w-full" style={{ maxWidth: 420, padding: '2.5rem 1.5rem' }}>
        
        <div className="rs-text-center" style={{ marginBottom: '2rem' }}>
          <div className="rs-flex rs-items-center rs-gap-3 rs-justify-center rs-mb-2">
            <span className="rs-pill is-active rs-type-body" style={{ padding: 'var(--rs-space-2) var(--rs-space-3)' }}>RS</span>
            <span className="rs-type-h3" style={{ fontFamily: 'var(--font-mood)', letterSpacing: '0.12em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label rs-muted rs-type-nano">NEW OPERATOR REGISTRATION</div>
        </div>

        <form onSubmit={handleSubmit} className="rs-flex rs-flex-col rs-gap-4">
          <div>
            <div className="rs-card-label rs-mb-2 rs-type-nano" style={{ paddingLeft: 'var(--rs-space-1)' }}>CALL-SIGN</div>
            <input
              type="text"
              className="rs-pill rs-w-full rs-type-small"
              style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label rs-mb-2 rs-type-nano" style={{ paddingLeft: 'var(--rs-space-1)' }}>IDENTIFIER (EMAIL)</div>
            <input
              type="email"
              className="rs-pill rs-w-full rs-type-small"
              style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <div className="rs-card-label rs-mb-2 rs-type-nano" style={{ paddingLeft: 'var(--rs-space-1)' }}>ENCRYPTION KEY</div>
            <input
              type="password"
              className="rs-pill rs-w-full rs-type-small"
              style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="rs-text-center rs-type-micro" style={{ color: 'var(--md-error)' }}>{error.toUpperCase()}</div>}

          <button className="rs-btn-primary rs-mt-1 rs-w-full" type="submit" disabled={loading}>
            {loading ? 'INITIALIZING...' : 'AUTHORIZE ACCOUNT'}
          </button>
        </form>

        <div className="rs-text-center" style={{ marginTop: '1.5rem' }}>
          <button type="button" className="rs-card-label rs-pointer rs-type-nano" style={{ background: 'none', border: 'none', textDecoration: 'underline' }} onClick={onSwitchToLogin}>
            ALREADY AUTHORIZED? SIGN IN
          </button>
        </div>
      </div>
    </div>

  )
}
