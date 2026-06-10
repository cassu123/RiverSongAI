// =============================================================================
// src/pages/settings/shared.jsx
//
// Shared building blocks for the Settings page sections.
// =============================================================================

import React from 'react'

export const API_BASE = '' // same origin

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
export function Section({ title, children }) {
  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
