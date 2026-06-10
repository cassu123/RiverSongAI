// =============================================================================
// src/pages/settings/FeedsSection.jsx
//
// FEEDS — weather, sports, stocks, space, earth, happenings preferences.
// =============================================================================

import React, { useState } from 'react'
import { Section, Toggle } from './shared.jsx'

// ---------------------------------------------------------------------------
// Stocks watchlist editor (needs local state, must be a real component)
// ---------------------------------------------------------------------------
function StocksWatchlistSetting({ tickers, onSave }) {
  const [addSym, setAddSym] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {tickers.map(t => (
          <div
            key={t}
            className="rs-pill is-active"
            style={{ fontSize: '0.65rem', cursor: 'default', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {t}
            <button
              onClick={() => onSave(tickers.filter(x => x !== t))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', opacity: 0.6, lineHeight: 1 }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>close</span>
            </button>
          </div>
        ))}
        {tickers.length === 0 && (
          <span className="rs-card-meta" style={{ fontSize: '0.72rem' }}>No tickers saved yet.</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          className="rs-input"
          placeholder="Add ticker (e.g. AAPL)"
          value={addSym}
          onChange={e => setAddSym(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter' && addSym.trim() && !tickers.includes(addSym.trim()) && tickers.length < 15) {
              onSave([...tickers, addSym.trim()])
              setAddSym('')
            }
          }}
          style={{ flex: 1, fontSize: '0.85rem' }}
        />
        <button
          className="rs-pill"
          disabled={!addSym.trim() || tickers.includes(addSym.trim()) || tickers.length >= 15}
          onClick={() => {
            if (!addSym.trim() || tickers.includes(addSym.trim())) return
            onSave([...tickers, addSym.trim()])
            setAddSym('')
          }}
        >
          ADD
        </button>
      </div>
      <p className="rs-card-meta" style={{ marginTop: 8 }}>
        Up to 15 symbols. Prices refresh every 30 seconds on the Stocks tab.
      </p>
    </div>
  )
}

export default function FeedsSection({ feedPrefs, setFeedPrefs, saveFeedPrefs }) {
  return (
    <Section title="FEEDS">

          {/* ── Weather ───────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12 }}>WEATHER</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginBottom: 12 }}>
            <div>
              <div className="rs-card-meta" style={{ marginBottom: 8 }}>Latitude</div>
              <input
                type="number"
                step="any"
                className="rs-input"
                value={feedPrefs.weather_lat ?? ''}
                onChange={e => setFeedPrefs(p => ({ ...p, weather_lat: parseFloat(e.target.value) || null }))}
                onBlur={e => saveFeedPrefs({ weather_lat: parseFloat(e.target.value) || null })}
                placeholder="e.g. 34.7465"
              />
            </div>
            <div>
              <div className="rs-card-meta" style={{ marginBottom: 8 }}>Longitude</div>
              <input
                type="number"
                step="any"
                className="rs-input"
                value={feedPrefs.weather_lon ?? ''}
                onChange={e => setFeedPrefs(p => ({ ...p, weather_lon: parseFloat(e.target.value) || null }))}
                onBlur={e => saveFeedPrefs({ weather_lon: parseFloat(e.target.value) || null })}
                placeholder="e.g. -92.2896"
              />
            </div>
          </div>

          <button
            className="rs-pill"
            style={{ marginBottom: 16 }}
            onClick={() => {
              if (!navigator.geolocation) return
              navigator.geolocation.getCurrentPosition(pos => {
                const lat = parseFloat(pos.coords.latitude.toFixed(6))
                const lon = parseFloat(pos.coords.longitude.toFixed(6))
                saveFeedPrefs({ weather_lat: lat, weather_lon: lon })
              })
            }}
          >
            <span className="material-symbols-rounded">my_location</span>
            USE MY LOCATION
          </button>

          <div style={{ marginBottom: 16 }}>
            <div className="rs-card-label" style={{ marginBottom: 8, fontSize: '0.6rem' }}>TEMPERATURE UNIT</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['celsius', 'fahrenheit'].map(u => (
                <button
                  key={u}
                  className={`rs-pill ${feedPrefs.weather_unit === u ? 'is-active' : ''}`}
                  onClick={() => saveFeedPrefs({ weather_unit: u })}
                >
                  {u === 'celsius' ? '°C' : '°F'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="rs-card-label" style={{ marginBottom: 8, fontSize: '0.6rem' }}>AQI SOURCE</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['purpleair', 'openmeteo'].map(src => (
                <button
                  key={src}
                  className={`rs-pill ${feedPrefs.aqi_source === src ? 'is-active' : (feedPrefs.aqi_source === undefined && src === 'purpleair' ? 'is-active' : '')}`}
                  onClick={() => saveFeedPrefs({ aqi_source: src })}
                >
                  {src === 'purpleair' ? 'PurpleAir' : 'Open-Meteo'}
                </button>
              ))}
            </div>
          </div>

          <Toggle
            id="weather-alerts"
            label="Severe Weather Alerts"
            checked={feedPrefs.weather_alerts_enabled !== false}
            onChange={v => saveFeedPrefs({ weather_alerts_enabled: v })}
          />
          <p className="rs-card-meta" style={{ marginBottom: 24 }}>
            Show NWS alerts in the Weather tab when active warnings are in effect.
          </p>

          {/* ── Sports ────────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12 }}>SPORTS</div>

          <div style={{ marginBottom: 8, fontSize: '0.6rem' }} className="rs-card-label">FAVORITE LEAGUES</div>
          {(() => {
            const ALL_LEAGUES = [
              { id: 'nba',    label: 'NBA' },
              { id: 'nfl',    label: 'NFL' },
              { id: 'mlb',    label: 'MLB' },
              { id: 'nhl',    label: 'NHL' },
              { id: 'mls',    label: 'MLS' },
              { id: 'wnba',   label: 'WNBA' },
              { id: 'ncaaf',  label: 'NCAAF' },
              { id: 'ncaab',  label: 'NCAAB' },
              { id: 'epl',    label: 'EPL' },
              { id: 'laliga', label: 'La Liga' },
            ]
            const active = feedPrefs.sports_favorite_leagues || ['nba', 'nfl', 'mlb']
            const toggle = (id) => {
              const next = active.includes(id) ? active.filter(x => x !== id) : [...active, id]
              if (next.length > 0) saveFeedPrefs({ sports_favorite_leagues: next })
            }
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 24 }}>
                {ALL_LEAGUES.map(({ id, label }) => (
                  <button
                    key={id}
                    className={`rs-pill ${active.includes(id) ? 'is-active' : ''}`}
                    onClick={() => toggle(id)}
                    style={{ fontSize: '0.65rem' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )
          })()}

          {/* ── Stocks ────────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12 }}>STOCKS WATCHLIST</div>
          <StocksWatchlistSetting
            tickers={feedPrefs.stock_tickers || []}
            onSave={next => saveFeedPrefs({ stock_tickers: next })}
          />

          {/* ── Space ────────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12, marginTop: 32 }}>SPACE</div>
          <Toggle id="space-enabled" label="Enable Space Tab" checked={feedPrefs.feed_space_enabled !== false} onChange={v => saveFeedPrefs({ feed_space_enabled: v })} />
          {feedPrefs.feed_space_enabled !== false && (
            <div style={{ paddingLeft: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Toggle id="space-solar" label="Show Solar Weather" checked={feedPrefs.space_show_solar !== false} onChange={v => saveFeedPrefs({ space_show_solar: v })} />
              <Toggle id="space-aurora" label="Show Aurora Forecast" checked={feedPrefs.space_show_aurora !== false} onChange={v => saveFeedPrefs({ space_show_aurora: v })} />
              <Toggle id="space-launches" label="Show Rocket Launches" checked={feedPrefs.space_show_launches !== false} onChange={v => saveFeedPrefs({ space_show_launches: v })} />
            </div>
          )}

          {/* ── Earth ────────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12, marginTop: 32 }}>EARTH</div>
          <Toggle id="earth-enabled" label="Enable Earth Tab" checked={feedPrefs.feed_earth_enabled !== false} onChange={v => saveFeedPrefs({ feed_earth_enabled: v })} />
          {feedPrefs.feed_earth_enabled !== false && (
            <div style={{ paddingLeft: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Toggle id="earth-eonet" label="Show NASA EONET" checked={feedPrefs.earth_show_eonet !== false} onChange={v => saveFeedPrefs({ earth_show_eonet: v })} />
              <Toggle id="earth-neows" label="Show NASA NeoWs" checked={feedPrefs.earth_show_neows !== false} onChange={v => saveFeedPrefs({ earth_show_neows: v })} />
              <Toggle id="earth-ocearch" label="Show OCEARCH Sharks" checked={feedPrefs.earth_show_ocearch !== false} onChange={v => saveFeedPrefs({ earth_show_ocearch: v })} />
            </div>
          )}

          {/* ── Happenings ────────────────────────────────────────────── */}
          <div className="rs-card-label" style={{ marginBottom: 12, marginTop: 32 }}>HAPPENINGS</div>
          <Toggle id="happenings-enabled" label="Enable Happenings Tab" checked={feedPrefs.feed_happenings_enabled !== false} onChange={v => saveFeedPrefs({ feed_happenings_enabled: v })} />
          {feedPrefs.feed_happenings_enabled !== false && (
            <div style={{ paddingLeft: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Toggle id="happenings-hn" label="Show HackerNews" checked={feedPrefs.happenings_show_hn !== false} onChange={v => saveFeedPrefs({ happenings_show_hn: v })} />
              <Toggle id="happenings-reddit" label="Show Reddit" checked={feedPrefs.happenings_show_reddit !== false} onChange={v => saveFeedPrefs({ happenings_show_reddit: v })} />
              <Toggle id="happenings-events" label="Show Local Events" checked={feedPrefs.happenings_show_events !== false} onChange={v => saveFeedPrefs({ happenings_show_events: v })} />
              
              {feedPrefs.happenings_show_events !== false && (
                <div style={{ marginTop: 8 }}>
                  <div className="rs-card-meta" style={{ marginBottom: 8 }}>Event Search Radius: {feedPrefs.happenings_event_radius_mi || 25} mi</div>
                  <input 
                    type="range" 
                    min="5" max="100" step="5"
                    value={feedPrefs.happenings_event_radius_mi || 25}
                    onChange={e => setFeedPrefs(p => ({ ...p, happenings_event_radius_mi: parseInt(e.target.value) }))}
                    onMouseUp={e => saveFeedPrefs({ happenings_event_radius_mi: parseInt(e.target.value) })}
                    onTouchEnd={e => saveFeedPrefs({ happenings_event_radius_mi: parseInt(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

        </Section>
  )
}
