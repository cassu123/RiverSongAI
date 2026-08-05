// =============================================================================
// src/pages/settings/BriefingSection.jsx
//
// BRIEFING — admin: startup briefing, pulse widgets, location.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function BriefingSection({ briefingSettings, setBriefingSettings, saveBriefingSettings }) {
  return (
    <Section title="BRIEFING">
          <Toggle
            id="briefing-startup"
            label="Enable Startup Briefing"
            checked={!!briefingSettings.startup_briefing_enabled}
            onChange={v => saveBriefingSettings({ startup_briefing_enabled: v })}
          />
          <p className="rs-card-meta">
            When enabled, River will greet you with a morning briefing based on upcoming events and daily news when you start a session.
          </p>
          <div style={{ height: 16 }} />
          <Toggle
            id="briefing-news"
            label="Enable News Pulse"
            checked={!!briefingSettings.pulse_news_enabled}
            onChange={v => saveBriefingSettings({ pulse_news_enabled: v })}
          />
          <p className="rs-card-meta">
            Cycles up to 5 recent headlines in the dashboard pulse widget.
          </p>

          {briefingSettings.pulse_news_enabled && (() => {
            const PULSE_CATS = [
              { key: 'world',         label: 'World' },
              { key: 'us',            label: 'US National' },
              { key: 'local',         label: 'Local · AR' },
              { key: 'technology',    label: 'Technology' },
              { key: 'business',      label: 'Business' },
              { key: 'entertainment', label: 'Entertainment' },
              { key: 'health',        label: 'Health' },
              { key: 'science',       label: 'Science' },
            ]
            const active = Array.isArray(briefingSettings.pulse_news_categories)
              ? briefingSettings.pulse_news_categories
              : ['world', 'us']
            const toggle = (key) => {
              const next = active.includes(key)
                ? active.filter(k => k !== key)
                : [...active, key]
              if (next.length > 0) saveBriefingSettings({ pulse_news_categories: next })
            }
            return (
              <div style={{ marginTop: 10 }}>
                <div className="rs-card-label" style={{ marginBottom: 8, fontSize: '0.6rem' }}>NEWS SOURCE CATEGORIES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PULSE_CATS.map(({ key, label }) => {
                    const on = active.includes(key)
                    return (
                      <button
                        key={key}
                        onClick={() => toggle(key)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 4,
                          border: `1px solid ${on ? 'var(--primary)' : 'oklch(30% 0.01 265)'}`,
                          background: on ? 'oklch(20% 0.06 265)' : 'transparent',
                          color: on ? 'var(--primary)' : 'oklch(50% 0.01 265)',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <p className="rs-card-meta" style={{ marginTop: 6 }}>
                  Active categories feed the cycling ticker. Health and Entertainment excluded by default to avoid clickbait.
                </p>
              </div>
            )
          })()}

          <div style={{ height: 16 }} />
          <Toggle
            id="briefing-markets"
            label="Enable Markets Pulse"
            checked={!!briefingSettings.pulse_markets_enabled}
            onChange={v => saveBriefingSettings({ pulse_markets_enabled: v })}
          />
          <p className="rs-card-meta">
            Show the ticker quote in the dashboard pulse widget.
          </p>
          <div style={{ height: 16 }} />
          <Toggle
            id="briefing-flights"
            label="Enable Flights Tracker"
            checked={!!briefingSettings.pulse_flights_enabled}
            onChange={v => saveBriefingSettings({ pulse_flights_enabled: v })}
          />
          <p className="rs-card-meta">
            Show active aircraft detected overhead in the pulse widget.
          </p>
          <div style={{ height: 24 }} />
          
          <div className="rs-card-label" style={{ marginBottom: 12 }}>LOCATION (FOR WEATHER & FLIGHTS)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="rs-card-meta" style={{ marginBottom: 8 }}>Latitude</div>
              <input
                type="number"
                step="any"
                className="rs-input"
                value={briefingSettings.location_lat ?? ''}
                onChange={e => setBriefingSettings(prev => ({ ...prev, location_lat: parseFloat(e.target.value) || null }))}
                onBlur={e => saveBriefingSettings({ location_lat: parseFloat(e.target.value) || null })}
                placeholder="e.g. 37.7749"
              />
            </div>
            <div>
              <div className="rs-card-meta" style={{ marginBottom: 8 }}>Longitude</div>
              <input
                type="number"
                step="any"
                className="rs-input"
                value={briefingSettings.location_lon ?? ''}
                onChange={e => setBriefingSettings(prev => ({ ...prev, location_lon: parseFloat(e.target.value) || null }))}
                onBlur={e => saveBriefingSettings({ location_lon: parseFloat(e.target.value) || null })}
                placeholder="e.g. -122.4194"
              />
            </div>
          </div>
          <p className="rs-card-meta" style={{ marginTop: 8 }}>
            Setting coordinates here will override the .env defaults for Pulse features.
          </p>
        </Section>
  )
}
