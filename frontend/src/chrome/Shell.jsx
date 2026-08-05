import React from 'react'
import PresenceOrb from './PresenceOrb.jsx'
import RsMark from '../components/RsMark.jsx'

/**
 * Shell — the global chrome. Three zones, locked positions.
 *
 *   Zone 1 (top)    : Header — RsMark · context · Orb · ≡
 *   Zone 2 (middle) : Content — page slot, scrolls independently
 *   Zone 3 (bottom) : Action — page-specific (Speak button, ChatInputBar,
 *                     Search+Add, or empty for read-only pages)
 *
 * Header NEVER shows the page name (per design plan). Context is small,
 * muted, contextual: time of day, active vehicle, active note title.
 *
 * Skin (universe/env/mood) applied by ancestors via body[data-*].
 * Stage (photographic backdrop) lives outside the Shell at z-index 0.
 */
export default function Shell({
  context,
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
  const shellClass = `rs-shell rs-mode-${mode}${chatSidebar ? ' has-sidebar' : ''}`
  
  return (
    <div className={shellClass}>
      {drawer}

      {/* ZONE 1: HEADER */}
      <header className="rs-header">
        <div className="rs-header-left">
          <button className="rs-mark-btn" onClick={onHome} aria-label="Home">
            <RsMark mark="mono" size={24} />
          </button>
          <div className="rs-context">{context}</div>
        </div>
        
        <div className="rs-header-right">
          {onShowSidebar && (
            <button className="rs-sidebar-reopen" onClick={onShowSidebar} title="Show recent panel">
              <span className="material-symbols-rounded">left_panel_open</span>
            </button>
          )}
          <PresenceOrb mode={mode} onClick={onOpenSpeak} />
          <button className="rs-hamburger" onClick={onOpenDrawer} aria-label="Open navigation">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="5" y1="8"  x2="19" y2="8"  />
              <line x1="5" y1="12" x2="19" y2="12" />
              <line x1="5" y1="16" x2="19" y2="16" />
            </svg>
          </button>
        </div>
      </header>

      {chatSidebar && (
        <aside className="rs-chat-sidebar" aria-label="Chat history">
          {chatSidebar}
        </aside>
      )}

      {/* ZONE 2: CONTENT */}
      <main className="rs-content">
        <div className="rs-foyer">
          {children}
        </div>
      </main>

      {/* ZONE 3: ACTION BAR */}
      <div id="rs-shell-action" className="rs-action" style={{ display: action ? 'block' : 'none' }}>
        <div className="rs-action-inner">
          {action}
        </div>
      </div>
      {!action && <div style={{ height: 'env(safe-area-inset-bottom)' }} />}
    </div>
  )
}
