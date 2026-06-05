import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth }        from './context/AuthContext.jsx'
import Shell              from './chrome/Shell.jsx'
import Drawer             from './chrome/Drawer.jsx'
import ErrorBoundary      from './components/ErrorBoundary.jsx'
import RsMark             from './components/RsMark.jsx'
import Stage              from './chrome/Stage.jsx'
import './styles/chrome-shell.css'
import './styles/chrome-stage.css'
import './styles/chrome-components.css'
import './styles/chrome-drawer.css'
import './styles/white-pages.css'
import './styles/responsive.css'

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
const VectorFleetPage         = lazy(() => import('./pages/VectorFleetPage.jsx'))
const DocumentsPage           = lazy(() => import('./pages/DocumentsPage.jsx'))
const SkillsPage              = lazy(() => import('./pages/SkillsPage.jsx'))
const PresetsPage             = lazy(() => import('./pages/PresetsPage.jsx'))
const ResearchPage            = lazy(() => import('./pages/ResearchPage.jsx'))
const ComparePage             = lazy(() => import('./pages/ComparePage.jsx'))
const RemoteOllamaPage        = lazy(() => import('./pages/RemoteOllamaPage.jsx'))
const WebhookTokensPage       = lazy(() => import('./pages/WebhookTokensPage.jsx'))
const GoogleCallbackPage      = lazy(() => import('./pages/GoogleCallbackPage.jsx'))
const ReadingOAuthCallbackPage = lazy(() => import('./pages/ReadingOAuthCallbackPage.jsx'))
const ForcePasswordChangePage  = lazy(() => import('./pages/ForcePasswordChangePage.jsx'))

import { ADMIN_PAGES, ALWAYS_VISIBLE } from './utils/constants.js'

// ── Route table ─────────────────────────────────────────────────────────────
// The drawer/components still speak in "page keys" (e.g. 'feeds', 'chronos').
// The URL is the source of truth, so we map both directions.
const PAGE_TO_PATH = {
  briefing:         '/briefing',
  dashboard:        '/dashboard',
  speak:            '/speak',
  chat:             '/chat',
  memory:           '/memory',
  routines:         '/routines',
  home:             '/home',
  users:            '/users',
  killswitch:       '/killswitch',
  profile:          '/profile',
  settings:         '/settings',
  admin_settings:   '/admin/settings',
  feeds:            '/feeds',
  google:           '/google',
  commerce:         '/commerce',
  reading:          '/reading',
  analytics:        '/analytics',
  inventory:        '/inventory',
  chronos:          '/chronos',
  vehicles:         '/vehicles',
  environment:      '/environment',
  culinary:         '/culinary',
  fleet:            '/fleet',
  documents:        '/documents',
  skills:           '/skills',
  presets:          '/presets',
  research:         '/research',
  compare:          '/compare',
  remote_ollama:    '/admin/remote-ollama',
  webhook_tokens:   '/admin/webhook-tokens',
  google_callback:  '/callback',
  reading_callback: '/reading-oauth-callback',
}

function pageKeyFromPath(pathname) {
  if (!pathname || pathname === '/' || pathname === '') return 'briefing'
  if (pathname === '/callback')                return 'google_callback'
  if (pathname === '/reading-oauth-callback')  return 'reading_callback'
  if (pathname.startsWith('/admin/settings'))  return 'admin_settings'
  // /feeds, /feeds/sports/boxscore/123 → 'feeds'
  const top = pathname.split('/').filter(Boolean)[0] || 'briefing'
  return top
}

// Environment display names — used as header context outside of dashboard/briefing.
const ENV_LABELS = {
  atreides:   'Atreides',
  harkonnen:  'Harkonnen',
  arrakis:    'Arrakis',
  forerunner: 'Forerunner',
  unsc:       'UNSC',
  spires:     'Sacred Spires',
  garden:     'Garden Pavilion',
  corpo:      'Corpo Plaza',
  pacifica:   'Pacifica Street',
}

function timeOfDayGreeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Late night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

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
  const { user, token, loading, logout, setupRequired, isAdminImpersonating, revertImpersonation } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [authView,      setAuthView]      = useState('login')
  const [enabledFeatures, setEnabledFeatures] = useState(null)

  // currentPage is now URL-derived. setCurrentPage is a navigate() wrapper so
  // every existing call site keeps working without churn. URLs are the source
  // of truth — back/forward and bookmarking just work.
  const currentPage = pageKeyFromPath(location.pathname)
  const setCurrentPage = useCallback((page) => {
    const path = PAGE_TO_PATH[page]
    if (path) navigate(path)
  }, [navigate])

  // One-time redirect: if the user lands on "/" or an unknown path, send them
  // to their previously-remembered page (or briefing). Only on first mount —
  // after that the URL is canonical.
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      const remembered = load('rs-page', 'briefing')
      const path = PAGE_TO_PATH[remembered] || '/briefing'
      navigate(path, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [adminMode,     setAdminMode]     = useState(false)
  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const [pageAction,    setPageAction]    = useState(null)
  const [sidebarOpen,   setSidebarOpen]   = useState(() => load('rs-sidebar-open', true))

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

  // URL is the source of truth, but we mirror the page key into localStorage
  // so a user who returns to the root '/' lands on their last-used page.
  // The action slot resets every page change.
  useEffect(() => { save('rs-page', currentPage); setPageAction(null); }, [currentPage])
  useEffect(() => { save('rs-admin', adminMode) }, [adminMode])
  useEffect(() => { save('rs-profile', profile) }, [profile])
  useEffect(() => { save('rs-sidebar-open', sidebarOpen) }, [sidebarOpen])

  useEffect(() => {
    save(universeKey, universe)
    document.documentElement.setAttribute('data-universe', universe)
    if (!user || !token) return
    fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ universe }),
    }).catch(err => console.warn('[App] persist universe failed:', err))
  }, [universe, universeKey, user?.id, token])

  useEffect(() => {
    save(envKey, environment)
    document.documentElement.setAttribute('data-env', environment)
    if (!user || !token) return
    fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ environment }),
    }).catch(err => console.warn('[App] persist environment failed:', err))
  }, [environment, envKey, user?.id, token])

  useEffect(() => {
    save(moodKey, mood)
    document.documentElement.setAttribute('data-mood', mood)
    if (!user || !token) return
    fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mood }),
    }).catch(err => console.warn('[App] persist mood failed:', err))
  }, [mood, moodKey, user?.id, token])

  useEffect(() => {
    if (!token) { setEnabledFeatures(null); return }
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        const feats = new Set()
        if (d) {
          if (Array.isArray(d.features)) d.features.forEach(f => feats.add(f))
          if (d.ai_features) {
            Object.entries(d.ai_features).forEach(([k, v]) => {
              if (v) feats.add(k.toLowerCase().replace('_enabled', ''))
            })
          }
        }
        setEnabledFeatures(feats)
      })
      .catch(() => setEnabledFeatures(new Set()))
  }, [token])

  const refreshFeatures = useCallback(() => {
    if (!token) return
    fetch('/api/features', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => {
        const feats = new Set()
        if (d) {
          if (Array.isArray(d.features)) d.features.forEach(f => feats.add(f))
          if (d.ai_features) {
            Object.entries(d.ai_features).forEach(([k, v]) => {
              if (v) feats.add(k.toLowerCase().replace('_enabled', ''))
            })
          }
        }
        setEnabledFeatures(feats)
      })
  }, [token])

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
    window.addEventListener('rs-features-changed', refreshFeatures)
    return () => window.removeEventListener('rs-features-changed', refreshFeatures)
  }, [refreshFeatures])

  useEffect(() => {
    const handleNavChat = () => { setCurrentPage('chat'); window.scrollTo(0, 0); }
    const handleNav = (e) => {
      const page = e?.detail?.page
      if (page) { setCurrentPage(page); window.scrollTo(0, 0); setDrawerOpen(false) }
    }
    window.addEventListener('rs-navigate-chat', handleNavChat)
    window.addEventListener('rs-navigate', handleNav)
    return () => {
      window.removeEventListener('rs-navigate-chat', handleNavChat)
      window.removeEventListener('rs-navigate', handleNav)
    }
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

  // Force password change lock
  if (user?.force_password_change) {
    return (
      <Suspense fallback={<div className="loading-screen">LOCKING SECURITY...</div>}>
        <ForcePasswordChangePage />
      </Suspense>
    )
  }

  // Header context per RIVER_SONG_CHROME_PLAN.md §3:
  //   - dashboard / briefing: time-of-day greeting fragment
  //   - all other pages:      active environment name
  // Never the page's own label.
  const headerContext = (currentPage === 'dashboard' || currentPage === 'briefing')
    ? timeOfDayGreeting()
    : (ENV_LABELS[environment] || '')

  // Desktop chat-history sidebar slot (≥1200px). Only on chat/speak pages.
  const showChatSidebar = currentPage === 'chat' || currentPage === 'speak'
  const chatSidebar = showChatSidebar && sidebarOpen ? (
    <div className="rs-chat-sidebar-inner">
      <div className="rs-sidebar-head">
        <span className="rs-chat-sidebar-title">Recent</span>
        <button
          className="rs-sidebar-toggle"
          onClick={() => setSidebarOpen(false)}
          title="Hide recent panel"
        >
          <span className="material-symbols-rounded">left_panel_close</span>
        </button>
      </div>
      <p className="rs-chat-sidebar-empty">
        Past conversations will appear here. Start speaking and River will remember.
      </p>
    </div>
  ) : null

  const shellMode = (currentPage === 'dashboard' || currentPage === 'briefing') ? 'foyer' : 'workshop'

  const impersonationBanner = isAdminImpersonating ? (
    <div style={{ background: '#f59e0b', color: '#000', padding: '8px', textAlign: 'center', fontWeight: 'bold', zIndex: 9999, position: 'relative' }}>
      ⚠️ Viewing as {user?.display_name || 'User'} — <button onClick={revertImpersonation} style={{ background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold', padding: 0, color: 'inherit' }}>Return to Admin</button>
    </div>
  ) : null;

  return (
    <div className="rs-root">
      {impersonationBanner}
      <Stage environment={environment} />

      <Shell
        context={headerContext}
        mode={shellMode}
        onOpenDrawer={() => setDrawerOpen(true)}
        onOpenSpeak={() => handleNavigate('speak')}
        onHome={() => handleNavigate('dashboard')}
        action={pageAction}
        chatSidebar={chatSidebar}
        onShowSidebar={showChatSidebar && !sidebarOpen ? () => setSidebarOpen(true) : null}
        drawer={
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
        }
      >
        <ErrorBoundary key={currentPage}>
          <Suspense fallback={<div className="loading-screen">INITIALIZING...</div>}>
            <div className="page-enter">
              {currentPage === 'briefing'   && <BriefingPage  onNavigate={handleNavigate} />}
              {currentPage === 'dashboard'  && <DashboardPage  onNavigate={handleNavigate} isAdmin={adminMode} setAction={setPageAction} />}

              {currentPage === 'speak'      && <ConversationPage setAction={setPageAction} />}
              {currentPage === 'chat'       && <ChatPage setAction={setPageAction} onNavigate={handleNavigate} />}
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
              {currentPage === 'fleet'      && <VectorFleetPage setAction={setPageAction} />}
              {currentPage === 'documents'  && <DocumentsPage setAction={setPageAction} />}
              {currentPage === 'skills'     && <SkillsPage setAction={setPageAction} />}
              {currentPage === 'presets'    && <PresetsPage setAction={setPageAction} />}
              {currentPage === 'research'   && <ResearchPage setAction={setPageAction} onNavigate={handleNavigate} />}
              {currentPage === 'compare'    && <ComparePage setAction={setPageAction} />}
              {currentPage === 'remote_ollama' && <RemoteOllamaPage setAction={setPageAction} />}
              {currentPage === 'webhook_tokens' && <WebhookTokensPage setAction={setPageAction} />}
            </div>
          </Suspense>
        </ErrorBoundary>
      </Shell>
    </div>
  )
}
