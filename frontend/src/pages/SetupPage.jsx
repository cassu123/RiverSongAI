import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * SetupPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Initial admin creation screen.
 */

export default function SetupPage() {
  const { setupAdmin } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await setupAdmin(email, password, displayName)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rs-foyer" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 460, padding: '3rem 2.5rem' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', marginBottom: 8 }}>
            <span className="rs-pill is-active" style={{ fontSize: '1.2rem', padding: '12px 16px' }}>CORE</span>
            <span style={{ fontFamily: 'var(--font-mood)', fontSize: '1.6rem', letterSpacing: '0.2em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ opacity: 0.5 }}>INITIAL SYSTEM BOOTSTRAP</div>
        </div>

        <div className="rs-card-meta" style={{ marginBottom: 32, textAlign: 'center', lineHeight: 1.5 }}>
          No admin account detected. Please define the primary identity for this node to begin installation.
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>PRIMARY OPERATOR</div>
            <input
              type="text"
              className="rs-pill"
              style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', background: 'var(--md-surface-container)' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Real name or call-sign"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>SYSTEM IDENTIFIER</div>
            <input
              type="email"
              className="rs-pill"
              style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@riversong.node"
              required
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 8, paddingLeft: 4 }}>MASTER KEY</div>
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
            {loading ? 'INITIALIZING KERNEL...' : 'PROVISION NODE'}
          </button>
        </form>
      </div>
    </div>
  )
}
