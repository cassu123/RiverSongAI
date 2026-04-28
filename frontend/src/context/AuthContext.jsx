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

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, loading, setupRequired, setupAdmin, login, signup, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
