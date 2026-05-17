import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useAuth }        from './context/AuthContext.jsx'
import Sidebar            from './components/Sidebar.jsx'
import ErrorBoundary      from './components/ErrorBoundary.jsx'
import RsMark             from './components/RsMark.jsx'
import Stage              from './chrome/Stage.jsx'
import './styles/chrome-stage.css'

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
const VehiclePage             = lazy(() => import('./pages/VehiclePage.jsx'))
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

// ── Three-axis presence system ──────────────────────────────────────────────
// universe -> environment -> mood. Each pair below is the canonical default
// when an axis up the chain changes. Also used to validate persisted state.
const UNIVERSE_ENVS = {
  dune:      ['atreides',   'harkonnen'],
  halo:      ['forerunner', 'unsc'],
  mv:        ['spires',     'garden'],
  nightcity: ['corpo',      'pacifica'],
}
const ENV_MOODS = {
  atreides:   ['caladan', 'spice-hall'],
  harkonnen:  ['giedi', 'bloodlight'],
  forerunner: ['hard-light', 'ceramic-veil'],
  unsc:       ['combat-steel', 'night-vision'],
  spires:     ['sacred', 'daybreak-temple', 'twilight-spires'],
  garden:     ['pastel-day', 'dusk-pavilion'],
  corpo:      ['chrome', 'executive'],
  pacifica:   ['glitch-street', 'smoke'],
}
// Legacy theme key -> {universe, environment, mood} for one-time client-side migration.
const LEGACY_THEME_MAP = {
  'halo':            { universe: 'halo',      environment: 'forerunner', mood: 'hard-light' },
  'crimson-dark':    { universe: 'dune',      environment: 'harkonnen',  mood: 'bloodlight' },
  'combat':          { universe: 'halo',      environment: 'unsc',       mood: 'night-vision' },
  'midnight-violet': { universe: 'mv',        environment: 'spires',     mood: 'twilight-spires' },
  'amber':           { universe: 'mv',        environment: 'garden',     mood: 'dusk-pavilion' },
  'arctic':          { universe: 'mv',        environment: 'spires',     mood: 'daybreak-temple' },
  'cyberpunk':       { universe: 'nightcity', environment: 'pacifica',   mood: 'glitch-street' },
  'dune':            { universe: 'dune',      environment: 'atreides',   mood: 'spice-hall' },
}

export default function App() {
  const { user, token, loading, logout, setupRequired } = useAuth()
  const [authView,      setAuthView]      = useState('login') // 'login' | 'signup'
  const [enabledFeatures, setEnabledFeatures] = useState(null) // null = not loaded yet
  const [currentPage,   setCurrentPage]   = useState(() => load('rs-page', 'speak'))
  const [adminMode,     setAdminMode]     = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const universeKey   = user ? `rs-universe:${user.id}`   : 'rs-universe'
  const envKey        = user ? `rs-env:${user.id}`        : 'rs-env'
  const moodKey       = user ? `rs-mood:${user.id}`       : 'rs-mood'
  const [universe,    setUniverse]    = useState(() => load(universeKey, 'dune'))
  const [environment, setEnvironment] = useState(() => load(envKey, 'atreides'))
  const [mood,        setMood]        = useState(() => load(moodKey, 'caladan'))

  const [profile,     setProfile]     = useState(() => {
    if (user) return { displayName: user.display_name, username: user.email, birthday: '' }
    return load('rs-profile', { displayName: 'User', username: '', birthday: '' })
  })

  useEffect(() => { save('rs-page',    currentPage) }, [currentPage])
  useEffect(() => { save('rs-admin',   adminMode)   }, [adminMode])
  useEffect(() => { save('rs-profile', profile)     }, [profile])

  useEffect(() => {
    save(universeKey, universe)
    document.documentElement.setAttribute('data-universe', universe)
    if (user) {
      const token = load('rs-auth-token', null)
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ universe }),
        }).catch(() => {})
      }
    }
  }, [universe]) // eslint-disable-line react-hooks/exhaustive-deps

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
    save(moodKey, mood)
    document.documentElement.setAttribute('data-mood', mood)
    if (user) {
      const token = load('rs-auth-token', null)
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mood }),
        }).catch(() => {})
      }
    }
  }, [mood]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.setAttribute('data-universe', universe)
    document.documentElement.setAttribute('data-env', environment)
    document.documentElement.setAttribute('data-mood', mood)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Photographic Stage activates only inside the authed shell. Auth flow
  // (Login/Signup/Setup) keeps the legacy flat backdrop from themes.css.
  useEffect(() => {
    if (user) {
      document.body.classList.add('rs-stage-active')
      return () => document.body.classList.remove('rs-stage-active')
    }
  }, [user])

  // Sync display name and presence (universe/env/mood) when user changes.
  // On login: pull from server so it matches across all devices.
  useEffect(() => {
    if (user) {
      setProfile(p => ({ ...p, displayName: user.display_name, username: user.email }))
      const token = load('rs-auth-token', null)
      fetch('/api/auth/profile', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          // Three-axis values from server take priority; otherwise migrate from legacy
          // theme/palette fields if those are all we have; otherwise local; otherwise defaults.
          let u = data?.universe || load(`rs-universe:${user.id}`, null)
          let e = data?.environment || load(`rs-env:${user.id}`, null)
          let m = data?.mood || load(`rs-mood:${user.id}`, null)

          if (!u || !m) {
            // Legacy migration: a legacy `theme` value alone is enough to derive all three
            const legacy = data?.theme && LEGACY_THEME_MAP[data.theme]
            if (legacy) {
              u = u || legacy.universe
              e = e || legacy.environment
              m = m || legacy.mood
            }
          }
          u = u || 'dune'
          e = e || (UNIVERSE_ENVS[u] || ['atreides'])[0]
          m = m || (ENV_MOODS[e] || ['caladan'])[0]

          save(`rs-universe:${user.id}`, u)
          save(`rs-env:${user.id}`, e)
          save(`rs-mood:${user.id}`, m)
          setUniverse(u); setEnvironment(e); setMood(m)
          document.documentElement.setAttribute('data-universe', u)
          document.documentElement.setAttribute('data-env', e)
          document.documentElement.setAttribute('data-mood', m)
        })
        .catch(() => {
          const u = load(`rs-universe:${user.id}`, 'dune')
          const e = load(`rs-env:${user.id}`, 'atreides')
          const m = load(`rs-mood:${user.id}`, 'caladan')
          setUniverse(u); setEnvironment(e); setMood(m)
          document.documentElement.setAttribute('data-universe', u)
          document.documentElement.setAttribute('data-env', e)
          document.documentElement.setAttribute('data-mood', m)
        })
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cascading setters — picking up the chain resets stale dependents to a valid default.
  const setUniverseSafe = (u) => {
    setUniverse(u)
    const validEnvs = UNIVERSE_ENVS[u] || []
    if (!validEnvs.includes(environment)) {
      const nextEnv = validEnvs[0]
      setEnvironment(nextEnv)
      const validMoods = ENV_MOODS[nextEnv] || []
      if (!validMoods.includes(mood)) setMood(validMoods[0])
    }
  }
  const setEnvironmentSafe = (e) => {
    setEnvironment(e)
    const validMoods = ENV_MOODS[e] || []
    if (!validMoods.includes(mood)) setMood(validMoods[0])
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
      {/* Photographic backdrop — fixed full-viewport behind everything */}
      <Stage environment={environment} />

      {/* Mobile top bar */}
      <div className="mobile-topbar">
        <div className="mobile-topbar-brand">
          <RsMark mark="mono" size={32} />
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
                  universe={universe}
                  environment={environment}
                  mood={mood}
                  onUniverseChange={setUniverseSafe}
                  onEnvironmentChange={setEnvironmentSafe}
                  onMoodChange={setMood}
                />
              )}
              {currentPage === 'settings'   && (
                <SettingsPage 
                  onFeaturesChanged={refreshFeatures}
                />
              )}
              {currentPage === 'feeds'      && <FeedsPage />}
              {currentPage === 'google'     && <GooglePage />}
              {currentPage === 'commerce'   && <CommercePage />}
              {currentPage === 'reading'    && <ReadingPage />}
              {currentPage === 'analytics'  && <AnalyticsPage />}
              {currentPage === 'inventory'    && <InventoryPage />}
              {currentPage === 'chronos'      && <ChronosPage />}
              {currentPage === 'vehicles'     && <VehiclePage onNavigate={handleNavigate} />}
              {currentPage === 'environment'  && <EnvironmentPage />}

              {currentPage === 'culinary'    && <CulinaryPage />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
