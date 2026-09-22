import React from 'react'
import RiverOrb from '@/presence/RiverOrb.jsx'
import RsMark from '@components/RsMark.jsx'

const PAGE_TITLES = {
  briefing:       'Briefing',
  dashboard:      'System Hub',
  speak:          'Voice',
  chat:           'Chat',
  home:           'Home Node',
  feeds:          'Feeds',
  memory:         'Memory',
  chronos:        'Notes',
  skills:         'About You',
  routines:       'Routines',
  inventory:      'Stash',
  culinary:       'Kitchen',
  vehicles:       'Garage',
  commerce:       'Store',
  analytics:      'Analytics',
  reading:        'Reading',
  google:         'Google',
  fleet:          'Fleet Console',
  documents:      'Documents',
  profile:        'Profile',
  settings:       'Settings',
  admin_settings: 'Admin Settings',
  users:          'Users',
  killswitch:     'Emergency Stop',
}

/**
 * Shell — the clean futuristic global chrome.
 *
 *   Zone 1 (top)    : Floating Glass Header — Monogram · Page Title · Menu
 *   Zone 2 (middle) : Content Stage — independent scrolling viewport
 *   Zone 3 (bottom) : Contextual Action Bar (e.g. Chat input), River on its left
 *   Zone 4 (mobile) : Floating Glass Mobile Dock (< 768px)
 */
export default function Shell({
  currentPage = 'briefing',
  onNavigate,
  onOpenDrawer,
  onOpenSpeak,
  onHome,
  action,
  chatSidebar,
  onShowSidebar,
  drawer,
  children,
  mode = 'workshop'
}) {
  const shellClass = `rs-shell rs-mode-${mode}${chatSidebar ? ' has-sidebar' : ''}${action ? ' has-action' : ''}`
  
  return (
    <div className={shellClass}>
      {drawer}

      {/* ZONE 1: FLOATING GLASS HEADER */}
      <header className="rs-header">
        <div className="rs-header-left">
          <button className="rs-mark-btn" onClick={onHome} aria-label="Home" title="River Song Home">
            <RsMark mark="mono" size={26} />
          </button>
          <span className="rs-header-sep">/</span>
          <span className="rs-header-title">{PAGE_TITLES[currentPage] || (currentPage || '').toUpperCase()}</span>
        </div>

        <div className="rs-header-center" />
        
        <div className="rs-header-right">
          {onShowSidebar && (
            <button className="rs-sidebar-reopen" onClick={onShowSidebar} title="Show recent conversations" aria-label="Show recent conversations">
              <span className="material-symbols-rounded">left_panel_open</span>
            </button>
          )}
          <button className="rs-hamburger" onClick={onOpenDrawer} aria-label="Open navigation menu">
            <span className="material-symbols-rounded">menu</span>
          </button>
        </div>
      </header>

      {chatSidebar && (
        <aside className="rs-chat-sidebar" aria-label="Chat history">
          {chatSidebar}
        </aside>
      )}

      {/* ZONE 2: CONTENT STAGE */}
      <main className="rs-content">
        <div className="rs-foyer">
          {children}
        </div>
      </main>

      {/* ZONE 3: ACTION BAR
          A page's bar replaces the dock, which is where River lives — so she
          comes along into the bar, on the left, as the way into Voice. Not on
          the Voice page itself: she is already the whole stage there. */}
      <div id="rs-shell-action" className="rs-action" style={{ display: action ? 'block' : 'none' }}>
        <div className="rs-action-inner">
          {action && onOpenSpeak && currentPage !== 'speak' && (
            <button className="rs-action-river" onClick={onOpenSpeak} aria-label="Talk to River" title="Talk to River">
              <RiverOrb detail="compact" />
            </button>
          )}
          <div className="rs-action-slot">{action}</div>
        </div>
      </div>
      {!action && <div style={{ height: 'env(safe-area-inset-bottom)' }} />}

      {/* ZONE 4: FLOATING GLASS NAVIGATION PILL BAR (GOOGLE HOME LAYOUT) */}
      {!action && onNavigate && (
        <nav className="rs-floating-dock rs-mobile-dock" aria-label="Global Navigation">
          <button
            className={`rs-floating-dock-btn rs-mobile-dock-btn ${currentPage === 'home' ? 'is-active' : ''}`}
            onClick={() => onNavigate('home')}
            aria-label="Home"
            title="Home"
          >
            <span className="material-symbols-rounded">home</span>
            <span>Home</span>
          </button>
          <button
            className={`rs-floating-dock-btn rs-mobile-dock-btn ${currentPage === 'chat' ? 'is-active' : ''}`}
            onClick={() => onNavigate('chat')}
            aria-label="Chat"
            title="Chat"
          >
            <span className="material-symbols-rounded">chat</span>
            <span>Chat</span>
          </button>
          <button
            className={`rs-floating-dock-btn rs-mobile-dock-btn is-voice-hero ${currentPage === 'speak' ? 'is-active' : ''}`}
            onClick={onOpenSpeak}
            aria-label="Voice conversation"
            title="Talk with River"
          >
            <RiverOrb detail="compact" className="rs-dock-orb" />
          </button>
          <button
            className={`rs-floating-dock-btn rs-mobile-dock-btn ${currentPage === 'briefing' ? 'is-active' : ''}`}
            onClick={() => onNavigate('briefing')}
            aria-label="Briefing"
            title="Briefing"
          >
            <span className="material-symbols-rounded">wb_sunny</span>
            <span>Briefing</span>
          </button>
          <button
            className="rs-floating-dock-btn rs-mobile-dock-btn"
            onClick={onOpenDrawer}
            aria-label="Spaces"
            title="Spaces & Apps"
          >
            <span className="material-symbols-rounded">grid_view</span>
            <span>Spaces</span>
          </button>
        </nav>
      )}
    </div>
  )
}
