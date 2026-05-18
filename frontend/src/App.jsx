import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useAuth }        from './context/AuthContext.jsx'
import Shell              from './chrome/Shell.jsx'
import Drawer             from './chrome/Drawer.jsx'
import ErrorBoundary      from './components/ErrorBoundary.jsx'
import RsMark             from './components/RsMark.jsx'
import Stage              from './chrome/Stage.jsx'
import './styles/chrome-shell.css'
import './styles/chrome-stage.css'
import './styles/chrome-components.css'

// Lazy load pages
const LoginPage          = lazy(() => import('./pages/LoginPage.jsx'))
const SignupPage         = lazy(() => import('./pages/SignupPage.jsx'))
const SetupPage          = lazy(() => import('./pages/SetupPage.jsx'))
const BriefingPage       = lazy(() => import('./pages/BriefingPage.jsx'))
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
const AdminSettingsPage  = lazy(() => import('./pages/AdminSettingsPage.jsx'))
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

const UNIVERSE_ENVS = {
  dune:      ['atreides',   'harkonnen', 'arrakis'],
  halo:      ['forerunner', 'unsc'],
  mv:        ['spires',     'garden'],
  nightcity: ['corpo',      'pacifica'],
}
const ENV_MOODS = {
  atreides:   ['caladan', 'spice-hall'],
  harkonnen:  ['giedi', 'bloodlight'],
  arrakis:    ['deep-desert', 'wormsign'],
  forerunner: ['hard-light', 'ceramic-veil'],
  unsc:       ['combat-steel', 'night-vision'],
  spires:     ['sacred', 'daybreak-temple', 'twilight-spires'],
  garden:     ['pastel-day', 'dusk-pavilion'],
  corpo:      ['chrome', 'executive'],
  pacifica:   ['glitch-street', 'smoke'],
}

export default function App() {
  const { user, token, loading, logout, setupRequired } = useAuth()
  const [authView,      setAuthView]      = useState('login')
  const [enabledFeatures, setEnabledFeatures] = useState(null)
  const [currentPage,   setCurrentPage]   = useState(() => {
    const path = window.location.pathname
    if (path === '/callback') return 'google_callback'
    if (path === '/reading-oauth-callback') return 'reading_callback'
    return load('rs-page', 'briefing')
  })

  const [adminMode,     setAdminMode]     = useState(false)
  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const [pageAction,    setPageAction]    = useState(null)

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

  useEffect(() => {
    document.body.classList.add('rs-stage-active')
    return () => document.body.classList.remove('rs-stage-active')
  }, [])

  useEffect(() => { save('rs-page', currentPage); setPageAction(null); }, [currentPage])
  useEffect(() => { save('rs-admin', adminMode) }, [adminMode])
  useEffect(() => { save('rs-profile', profile) }, [profile])

  useEffect(() => {
    save(universeKey, universe)
    document.documentElement.setAttribute('data-universe', universe)
    if (user && token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ universe }),
      }).catch(() => {})
    }
  }, [universe, universeKey, user, token])

  useEffect(() => {
    save(envKey, environment)
    document.documentElement.setAttribute('data-env', environment)
    if (user && token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ environment }),
      }).catch(() => {})
    }
  }, [environment, envKey, user, token])

  useEffect(() => {
    save(moodKey, mood)
    document.documentElement.setAttribute('data-mood', mood)
    if (user && token) {
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mood }),
      }).catch(() => {})
    }
  }, [mood, moodKey, user, token])

  useEffect(() => {
    if (!token) { setEnabledFeatures(null); return }
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        const feats = new Set()
        if (d && d.ai_features) {
          Object.entries(d.ai_features).forEach(([k, v]) => {
            if (v) feats.add(k.toLowerCase().replace('_enabled', ''))
          })
        }
        setEnabledFeatures(feats)
      })
      .catch(() => setEnabledFeatures(new Set()))
  }, [token])

  const refreshFeatures = () => {
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        if (d.ai_features) setEnabledFeatures(new Set(Object.entries(d.ai_features).filter(([_,v])=>v).map(([k,_])=>k.toLowerCase().replace('_enabled',''))))
      })
  }

  const setUniverseSafe = (u) => { setUniverse(u); setEnvironment(UNIVERSE_ENVS[u][0]); setMood(ENV_MOODS[UNIVERSE_ENVS[u][0]][0]); }
  const setEnvironmentSafe = (e) => { setEnvironment(e); setMood(ENV_MOODS[e][0]); }

  const userIsAdmin = user?.role === 'admin'

  const featureEnabled = (page) => {
    if (userIsAdmin) return true
    if (ALWAYS_VISIBLE.has(page)) return true
    if (!enabledFeatures) return false
    return enabledFeatures.has(page)
  }

  useEffect(() => {
    const handleNavChat = () => { setCurrentPage('chat'); window.scrollTo(0, 0); }
    window.addEventListener('rs-navigate-chat', handleNavChat)
    return () => window.removeEventListener('rs-navigate-chat', handleNavChat)
  }, [])

  const handleNavigate = (page) => {
    if (ADMIN_PAGES.has(page) && !adminMode) return
    if (!featureEnabled(page)) return
    setCurrentPage(page)
    window.scrollTo(0, 0)
    setDrawerOpen(false)
  }

  const handleAdminToggle = (next) => {
    setAdminMode(next)
    if (!next && ADMIN_PAGES.has(currentPage)) setCurrentPage('speak')
  }

  if (loading) return <div className="loading-screen">NEURAL LINK ACTIVE...</div>

  if (currentPage === 'google_callback' || currentPage === 'reading_callback') {
    return (
      <div className="rs-root">
        <Stage environment="atreides" />
        <Suspense fallback={null}>
          {currentPage === 'google_callback' && <GoogleCallbackPage onSuccess={() => handleNavigate('dashboard')} />}
          {currentPage === 'reading_callback' && <ReadingOAuthCallbackPage />}
        </Suspense>
      </div>
    )
  }

  if (setupRequired) {
    return (
      <div className="rs-root">
        <Stage environment="atreides" />
        <Suspense fallback={null}><SetupPage /></Suspense>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="rs-root">
        <Stage environment="atreides" />
        <Suspense fallback={null}>
          {authView === 'login' ? <LoginPage onSwitchToSignup={() => setAuthView('signup')} /> : <SignupPage onSwitchToLogin={() => setAuthView('login')} />}
        </Suspense>
      </div>
    )
  }

  const pageLabel = (adminMode ? ADMIN_ITEMS : USER_ITEMS).find(i => i.key === currentPage)?.label || 'River Song'

  return (
    <div className="rs-root">
      <Stage environment={environment} />

      <Shell
        context={pageLabel}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSpeak={() => handleNavigate('speak')}
        onHome={() => handleNavigate('dashboard')}
        action={pageAction}
      >
        <ErrorBoundary key={currentPage}>
          <Suspense fallback={<div className="loading-screen">INITIALIZING...</div>}>
            <div className="page-enter">
              {currentPage === 'briefing'   && <BriefingPage  onNavigate={handleNavigate} />}
              {currentPage === 'dashboard'  && <DashboardPage  onNavigate={handleNavigate} isAdmin={adminMode} setAction={setPageAction} />}

              {currentPage === 'speak'      && <ConversationPage setAction={setPageAction} />}
              {currentPage === 'chat'       && <ChatPage setAction={setPageAction} />}
              {currentPage === 'memory'     && <MemoryPage setAction={setPageAction} />}
              {currentPage === 'routines'   && <RoutinesPage setAction={setPageAction} />}
              {currentPage === 'home'       && <HomeNodePage setAction={setPageAction} />}
              {currentPage === 'users'      && <UsersPage setAction={setPageAction} />}
              {currentPage === 'killswitch' && <KillSwitchPage setAction={setPageAction} />}
              {currentPage === 'profile'    && <ProfilePage profile={profile} onSave={setProfile} universe={universe} environment={environment} mood={mood} onUniverseChange={setUniverseSafe} onEnvironmentChange={setEnvironmentSafe} onMoodChange={setMood} setAction={setPageAction} />}
              {currentPage === 'settings'   && <SettingsPage onFeaturesChanged={refreshFeatures} setAction={setPageAction} />}
              {currentPage === 'admin_settings' && <AdminSettingsPage onFeaturesChanged={refreshFeatures} />}
              {currentPage === 'feeds'      && <FeedsPage setAction={setPageAction} />}
              {currentPage === 'google'     && <GooglePage setAction={setPageAction} />}
              {currentPage === 'commerce'   && <CommercePage setAction={setPageAction} />}
              {currentPage === 'reading'    && <ReadingPage setAction={setPageAction} />}
              {currentPage === 'analytics'  && <AnalyticsPage setAction={setPageAction} />}
              {currentPage === 'inventory'  && <InventoryPage setAction={setPageAction} />}
              {currentPage === 'chronos'    && <ChronosPage setAction={setPageAction} />}
              {currentPage === 'vehicles'   && <VehiclePage onNavigate={handleNavigate} setAction={setPageAction} />}
              {currentPage === 'environment'&& <EnvironmentPage setAction={setPageAction} />}
              {currentPage === 'culinary'   && <CulinaryPage setAction={setPageAction} />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </Shell>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        currentPage={currentPage}
        onNavigate={handleNavigate}
        adminMode={adminMode}
        userIsAdmin={userIsAdmin}
        onAdminToggle={handleAdminToggle}
        enabledFeatures={enabledFeatures}
        displayName={profile.displayName}
        onLogout={logout}
      />
    </div>
  )
}
