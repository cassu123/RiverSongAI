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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.6rem', color: 'var(--primary)', flexShrink: 0 }}>history_edu</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Local markdown vault · Obsidian-style</div>
              <div className="rs-card-meta">Voice-to-note · Conversation memory · Editable facts · Backlinks</div>
            </div>
            <span className="rs-pill is-active" style={{ fontSize: '0.6rem', flexShrink: 0 }}>LIVE</span>
          </div>

          {/* Vault tree — 3-column, folder icons, monospace paths */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {[
              { path: 'Personal/',       desc: 'Private to you',     icon: 'lock',         color: 'var(--primary)' },
              { path: 'Household/',      desc: 'Shared with family',  icon: 'home',         color: 'var(--md-sys-color-tertiary)' },
              { path: 'Shared with me/', desc: 'Explicit invites',    icon: 'group',        color: 'var(--md-sys-color-secondary)' },
            ].map(({ path, desc, icon, color }) => (
              <div key={path} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', color }}>{icon}</span>
                  <code style={{ fontSize: '0.7rem', fontWeight: 600 }}>{path}</code>
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.63rem' }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* Scribe daemon toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle
              id="scribe-toggle"
              label="Enable Scribe Daemon"
              checked={scribeEnabled}
              onChange={v => saveScribeEnabled(v)}
            />
            <span className="rs-pill" style={{ fontSize: '0.6rem', flexShrink: 0, color: daemonStatus?.scribe?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
              {daemonStatus?.scribe?.alive ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>
          <p className="rs-card-meta" style={{ marginTop: -8 }}>
            Watches the vault, re-indexes notes, extracts facts, and logs conversation summaries to your daily note.
            Path: <code>data/vault/</code>
          </p>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--primary)', flexShrink: 0 }}>check_circle</span>
            <span className="rs-card-meta" style={{ fontSize: '0.72rem' }}>
              CHRONOS page, CodeMirror editor, backlinks, search, and Scribe daemon are fully operational. Graph view is Phase 3.
            </span>
          </div>
        </Section>
  )
}
