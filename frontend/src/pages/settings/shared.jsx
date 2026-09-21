// =============================================================================
// src/pages/settings/shared.jsx
//
// Shared building blocks for the Settings page sections.
// =============================================================================

import React from 'react'

export const API_BASE = '' // same origin

// ---------------------------------------------------------------------------
// Page heading — shared by /settings, /admin/settings, /profile and /users so
// the four read as one family of pages now that they are separate pages.
// ---------------------------------------------------------------------------
export function PageHead({ icon, eyebrow, title, children }) {
  return (
    <header className="rs-foyer-head rs-mb-5">
      <div className="rs-card-label rs-mb-2 rs-flex rs-items-center rs-gap-2 rs-c-accent">
        <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>{icon}</span>
        {eyebrow}
      </div>
      <h1 className="rs-greeting rs-fw-700" style={{ fontSize: '2.2rem', margin: '0 0 var(--rs-space-2)' }}>
        {title}
      </h1>
      <div className="rs-greeting-sub rs-type-body rs-muted">{children}</div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
export function Section({ title, children }) {
  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">{title}</span>
      </div>
      <div className="rs-flex rs-flex-col rs-gap-4">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle switch — M3-style sliding switch
// ---------------------------------------------------------------------------
export function Toggle({ checked, onChange, label, id, disabled }) {
  return (
    <div className="toggle-row" style={{ padding: 0 }}>
      {label && <span className="toggle-label">{label}</span>}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  )
}
