import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * LoginPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Chromeless glass card centered on the Stage backdrop.
 */

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function LoginPage({ onSwitchToSignup }) {
  const { login } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/google/authorize`)
      if (!res.ok) throw new Error('Auth bridge offline.')
      const data = await res.json()
      const redirectUri = `${window.location.origin}/callback`
      window.location.href = `${data.auth_url}&redirect_uri=${encodeURIComponent(redirectUri)}`
    } catch (err) {
      setError(err.message)
      setGoogleLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rs-foyer" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 420, padding: '2.5rem 1.5rem' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
            <span className="rs-pill is-active" style={{ fontSize: '1rem', padding: '8px 12px' }}>RS</span>
            <span style={{ fontFamily: 'var(--font-mood)', fontSize: '1.25rem', letterSpacing: '0.12em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ opacity: 0.5, fontSize: '0.7rem' }}>NEURAL LINK INTERFACE</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 4, fontSize: '0.65rem' }}>IDENTIFIER</div>
            <input
              type="email"
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', fontSize: '0.95rem', background: 'var(--md-surface-container)' }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 4, fontSize: '0.65rem' }}>PASS-KEY</div>
            <input
              type="password"
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', fontSize: '0.95rem', background: 'var(--md-surface-container)' }}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem', textAlign: 'center' }}>{error.toUpperCase()}</div>}

          <button className="rs-btn-primary" type="submit" disabled={loading} style={{ marginTop: 4, width: '100%' }}>
            {loading ? 'SYNCHRONIZING...' : 'ESTABLISH LINK'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '1.5rem 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--md-outline-variant)' }} />
          <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--md-outline-variant)' }} />
        </div>

        <button className="rs-pill" onClick={handleGoogleSignIn} disabled={googleLoading} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 8 }}>
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          <span style={{ fontSize: '0.9rem' }}>{googleLoading ? 'REDIRECTING...' : 'GOOGLE GATEWAY'}</span>
        </button>

        <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          <button type="button" className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.7rem' }} onClick={onSwitchToSignup}>
            NEW OPERATOR? REGISTER HERE
          </button>
        </div>
      </div>
    </div>

  )
}
