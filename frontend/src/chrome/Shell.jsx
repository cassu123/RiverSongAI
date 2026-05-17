import React from 'react'
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
  children,
}) {
  return (
    <div className="rs-shell">
      <header className="rs-header">
        <button className="rs-mark-btn" onClick={onHome} aria-label="Home">
          <RsMark mark="mono" size={28} />
        </button>
        <div className="rs-context">{context}</div>
        <button className="rs-orb" onClick={onOpenSpeak} aria-label="Speak to River" />
        <button className="rs-hamburger" onClick={onOpenDrawer} aria-label="Open navigation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="8"  x2="19" y2="8"  />
            <line x1="5" y1="12" x2="19" y2="12" />
            <line x1="5" y1="16" x2="19" y2="16" />
          </svg>
        </button>
      </header>

      <main className="rs-content">{children}</main>

      {action && <div className="rs-action">{action}</div>}
    </div>
  )
}
