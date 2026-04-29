// Tiny redirect-target for Google Play Books OAuth popup.
// Google redirects to /reading-oauth-callback?code=...
// This page grabs the code, writes it to localStorage, and closes itself.
// The GooglePlayConnectModal polls localStorage and completes the flow.

import { useEffect } from 'react'

export default function ReadingOAuthCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code  = params.get('code')
    const error = params.get('error')

    if (code) {
      localStorage.setItem('rs-books-oauth-code', code)
    } else if (error) {
      localStorage.setItem('rs-books-oauth-error', error)
    }

    // Close popup — if this was opened as a popup, window.close() works.
    // If it wasn't (direct navigation), redirect home instead.
    if (window.opener) {
      window.close()
    } else {
      window.location.replace('/')
    }
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'var(--font-display, monospace)',
      fontSize: '0.7rem',
      letterSpacing: '0.15em',
      color: 'var(--text-dim, #aaa)',
    }}>
      AUTHORIZING…
    </div>
  )
}
