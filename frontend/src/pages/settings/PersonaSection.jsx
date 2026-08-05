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
          <div style={{ marginBottom: 12, padding: '12px', background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)', borderRadius: 'var(--md-shape-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)', flexShrink: 0 }}>warning</span>
            <span style={{ color: 'var(--rs-status-warning)', fontSize: '0.8rem' }}>Advanced — Keep "River Song" references intact or she will lose her identity.</span>
          </div>
          
          <div style={{ position: 'relative' }}>
            <textarea
              className="persona-textarea rs-card"
              style={{ width: '100%', minHeight: 300, background: 'var(--md-surface-container-low)' }}
              value={personaSettings.system_prompt}
              onChange={e => setPersonaSettings({ system_prompt: e.target.value })}
              placeholder="River Song system prompt..."
              rows={12}
            />
            <div style={{ position: 'absolute', bottom: 12, right: 16, fontSize: '0.65rem', opacity: 0.5, pointerEvents: 'none' }}>
              {personaSettings.system_prompt.length} chars
            </div>
          </div>

          <p className="rs-card-meta">
            Defines her personality and knowledge. Changes take effect on the next session.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
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
