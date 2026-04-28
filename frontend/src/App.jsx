import React, { useState, useEffect } from 'react'
import { useAuth }        from './context/AuthContext.jsx'
import Sidebar            from './components/Sidebar.jsx'
import ErrorBoundary      from './components/ErrorBoundary.jsx'
import LoginPage          from './pages/LoginPage.jsx'
import SignupPage         from './pages/SignupPage.jsx'
import SetupPage          from './pages/SetupPage.jsx'
import DashboardPage      from './pages/DashboardPage.jsx'
import ConversationPage   from './pages/ConversationPage.jsx'
import ChatPage           from './pages/ChatPage.jsx'
import MemoryPage         from './pages/MemoryPage.jsx'
import RoutinesPage       from './pages/RoutinesPage.jsx'
import HomeNodePage       from './pages/HomeNodePage.jsx'
import UsersPage          from './pages/UsersPage.jsx'
import KillSwitchPage     from './pages/KillSwitchPage.jsx'
import ProfilePage        from './pages/ProfilePage.jsx'
import SettingsPage       from './pages/SettingsPage.jsx'
import FeedsPage          from './pages/FeedsPage.jsx'
import GooglePage         from './pages/GooglePage.jsx'
import CommercePage       from './pages/CommercePage.jsx'
import ReadingPage        from './pages/ReadingPage.jsx'
import AnalyticsPage      from './pages/AnalyticsPage.jsx'
import InventoryPage           from './pages/InventoryPage.jsx'
import MaintenancePulsePage    from './pages/MaintenancePulsePage.jsx'
import GoogleCallbackPage      from './pages/GoogleCallbackPage.jsx'

const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch', 'analytics'])

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export default function App() {
  const { user, loading, logout, setupRequired } = useAuth()
  const [authView,      setAuthView]      = useState('login') // 'login' | 'signup'
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
  }, [theme, themeKey])

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

  if (window.location.pathname === '/callback') {
    return <GoogleCallbackPage onSuccess={() => window.history.replaceState({}, '', '/')} />
  }

  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--primary)', fontFamily:'var(--font-display)', letterSpacing:'0.15em' }}>
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

  const handleNavigate = (page) => {
    if (ADMIN_PAGES.has(page) && !adminMode) return
    setCurrentPage(page)
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
      />

      <main className="app-main">
        <ErrorBoundary key={currentPage}>
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
            {currentPage === 'settings'   && <SettingsPage />}
            {currentPage === 'feeds'      && <FeedsPage />}
            {currentPage === 'google'     && <GooglePage />}
            {currentPage === 'commerce'   && <CommercePage />}
            {currentPage === 'reading'    && <ReadingPage />}
            {currentPage === 'analytics'  && <AnalyticsPage />}
            {currentPage === 'inventory'    && <InventoryPage />}
            {currentPage === 'maintenance' && <MaintenancePulsePage />}
          </div>
        </ErrorBoundary>
      </main>
    </div>
  )
}
