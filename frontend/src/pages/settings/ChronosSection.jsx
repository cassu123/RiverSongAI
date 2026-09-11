// =============================================================================
// src/pages/settings/ChronosSection.jsx
//
// CHRONOS · MEMORY VAULT — admin: vault overview + Scribe daemon toggle.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function ChronosSection({ scribeEnabled, saveScribeEnabled, daemonStatus }) {
  return (
    <Section title="CHRONOS · MEMORY VAULT">
          {/* Header row */}
          <div className="rs-flex rs-items-center rs-gap-3">
            <span className="material-symbols-rounded rs-no-shrink" style={{ fontSize: '1.6rem', color: 'var(--primary)' }}>history_edu</span>
            <div className="rs-grow">
              <div className="rs-type-small" style={{ fontWeight: 600 }}>Local markdown vault · Obsidian-style</div>
              <div className="rs-card-meta">Voice-to-note · Conversation memory · Editable facts · Backlinks</div>
            </div>
            <span className="rs-pill is-active rs-type-nano rs-no-shrink">LIVE</span>
          </div>

          {/* Vault tree — 3-column, folder icons, monospace paths */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {[
              { path: 'Personal/',       desc: 'Private to you',     icon: 'lock',         color: 'var(--primary)' },
              { path: 'Household/',      desc: 'Shared with family',  icon: 'home',         color: 'var(--md-sys-color-tertiary)' },
              { path: 'Shared with me/', desc: 'Explicit invites',    icon: 'group',        color: 'var(--md-sys-color-secondary)' },
            ].map(({ path, desc, icon, color }) => (
              <div key={path} className="rs-flex rs-flex-col rs-gap-1" style={{ padding: 'var(--rs-space-3) var(--rs-space-3)', background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-sm)' }}>
                <div className="rs-flex rs-items-center rs-gap-2">
                  <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', color }}>{icon}</span>
                  <code className="rs-type-nano" style={{ fontWeight: 600 }}>{path}</code>
                </div>
                <div className="rs-card-meta rs-type-nano">{desc}</div>
              </div>
            ))}
          </div>

          {/* Scribe daemon toggle */}
          <div className="rs-flex rs-items-center rs-gap-3">
            <Toggle
              id="scribe-toggle"
              label="Enable Scribe Daemon"
              checked={scribeEnabled}
              onChange={v => saveScribeEnabled(v)}
            />
            <span className="rs-pill rs-type-nano rs-no-shrink" style={{ color: daemonStatus?.scribe?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
              {daemonStatus?.scribe?.alive ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>
          <p className="rs-card-meta" style={{ marginTop: -8 }}>
            Watches the vault, re-indexes notes, extracts facts, and logs conversation summaries to your daily note.
            Path: <code>data/vault/</code>
          </p>

          {/* Status */}
          <div className="rs-flex rs-items-center rs-gap-2" style={{ padding: 'var(--rs-space-2) var(--rs-space-3)', borderRadius: 'var(--md-shape-sm)', background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}>
            <span className="material-symbols-rounded rs-no-shrink" style={{ fontSize: '1rem', color: 'var(--primary)' }}>check_circle</span>
            <span className="rs-card-meta rs-type-micro">
              CHRONOS page, CodeMirror editor, backlinks, search, and Scribe daemon are fully operational. Graph view is Phase 3.
            </span>
          </div>
        </Section>
  )
}
