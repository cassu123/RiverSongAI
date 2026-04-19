// =============================================================================
// src/components/NavBar.jsx
//
// Top navigation bar for River Song AI.
//
// Props:
//   currentPage {string}   'conversation' | 'settings'
//   onNavigate  {function} Called with the new page key on nav click
// =============================================================================

import React from 'react'

const NAV_ITEMS = [
  { key: 'conversation', label: 'SPEAK' },
  { key: 'settings',     label: 'SETTINGS' },
]

export default function NavBar({ currentPage, onNavigate }) {
  return (
    <header className="navbar">
      <div className="navbar-brand">
        <span className="navbar-logo">RS</span>
        <span className="navbar-title">RIVER SONG</span>
      </div>

      <nav className="navbar-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            className={`nav-btn ${currentPage === key ? 'nav-btn--active' : ''}`}
            onClick={() => onNavigate(key)}
            aria-current={currentPage === key ? 'page' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="navbar-version">v0.1 · ALPHA</div>
    </header>
  )
}
