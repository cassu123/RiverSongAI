import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const API_BASE = import.meta.env.VITE_API_URL || ''

const inputStyle = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '12px 16px',
  fontSize: '0.9rem',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: '10px',
  color: 'var(--md-on-surface)',
  outline: 'none',
  fontFamily: 'inherit',
}

const btnPrimary = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '13px 20px',
  background: 'var(--primary)',
  color: 'var(--bg-base)',
  border: 'none',
  borderRadius: '10px',
  fontWeight: 800,
  fontSize: '0.85rem',
  letterSpacing: '0.08em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginTop: 4,
}

const btnGoogle = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '11px 20px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: '10px',
  color: 'var(--md-on-surface)',
  fontWeight: 700,
  fontSize: '0.85rem',
  letterSpacing: '0.06em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
}

export default function LoginPage({ onSwitchToSignup }) {
  const { login, loginTotp } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  // Q1#5 — 2FA two-step. When non-null, render the TOTP step.
  const [challengeToken, setChallengeToken] = useState(null)
  const [totpCode,       setTotpCode]       = useState('')
  const [useRecovery,    setUseRecovery]    = useState(false)
  const [recoveryCode,   setRecoveryCode]   = useState('')

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
      const result = await login(email, password)
      if (result && result.require_totp) {
        setChallengeToken(result.challenge_token)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTotpSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (useRecovery) {
        await loginTotp(challengeToken, null, recoveryCode)
      } else {
        await loginTotp(challengeToken, totpCode, null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const cancelTotp = () => {
    setChallengeToken(null)
    setTotpCode('')
    setRecoveryCode('')
    setUseRecovery(false)
    setError('')
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 400, padding: '2.25rem 1.75rem' }}>

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
            <span className="rs-pill is-active" style={{ fontSize: '0.95rem', padding: '7px 11px' }}>RS</span>
            <span style={{ fontFamily: 'var(--font-mood)', fontSize: '1.2rem', letterSpacing: '0.12em', fontWeight: 600 }}>RIVER SONG</span>
          </div>
          <div className="rs-card-label" style={{ opacity: 0.45, fontSize: '0.65rem' }}>NEURAL LINK INTERFACE</div>
        </div>

        {!challengeToken ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: '0.62rem', opacity: 0.7 }}>IDENTIFIER</div>
            <input
              type="email"
              style={inputStyle}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div>
            <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: '0.62rem', opacity: 0.7 }}>PASS-KEY</div>
            <input
              type="password"
              style={inputStyle}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem', textAlign: 'center' }}>{error.toUpperCase()}</div>}

          <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'SYNCHRONIZING...' : 'ESTABLISH LINK'}
          </button>
        </form>
        ) : (
        <form onSubmit={handleTotpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="rs-card-label" style={{ textAlign: 'center', fontSize: '0.7rem', opacity: 0.85, marginBottom: 4 }}>
            TWO-FACTOR REQUIRED
          </div>
          {!useRecovery ? (
            <div>
              <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: '0.62rem', opacity: 0.7 }}>6-DIGIT CODE</div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                style={{ ...inputStyle, letterSpacing: '0.4em', textAlign: 'center', fontSize: '1.1rem' }}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoFocus
              />
            </div>
          ) : (
            <div>
              <div className="rs-card-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: '0.62rem', opacity: 0.7 }}>RECOVERY CODE</div>
              <input
                type="text"
                style={inputStyle}
                value={recoveryCode}
                onChange={e => setRecoveryCode(e.target.value)}
                placeholder="xxxxx-xxxxx"
                required
                autoFocus
              />
            </div>
          )}

          {error && <div style={{ color: 'var(--md-error)', fontSize: '0.75rem', textAlign: 'center' }}>{error.toUpperCase()}</div>}

          <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'VERIFYING...' : 'VERIFY'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => { setUseRecovery(!useRecovery); setError(''); setTotpCode(''); setRecoveryCode('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-on-surface-variant)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textDecoration: 'underline', fontFamily: 'inherit', opacity: 0.6 }}
            >
              {useRecovery ? 'USE AUTHENTICATOR' : 'USE RECOVERY CODE'}
            </button>
            <button
              type="button"
              onClick={cancelTotp}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-on-surface-variant)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textDecoration: 'underline', fontFamily: 'inherit', opacity: 0.6 }}
            >
              CANCEL
            </button>
          </div>
        </form>
        )}

        {!challengeToken && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '1.25rem 0' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.4 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
        </div>
        )}

        {!challengeToken && (
        <button onClick={handleGoogleSignIn} disabled={googleLoading} style={{ ...btnGoogle, opacity: googleLoading ? 0.7 : 1 }}>
          <svg width="17" height="17" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {googleLoading ? 'REDIRECTING...' : 'GOOGLE GATEWAY'}
        </button>
        )}

        {!challengeToken && (
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={onSwitchToSignup}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-on-surface-variant)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', textDecoration: 'underline', fontFamily: 'inherit', opacity: 0.6 }}
          >
            NEW OPERATOR? REGISTER HERE
          </button>
        </div>
        )}
      </div>
    </div>
  )
}
