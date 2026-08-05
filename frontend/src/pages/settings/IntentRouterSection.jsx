// =============================================================================
// src/pages/settings/IntentRouterSection.jsx
//
// INTENT ROUTER — admin: auto model routing sensitivity + routing map.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function IntentRouterSection({ intentRouterSettings, saveIntentRouter }) {
  return (
    <Section title="INTENT ROUTER">
          <Toggle
            id="intent-router-toggle"
            label="Enable Auto Model Routing"
            checked={intentRouterSettings.enabled}
            onChange={v => saveIntentRouter({ enabled: v })}
          />
          <p className="rs-card-meta">
            Selecting <strong>River Decides</strong> in the chat model picker routes each message
            to the best provider automatically. Home commands stay local, complex reasoning goes
            to Nemotron, creative writing to Kimi, research to Gemini.
          </p>

          {/* Sensitivity selector — min 44px touch targets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="rs-card-meta" style={{ margin: 0, flexShrink: 0 }}>Signal sensitivity</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { n: 1, label: 'High',          desc: 'Routes on 1+ match' },
                { n: 2, label: 'Balanced',      desc: 'Routes on 2+ matches' },
                { n: 3, label: 'Conservative',  desc: 'Routes on 3+ matches' },
              ].map(({ n, label }) => (
                <button
                  key={n}
                  className={`rs-pill is-tappable${intentRouterSettings.min_hits === n ? ' is-active' : ''}`}
                  style={{ fontSize: '0.75rem', minHeight: 44, minWidth: 44, padding: '0 14px', cursor: 'pointer' }}
                  onClick={() => saveIntentRouter({ min_hits: n })}
                  aria-pressed={intentRouterSettings.min_hits === n}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Routing map — 2-column grid, intent → model */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {[
              { intent: 'Home Control', model: 'Llama 1B',    icon: 'home',          where: 'local' },
              { intent: 'Quick Lookup', model: 'Llama 3B',    icon: 'bolt',          where: 'local' },
              { intent: 'Reasoning',    model: 'Nemotron',    icon: 'psychology',    where: 'NIM' },
              { intent: 'Creative',     model: 'Kimi K2.6',   icon: 'draw',          where: 'NIM' },
              { intent: 'Code',         model: 'Qwen Coder',  icon: 'code',          where: 'local' },
              { intent: 'Commerce',     model: 'Claude',      icon: 'storefront',    where: 'cloud' },
              { intent: 'Research',     model: 'Gemini',      icon: 'travel_explore', where: 'cloud' },
              { intent: 'General',      model: 'Llama 3B',    icon: 'chat',          where: 'local' },
            ].map(({ intent, model, icon, where }) => (
              <div key={intent} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.75 }}>{icon}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{intent}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="rs-card-meta" style={{ fontSize: '0.68rem' }}>{model}</span>
                  <span className="rs-pill" style={{
                    fontSize: '0.65rem', padding: '1px 6px',
                    opacity: 0.7,
                    background: where === 'local' ? 'color-mix(in srgb, var(--primary) 12%, transparent)' :
                                where === 'NIM'   ? 'color-mix(in srgb, var(--md-sys-color-tertiary) 12%, transparent)' :
                                                    'color-mix(in srgb, var(--md-sys-color-secondary) 12%, transparent)',
                  }}>{where}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
  )
}
