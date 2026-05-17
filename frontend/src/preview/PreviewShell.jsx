import React from 'react'
import RsMark from '../components/RsMark.jsx'

/**
 * PreviewShell — the global chrome. Three zones, locked positions.
 * Skin (universe/env/mood) is applied by ancestors via body[data-*].
 *
 * Props:
 *   context        : string shown in header (time, active vehicle, note title, etc.)
 *   onOpenDrawer   : () => void
 *   onOpenSpeak    : () => void  (orb tap)
 *   children       : page content for Zone 2
 *   action         : node for Zone 3 (input bar / primary action)
 *   hasRail        : enable desktop left rail
 *   rail           : node for the desktop rail
 */
export default function PreviewShell({
  context,
  onOpenDrawer,
  onOpenSpeak,
  children,
  action,
  hasRail = false,
  rail = null,
}) {
  return (
    <div className={`rs-preview ${hasRail ? 'has-rail' : ''}`}>
      {hasRail && rail && <aside className="rs-rail">{rail}</aside>}

      <header className="rs-header">
        <button className="rs-mark-btn" aria-label="Home">
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

      <div className="rs-action">{action}</div>
    </div>
  )
}
