import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''
const USER_KEY  = 'rs-auth-user'
// Audit H-1: the JWT now lives ONLY in the HttpOnly `access_token` cookie and
// is never stored in JavaScript (localStorage/sessionStorage/memory). The app
// holds this PUBLIC sentinel in place of the token. The backend cookie-auth
// bridge (main.py) rewrites `Bearer __rs_cookie__` — and the empty/"null"
// placeholders — to the real cookie token, so every existing `Bearer ${token}`
// call site keeps authenticating via the cookie without the JWT ever touching
// JS. Keep this string in sync with main.py::_COOKIE_AUTH_SENTINEL.
const COOKIE_SENTINEL = '__rs_cookie__'
// Non-sensitive boolean flag (NOT a token) so the UI can show the revert banner.
const IMPERSONATING_KEY = 'rs-impersonating'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // `token` is the public sentinel (truthy ⇒ authenticated), never the JWT.
  const [token,         setToken]         = useState(null)
  const [user,          setUser]          = useState(() => { try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null } })
  const [loading,       setLoading]       = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)

  const [isAdminImpersonating, setIsAdminImpersonating] = useState(() => !!sessionStorage.getItem(IMPERSONATING_KEY))

  // Establish auth state from the HttpOnly cookie session on mount.
  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/setup-status`)
        const data = await res.json()
        if (data.setup_required) {
          setSetupRequired(true)
          setLoading(false)
          return
        }
      } catch {
        // server unreachable — continue to session check
      }

      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
        if (res.ok) {
          const u = await res.json()
          setUser(u)
          setToken(COOKIE_SENTINEL)
          localStorage.setItem(USER_KEY, JSON.stringify(u))
        } else {
          setToken(null); setUser(null)
          localStorage.removeItem(USER_KEY)
        }
      } catch {
        setToken(null); setUser(null)
        localStorage.removeItem(USER_KEY)
      }
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared: mark the session authenticated after the backend has set the cookie.
  const _establishSession = useCallback((u) => {
    setToken(COOKIE_SENTINEL)
    setUser(u)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  }, [])

  const setupAdmin = useCallback(async (email, password, displayName) => {
    const res = await fetch(`${API_BASE}/api/auth/setup`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Setup failed.') }
    const data = await res.json()
    setSetupRequired(false)
    _establishSession(data.user)
    return data.user
  }, [_establishSession])

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Login failed.') }
    const data = await res.json()
    // Q1#5 — 2FA step. Caller (LoginPage) renders the TOTP step from this shape.
    if (data.require_totp) {
      return { require_totp: true, challenge_token: data.challenge_token }
    }
    _establishSession(data.user)
    return data.user
  }, [_establishSession])

  const loginTotp = useCallback(async (challengeToken, code, recoveryCode) => {
    const body = recoveryCode
      ? { challenge_token: challengeToken, recovery_code: recoveryCode }
      : { challenge_token: challengeToken, code }
    const res = await fetch(`${API_BASE}/api/auth/login/totp`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '2FA check failed.') }
    const data = await res.json()
    _establishSession(data.user)
    return data.user
  }, [_establishSession])

  const signup = useCallback(async (email, password, displayName) => {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Signup failed.') }
    const data = await res.json()
    // signup returns {pending: true} — no session
    return data
  }, [])

  const loginWithGoogle = useCallback(async (code, redirectUri) => {
    const res = await fetch(`${API_BASE}/api/auth/google/callback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Google sign-in failed.') }
    const data = await res.json()
    _establishSession(data.user)
    return data.user
  }, [_establishSession])

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch (err) {
      console.warn('Server logout failed:', err)
    }
    setToken(null)
    setUser(null)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem(IMPERSONATING_KEY)
    setIsAdminImpersonating(false)
  }, [])

  // Impersonation is cookie-based (audit H-1): the backend swaps the HttpOnly
  // cookie to the target user, then we reload under the new session. No token
  // is ever exposed to JS; only a non-sensitive boolean flag is stored.
  const impersonate = useCallback(async (userId) => {
    const res = await fetch(`${API_BASE}/api/admin/users/${userId}/impersonate`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'Failed to impersonate user.') }
    sessionStorage.setItem(IMPERSONATING_KEY, '1')
    window.location.href = '/' // full reload under the impersonated cookie
  }, [])

  const revertImpersonation = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/revert-impersonation`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) { await logout(); return }
    } catch {
      await logout(); return
    }
    sessionStorage.removeItem(IMPERSONATING_KEY)
    setIsAdminImpersonating(false)
    window.location.href = '/users' // reload back into the admin session
  }, [logout])

  return (
    <AuthContext.Provider value={{ token, user, loading, setupRequired, setupAdmin, login, loginTotp, signup, loginWithGoogle, logout, impersonate, revertImpersonation, isAdminImpersonating }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
