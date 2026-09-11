import React, { useState } from 'react'
import { useAuth } from '@context/AuthContext.jsx'

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
    <div className="rs-foyer rs-flex rs-items-center rs-justify-center rs-p-5" style={{ minHeight: '100dvh' }}>
      <div className="rs-card is-elev rs-w-full" style={{ maxWidth: 460, padding: '3rem 2.5rem' }}>
        
        <div className="rs-text-center" style={{ marginBottom: '2.5rem' }}>
          <div className="rs-flex rs-items-center rs-gap-4 rs-justify-center rs-mb-2">
            <span className="rs-pill is-active rs-type-h3" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)' }}>CORE</span>
            <span className="rs-fw-600" style={{ fontFamily: 'var(--font-mood)', fontSize: '1.6rem', letterSpacing: '0.2em' }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ opacity: 0.5 }}>INITIAL SYSTEM BOOTSTRAP</div>
        </div>

        <div className="rs-card-meta rs-mb-6 rs-text-center" style={{ lineHeight: 1.5 }}>
          No admin account detected. Please define the primary identity for this node to begin installation.
        </div>

        <form onSubmit={handleSubmit} className="rs-flex rs-flex-col rs-gap-4">
          <div>
            <div className="rs-card-label rs-mb-2" style={{ paddingLeft: 'var(--rs-space-1)' }}>PRIMARY OPERATOR</div>
            <input
              type="text"
              className="rs-pill rs-w-full rs-type-body"
              style={{ padding: 'var(--rs-space-4) var(--rs-space-5)', background: 'var(--md-surface-container)' }}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Real name or call-sign"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label rs-mb-2" style={{ paddingLeft: 'var(--rs-space-1)' }}>SYSTEM IDENTIFIER</div>
            <input
              type="email"
              className="rs-pill rs-w-full rs-type-body"
              style={{ padding: 'var(--rs-space-4) var(--rs-space-5)', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@riversong.node"
              required
            />
          </div>

          <div>
            <div className="rs-card-label rs-mb-2" style={{ paddingLeft: 'var(--rs-space-1)' }}>MASTER KEY</div>
            <input
              type="password"
              className="rs-pill rs-w-full rs-type-body"
              style={{ padding: 'var(--rs-space-4) var(--rs-space-5)', background: 'var(--md-surface-container)' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div className="rs-text-center rs-type-tiny rs-c-error">{error.toUpperCase()}</div>}

          <button className="rs-btn-primary rs-mt-2" type="submit" disabled={loading}>
            {loading ? 'INITIALIZING KERNEL...' : 'PROVISION NODE'}
          </button>
        </form>
      </div>
    </div>
  )
}
