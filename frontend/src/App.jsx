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
const MaintenancePulsePage    = lazy(() => import('./pages/MaintenancePulsePage.jsx'))
const CulinaryPage            = lazy(() => import('./pages/CulinaryPage.jsx'))
const GoogleCallbackPage      = lazy(() => import('./pages/GoogleCallbackPage.jsx'))
const ReadingOAuthCallbackPage = lazy(() => import('./pages/ReadingOAuthCallbackPage.jsx'))

import { ADMIN_PAGES, ALWAYS_VISIBLE } from './utils/constants.js'

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
  }, [theme]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync display name and theme when user changes (login/logout)
  useEffect(() => {
    if (user) {
      setProfile(p => ({ ...p, displayName: user.display_name, username: user.email }))
      const saved = load(`rs-theme:${user.id}`, 'halo')
      setTheme(saved)
      document.documentElement.setAttribute('data-theme', saved)
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="app-shell">
      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <div className="sidebar-logo">RS</div>
          <span className="sidebar-title">RIVER SONG</span>
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
              {currentPage === 'settings'   && <SettingsPage onFeaturesChanged={refreshFeatures} />}
              {currentPage === 'feeds'      && <FeedsPage />}
              {currentPage === 'google'     && <GooglePage />}
              {currentPage === 'commerce'   && <CommercePage />}
              {currentPage === 'reading'    && <ReadingPage />}
              {currentPage === 'analytics'  && <AnalyticsPage />}
              {currentPage === 'inventory'    && <InventoryPage />}

              {currentPage === 'maintenance' && <MaintenancePulsePage />}
              {currentPage === 'culinary'    && <CulinaryPage />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
