import React, { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

export default function GoogleCallbackPage({ onSuccess }) {
  const { loginWithGoogle } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam) {
      setError('Google sign-in was cancelled or denied.')
      return
    }

    if (!code) {
      setError('No authorization code received from Google.')
      return
    }

    const redirectUri = `${window.location.origin}/callback`

    loginWithGoogle(code, redirectUri)
      .then(() => {
        window.history.replaceState({}, '', '/')
        onSuccess()
      })
      .catch(err => setError(err.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: '1rem', color: 'var(--primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}>
      {error
        ? <><span style={{ color: 'var(--error, #f44)' }}>{error}</span><a href="/" style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>Back to sign in</a></>
        : <span>SIGNING IN WITH GOOGLE...</span>
      }
    </div>
  )
}
