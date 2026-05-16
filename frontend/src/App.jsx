import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useAuth }        from './context/AuthContext.jsx'
import Sidebar            from './components/Sidebar.jsx'
import ErrorBoundary      from './components/ErrorBoundary.jsx'

// Lazy load pages
const LoginPage          = lazy(() => import('./pages/LoginPage.jsx'))
const SignupPage         = lazy(() => import('./pages/SignupPage.jsx'))
const SetupPage          = lazy(() => import('./pages/SetupPage.jsx'))
const DashboardPage      = lazy(() => import('./pages/DashboardPage.jsx'))
const ConversationPage   = lazy(() => import('./pages/ConversationPage.jsx'))
const ChatPage           = lazy(() => import('./pages/ChatPage.jsx'))
const MemoryPage         = lazy(() => import('./pages/MemoryPage.jsx'))
const RoutinesPage       = lazy(() => import('./pages/RoutinesPage.jsx'))
const HomeNodePage       = lazy(() => import('./pages/HomeNodePage.jsx'))
const UsersPage          = lazy(() => import('./pages/UsersPage.jsx'))
const KillSwitchPage     = lazy(() => import('./pages/KillSwitchPage.jsx'))
const ProfilePage        = lazy(() => import('./pages/ProfilePage.jsx'))
const SettingsPage       = lazy(() => import('./pages/SettingsPage.jsx'))
const FeedsPage          = lazy(() => import('./pages/FeedsPage.jsx'))
const GooglePage         = lazy(() => import('./pages/GooglePage.jsx'))
const CommercePage       = lazy(() => import('./pages/CommercePage.jsx'))
const ReadingPage        = lazy(() => import('./pages/ReadingPage.jsx'))
const AnalyticsPage      = lazy(() => import('./pages/AnalyticsPage.jsx'))
const InventoryPage           = lazy(() => import('./pages/InventoryPage.jsx'))
const ChronosPage             = lazy(() => import('./pages/ChronosPage.jsx'))
const MaintenancePulsePage    = lazy(() => import('./pages/MaintenancePulsePage.jsx'))
const CulinaryPage            = lazy(() => import('./pages/CulinaryPage.jsx'))
const EnvironmentPage         = lazy(() => import('./pages/EnvironmentPage.jsx'))
const GoogleCallbackPage      = lazy(() => import('./pages/GoogleCallbackPage.jsx'))
const ReadingOAuthCallbackPage = lazy(() => import('./pages/ReadingOAuthCallbackPage.jsx'))

import { ADMIN_PAGES, ALWAYS_VISIBLE, USER_ITEMS, ADMIN_ITEMS } from './utils/constants.js'

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export default function App() {
  const { user, token, loading, logout, setupRequired } = useAuth()
  const [authView,      setAuthView]      = useState('login') // 'login' | 'signup'
  const [enabledFeatures, setEnabledFeatures] = useState(null) // null = not loaded yet
  const [currentPage,   setCurrentPage]   = useState(() => load('rs-page', 'speak'))
  const [adminMode,     setAdminMode]     = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const themeKey = user ? `rs-theme:${user.id}` : 'rs-theme'
  const [theme,       setTheme]       = useState(() => load(user ? `rs-theme:${user.id}` : 'rs-theme', 'halo'))
  const paletteKey = user ? `rs-palette:${user.id}` : 'rs-palette'
  const envKey     = user ? `rs-env:${user.id}`     : 'rs-env'
  const [palette,     setPalette]     = useState(() => load(paletteKey, 'spice'))
  const [environment, setEnvironment] = useState(() => load(envKey, 'atreides'))

  const [profile,     setProfile]     = useState(() => {
    if (user) return { displayName: user.display_name, username: user.email, birthday: '' }
    return load('rs-profile', { displayName: 'User', username: '', birthday: '' })
  })

  useEffect(() => { save('rs-page',    currentPage) }, [currentPage])
  useEffect(() => { save('rs-admin',   adminMode)   }, [adminMode])
  useEffect(() => { save('rs-profile', profile)     }, [profile])
  useEffect(() => {
    save(themeKey, theme)
    document.documentElement.setAttribute('data-theme', theme)
    // Push theme to server so Android app and other devices stay in sync
    if (user) {
      const token = load('rs-auth-token', null)
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ theme }),
        }).catch(() => {}) // silent — local is already applied
      }
    }
  }, [theme]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    save(paletteKey, palette)
    document.documentElement.setAttribute('data-palette', palette)
    if (user) {
      const token = load('rs-auth-token', null)
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ palette }),
        }).catch(() => {})
      }
    }
  }, [palette]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    save(envKey, environment)
    document.documentElement.setAttribute('data-env', environment)
    if (user) {
      const token = load('rs-auth-token', null)
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ environment }),
        }).catch(() => {})
      }
    }
  }, [environment]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-palette', palette)
    document.documentElement.setAttribute('data-env', environment)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync display name and theme when user changes (login/logout)
  // On login: pull theme from server so it matches across all devices
  useEffect(() => {
    if (user) {
      setProfile(p => ({ ...p, displayName: user.display_name, username: user.email }))
      const token = load('rs-auth-token', null)
      fetch('/api/auth/profile', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const serverTheme = data?.theme
          const localTheme = load(`rs-theme:${user.id}`, null)
          // Server wins if it has a theme; otherwise fall back to local, then default
          const resolved = serverTheme || localTheme || 'halo'
          save(`rs-theme:${user.id}`, resolved)
          setTheme(resolved)
          document.documentElement.setAttribute('data-theme', resolved)

          const serverPalette = data?.palette
          const localPalette  = load(`rs-palette:${user.id}`, null)
          const resolvedP = serverPalette || localPalette || 'spice'
          save(`rs-palette:${user.id}`, resolvedP)
          setPalette(resolvedP)
          document.documentElement.setAttribute('data-palette', resolvedP)

          const serverEnv = data?.environment
          const localEnv  = load(`rs-env:${user.id}`, null)
          const resolvedE = serverEnv || localEnv || 'atreides'
          save(`rs-env:${user.id}`, resolvedE)
          setEnvironment(resolvedE)
          document.documentElement.setAttribute('data-env', resolvedE)
        })
        .catch(() => {
          const saved = load(`rs-theme:${user.id}`, 'halo')
          setTheme(saved)
          document.documentElement.setAttribute('data-theme', saved)

          const savedP = load(`rs-palette:${user.id}`, 'spice')
          setPalette(savedP)
          document.documentElement.setAttribute('data-palette', savedP)

          const savedE = load(`rs-env:${user.id}`, 'atreides')
          setEnvironment(savedE)
          document.documentElement.setAttribute('data-env', savedE)
        })
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const PAL_ENV_PAIRS = {
    spice: ['atreides',   'harkonnen'],
    halo:  ['forerunner', 'unsc'],
  }

  const setPaletteSafe = (p) => {
    setPalette(p)
    const valid = PAL_ENV_PAIRS[p]
    if (!valid.includes(environment)) {
      setEnvironment(valid[0])  // jump to first env of the new palette
    }
  }

  // True if the logged-in user has the admin role
  const userIsAdmin = user?.role === 'admin'

  // When a new user logs in, default admin mode ON if they're an admin
  useEffect(() => {
    setAdminMode(userIsAdmin)
  }, [userIsAdmin])

  // Load enabled features whenever user/token changes
  useEffect(() => {
    if (!user || !token) { setEnabledFeatures(null); return }
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setEnabledFeatures(new Set(d.features || [])))
      .catch(() => setEnabledFeatures(new Set()))
  }, [user?.id, token])

  const refreshFeatures = useCallback(() => {
    if (!token) return
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setEnabledFeatures(new Set(d.features || [])))
      .catch(() => {})
  }, [token])

  if (window.location.pathname === '/callback') {
    return <GoogleCallbackPage onSuccess={() => window.history.replaceState({}, '', '/')} />
  }

  if (window.location.pathname === '/reading-oauth-callback') {
    return <ReadingOAuthCallbackPage />
  }

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100dvh', color:'var(--primary)', fontFamily:'var(--font-display)', letterSpacing:'0.15em' }}>
        LOADING...
      </div>
    )
  }

  if (setupRequired) {
    return <SetupPage />
  }

  if (!user) {
    return authView === 'login'
      ? <LoginPage  onSwitchToSignup={() => setAuthView('signup')} />
      : <SignupPage onSwitchToLogin={()  => setAuthView('login')}  />
  }

  const featureEnabled = (page) => {
    if (userIsAdmin) return true
    if (ALWAYS_VISIBLE.has(page)) return true
    if (!enabledFeatures) return false
    return enabledFeatures.has(page)
  }

  const handleNavigate = (page) => {
    if (ADMIN_PAGES.has(page) && !adminMode) return
    if (!featureEnabled(page)) return
    setCurrentPage(page)
    window.scrollTo(0, 0)
  }

  const handleAdminToggle = (next) => {
    setAdminMode(next)
    if (!next && ADMIN_PAGES.has(currentPage)) setCurrentPage('speak')
  }

  const pageLabel = (adminMode ? ADMIN_ITEMS : USER_ITEMS).find(i => i.key === currentPage)?.label || 'River Song'

  return (
    <div className="app-shell">
      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <div className="sidebar-logo">RS</div>
          <span className="sidebar-title">{pageLabel.toUpperCase()}</span>
        </div>
        <button
          className="mobile-hamburger"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <span /><span /><span />
        </button>
      </div>

      {/* Mobile nav overlay backdrop */}
      {mobileNavOpen && (
        <div className="mobile-overlay" onClick={() => setMobileNavOpen(false)} />
      )}

      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => { handleNavigate(page); setMobileNavOpen(false) }}
        isAdmin={adminMode}
        showAdminToggle={userIsAdmin}
        onAdminToggle={handleAdminToggle}
        displayName={profile.displayName}
        onLogout={logout}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        enabledFeatures={enabledFeatures}
        userIsAdmin={userIsAdmin}
      />

      <main className="app-main">
        <ErrorBoundary key={currentPage}>
          <Suspense fallback={<div className="loading-screen">INITIALIZING...</div>}>
            <div className="page-enter">
              {currentPage === 'dashboard'  && <DashboardPage  onNavigate={handleNavigate} isAdmin={adminMode} />}
              {currentPage === 'speak'      && <ConversationPage />}
              {currentPage === 'chat'       && <ChatPage />}
              {currentPage === 'memory'     && <MemoryPage />}
              {currentPage === 'routines'   && <RoutinesPage />}
              {currentPage === 'home'       && <HomeNodePage />}
              {currentPage === 'users'      && <UsersPage />}
              {currentPage === 'killswitch' && <KillSwitchPage />}
              {currentPage === 'profile'    && (
                <ProfilePage
                  profile={profile}
                  onSave={setProfile}
                  theme={theme}
                  onThemeChange={setTheme}
                />
              )}
              {currentPage === 'settings'   && (
                <SettingsPage 
                  onFeaturesChanged={refreshFeatures}
                  palette={palette}
                  environment={environment}
                  onPaletteChange={setPaletteSafe}
                  onEnvironmentChange={setEnvironment}
                />
              )}
              {currentPage === 'feeds'      && <FeedsPage />}
              {currentPage === 'google'     && <GooglePage />}
              {currentPage === 'commerce'   && <CommercePage />}
              {currentPage === 'reading'    && <ReadingPage />}
              {currentPage === 'analytics'  && <AnalyticsPage />}
              {currentPage === 'inventory'    && <InventoryPage />}
              {currentPage === 'chronos'      && <ChronosPage />}
              {currentPage === 'environment'  && <EnvironmentPage />}

              {currentPage === 'maintenance' && <MaintenancePulsePage />}
              {currentPage === 'culinary'    && <CulinaryPage />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
