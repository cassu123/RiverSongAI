// =============================================================================
// src/pages/settings/PersonaSection.jsx
//
// PERSONALITY — admin: River Song system prompt editor.
// =============================================================================

import React from 'react'
import { Section } from './shared.jsx'

export default function PersonaSection({ personaSettings, setPersonaSettings, savePersona, resetPersona }) {
  return (
    <Section title="PERSONALITY">
          <div className="rs-mb-3 rs-flex rs-items-center rs-gap-2" style={{ padding: 'var(--rs-space-3)', background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)', borderRadius: 'var(--md-shape-sm)' }}>
            <span className="material-symbols-rounded rs-no-shrink" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)' }}>warning</span>
            <span className="rs-type-tiny" style={{ color: 'var(--rs-status-warning)' }}>Advanced — Keep "River Song" references intact or she will lose her identity.</span>
          </div>
          
          <div className="rs-relative">
            <textarea
              className="persona-textarea rs-card rs-w-full"
              style={{ minHeight: 300, background: 'var(--md-surface-container-low)' }}
              value={personaSettings.system_prompt}
              onChange={e => setPersonaSettings({ system_prompt: e.target.value })}
              placeholder="River Song system prompt..."
              rows={12}
            />
            <div className="rs-muted rs-type-nano" style={{ position: 'absolute', bottom: 12, right: 16, pointerEvents: 'none' }}>
              {personaSettings.system_prompt.length} chars
            </div>
          </div>

          <p className="rs-card-meta">
            Defines her personality and knowledge. Changes take effect on the next session.
          </p>

          <div className="rs-flex rs-flex-wrap rs-gap-3 rs-mt-4">
            <button className="rs-btn-primary" onClick={() => savePersona(personaSettings.system_prompt)}>
              SAVE CHANGES
            </button>
            <button className="rs-pill" onClick={resetPersona}>
              RESET TO DEFAULT
            </button>
          </div>
        </Section>
  )
}
