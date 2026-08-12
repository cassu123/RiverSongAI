// =============================================================================
// src/pages/settings/IntentRouterSection.jsx
//
// INTENT ROUTER — admin: auto model routing sensitivity + routing map.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

//: Keyed by the router's own intent ids, so an intent added to
//: _INTENT_ROUTES shows up here with a default icon rather than not at all.
const INTENT_ICONS = {
  home_control: 'home',
  quick_lookup: 'bolt',
  reasoning:    'psychology',
  creative:     'draw',
  code:         'code',
  commerce:     'storefront',
  research:     'travel_explore',
  general:      'chat',
}

/**
 * Render the automatic model routing settings panel.
 * @param {Object} props - Component properties.
 * @param {Object} props.intentRouterSettings - Current routing settings and resolved provider routes.
 * @param {Function} props.saveIntentRouter - Saves changes to the routing settings.
 */
export default function IntentRouterSection({ intentRouterSettings, saveIntentRouter }) {
  return (
    <Section title="INTENT ROUTER">
          <Toggle
            id="intent-router-toggle"
            label="Enable Auto Model Routing"
            checked={intentRouterSettings.enabled}
            onChange={v => saveIntentRouter({ enabled: v })}
          />
          {/* The prose here used to name Nemotron, Kimi and Gemini as the
              destinations, which stopped being true the moment a provider was
              switched off. The map below is resolved live; let it do the
              naming. */}
          <p className="rs-card-meta">
            Selecting <strong>River Decides</strong> in the chat model picker routes each message
            to the best available provider automatically. Each intent falls through its
            preference chain until it reaches a provider that is switched on — the map below
            shows where each one lands right now.
          </p>
          {!intentRouterSettings.enabled && (
            <p className="rs-card-meta" style={{ opacity: 0.85 }}>
              Routing is off, so <strong>River Decides</strong> currently answers from your local
              model instead of consulting this map.
            </p>
          )}

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

          {/* Routing map — resolved server-side against the live provider
              gates. This was a hardcoded list of eight (intent, model) pairs,
              which was only ever the head of each preference chain: it showed
              "Commerce → Claude" with Anthropic switched off, when the router
              had in fact walked on to Gemini and then to Kimi. The panel was
              describing a decision it was not making. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {(intentRouterSettings.routes || []).map((r) => {
              const where = r.provider === 'ollama' ? 'local'
                : r.provider === 'nvidia_nim' ? 'NIM'
                  : r.provider ? 'cloud' : null
              return (
                <div key={r.intent} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 10, opacity: r.reachable ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.75 }}>{INTENT_ICONS[r.intent] || 'chat'}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{r.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span className="rs-card-meta" style={{ fontSize: '0.68rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.reachable ? r.display_name : 'No provider available'}
                    </span>
                    {where && (
                      <span className="rs-pill" style={{
                        fontSize: '0.65rem', padding: '1px 6px', opacity: 0.7, flexShrink: 0,
                        background: where === 'local' ? 'color-mix(in srgb, var(--primary) 12%, transparent)' :
                          where === 'NIM' ? 'color-mix(in srgb, var(--md-sys-color-tertiary) 12%, transparent)' :
                            'color-mix(in srgb, var(--md-sys-color-secondary) 12%, transparent)',
                      }}>{where}</span>
                    )}
                  </div>
                  {r.fell_back && (
                    <span className="rs-card-meta" style={{ fontSize: '0.62rem', opacity: 0.8 }}>
                      {r.first_choice_display_name} unavailable
                    </span>
                  )}
                </div>
              )
            })}
            {(intentRouterSettings.routes || []).length === 0 && (
              <p className="rs-card-meta" style={{ fontSize: '0.7rem' }}>Routing map unavailable.</p>
            )}
          </div>
        </Section>
  )
}
