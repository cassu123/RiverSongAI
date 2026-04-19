import React, { useState, useEffect } from 'react'
import Sidebar          from './components/Sidebar.jsx'
import ErrorBoundary    from './components/ErrorBoundary.jsx'
import DashboardPage    from './pages/DashboardPage.jsx'
import ConversationPage from './pages/ConversationPage.jsx'
import MemoryPage       from './pages/MemoryPage.jsx'
import RoutinesPage     from './pages/RoutinesPage.jsx'
import HomeNodePage     from './pages/HomeNodePage.jsx'
import UsersPage        from './pages/UsersPage.jsx'
import KillSwitchPage   from './pages/KillSwitchPage.jsx'
import ProfilePage      from './pages/ProfilePage.jsx'
import SettingsPage     from './pages/SettingsPage.jsx'

const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch'])

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

const DEFAULT_PROFILE = { displayName: 'Charlie W.', username: '', birthday: '' }

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => load('rs-page',    'speak'))
  const [isAdmin,     setIsAdmin]     = useState(() => load('rs-admin',   false))
  const [theme,       setTheme]       = useState(() => load('rs-theme',   'halo'))
  const [profile,     setProfile]     = useState(() => load('rs-profile', DEFAULT_PROFILE))

  useEffect(() => { save('rs-page',    currentPage) }, [currentPage])
  useEffect(() => { save('rs-admin',   isAdmin)     }, [isAdmin])
  useEffect(() => { save('rs-profile', profile)     }, [profile])
  useEffect(() => {
    save('rs-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = (page) => {
    if (ADMIN_PAGES.has(page) && !isAdmin) return
    setCurrentPage(page)
  }

  const handleAdminToggle = (next) => {
    setIsAdmin(next)
    if (!next && ADMIN_PAGES.has(currentPage)) setCurrentPage('speak')
  }

  return (
    <div className="app-shell">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        isAdmin={isAdmin}
        onAdminToggle={handleAdminToggle}
        displayName={profile.displayName}
      />

      <main className="app-main">
        <ErrorBoundary key={currentPage}>
          <div className="page-enter">
            {currentPage === 'dashboard'  && <DashboardPage  onNavigate={handleNavigate} isAdmin={isAdmin} />}
            {currentPage === 'speak'      && <ConversationPage />}
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
          </div>
        </ErrorBoundary>
      </main>
    </div>
  )
}
