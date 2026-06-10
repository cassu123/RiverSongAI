import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'rs-auth-token'
const USER_KEY  = 'rs-auth-user'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token,         setToken]         = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user,          setUser]          = useState(() => { try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null } })
  const [loading,       setLoading]       = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  
  const [isAdminImpersonating, setIsAdminImpersonating] = useState(() => !!sessionStorage.getItem('rs-admin-token'))

  // Check setup status and validate token on mount
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
        // server unreachable — continue to token check
      }

      if (!token) { setLoading(false); return }
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) {
          const u = await res.json()
          setUser(u)
          localStorage.setItem(USER_KEY, JSON.stringify(u))
        } else {
          setToken(null); setUser(null)
          localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY)
        }
      } catch {
        setToken(null); setUser(null)
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY)
      }
      setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setupAdmin = useCallback(async (email, password, displayName) => {
    const res = await fetch(`${API_BASE}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Setup failed.') }
    const data = await res.json()
    setSetupRequired(false)
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data.user
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Login failed.') }
    const data = await res.json()
    // Q1#5 — 2FA step. Caller (LoginPage) reads this object shape and
    // renders the TOTP step instead of finishing login here.
    if (data.require_totp) {
      return { require_totp: true, challenge_token: data.challenge_token }
    }
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data.user
  }, [])

  const loginTotp = useCallback(async (challengeToken, code, recoveryCode) => {
    const body = recoveryCode
      ? { challenge_token: challengeToken, recovery_code: recoveryCode }
      : { challenge_token: challengeToken, code }
    const res = await fetch(`${API_BASE}/api/auth/login/totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '2FA check failed.') }
    const data = await res.json()
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data.user
  }, [])

  const signup = useCallback(async (email, password, displayName) => {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Signup failed.') }
    const data = await res.json()
    // signup now returns {pending: true} — no token
    return data
  }, [])

  const loginWithGoogle = useCallback(async (code, redirectUri) => {
    const res = await fetch(`${API_BASE}/api/auth/google/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Google sign-in failed.') }
    const data = await res.json()
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem(TOKEN_KEY, data.token)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data.user
  }, [])

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        console.warn('Server logout failed:', err)
      }
    }
    setToken(null)
    setUser(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    sessionStorage.removeItem('rs-admin-token')
    setIsAdminImpersonating(false)
  }, [token])

  const impersonate = useCallback((newToken, impersonatedUser) => {
    sessionStorage.setItem('rs-admin-token', token)
    setToken(newToken)
    setUser(impersonatedUser)
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(impersonatedUser))
    setIsAdminImpersonating(true)
    window.location.href = '/' // Force full reload to clear any local states
  }, [token])

  const revertImpersonation = useCallback(async () => {
    const origToken = sessionStorage.getItem('rs-admin-token')
    if (origToken) {
      setToken(origToken)
      sessionStorage.removeItem('rs-admin-token')
      localStorage.setItem(TOKEN_KEY, origToken)
      setIsAdminImpersonating(false)
      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${origToken}` } })
        if (res.ok) {
          const u = await res.json()
          setUser(u)
          localStorage.setItem(USER_KEY, JSON.stringify(u))
          window.location.href = '/users' // Reload back to users page
        } else {
          logout()
        }
      } catch {
        logout()
      }
    }
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
