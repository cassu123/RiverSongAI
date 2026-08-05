// =============================================================================
// FeedTabSettings — per-tab feed preferences, rendered inline inside each feed
// tab instead of one centralized block in user Settings.
//
// All feed prefs are per-user and persisted via /api/feeds/preferences (a full
// object PUT). useFeedPrefs() loads them once and returns a savePrefs(patch)
// that optimistically merges + persists.
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react'
import { InlineSettingsSection, Toggle } from '../TabSettingsPanel.jsx'

const API = import.meta.env.VITE_API_URL || ''

export function useFeedPrefs(token) {
  const [prefs, setPrefs] = useState(null)

  useEffect(() => {
    let alive = true
    fetch(`${API}/api/feeds/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : {}))
      .then(d => { if (alive) setPrefs(d || {}) })
      .catch(() => { if (alive) setPrefs({}) })
    return () => { alive = false }
  }, [token])

  const savePrefs = useCallback((patch) => {
    setPrefs(prev => {
      const next = { ...(prev || {}), ...patch }
      fetch(`${API}/api/feeds/preferences`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {})
      return next
    })
  }, [token])

  return { prefs, savePrefs }
}

// ---------------------------------------------------------------------------
// Weather — location, unit, AQI source, severe-weather alerts
// ---------------------------------------------------------------------------
export function WeatherSettings({ prefs, savePrefs }) {
  const p = prefs || {}
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  useEffect(() => {
    setLat(p.weather_lat ?? '')
    setLon(p.weather_lon ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.weather_lat, prefs?.weather_lon])

  const subtitle = (p.weather_lat != null && p.weather_lon != null)
    ? `${Number(p.weather_lat).toFixed(2)}, ${Number(p.weather_lon).toFixed(2)}`
    : 'location not set'

  return (
    <InlineSettingsSection title="WEATHER SETTINGS" icon="tune" subtitle={subtitle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="rs-card-meta" style={{ marginBottom: 8 }}>Latitude</div>
          <input
            type="number" step="any" className="rs-input"
            value={lat}
            onChange={e => setLat(e.target.value)}
            onBlur={e => savePrefs({ weather_lat: parseFloat(e.target.value) || null })}
            placeholder="e.g. 34.7465"
          />
        </div>
        <div>
          <div className="rs-card-meta" style={{ marginBottom: 8 }}>Longitude</div>
          <input
            type="number" step="any" className="rs-input"
            value={lon}
            onChange={e => setLon(e.target.value)}
            onBlur={e => savePrefs({ weather_lon: parseFloat(e.target.value) || null })}
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
            savePrefs({
              weather_lat: parseFloat(pos.coords.latitude.toFixed(6)),
              weather_lon: parseFloat(pos.coords.longitude.toFixed(6)),
            })
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
              className={`rs-pill ${p.weather_unit === u ? 'is-active' : ''}`}
              onClick={() => savePrefs({ weather_unit: u })}
            >
              {u === 'celsius' ? '°C' : '°F'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="rs-card-label" style={{ marginBottom: 8, fontSize: '0.6rem' }}>AQI SOURCE</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['purpleair', 'openmeteo'].map(src => {
            const isActive = p.aqi_source === src || (p.aqi_source === undefined && src === 'purpleair')
            return (
              <button
                key={src}
                className={`rs-pill ${isActive ? 'is-active' : ''}`}
                onClick={() => savePrefs({ aqi_source: src })}
              >
                {src === 'purpleair' ? 'PurpleAir' : 'Open-Meteo'}
              </button>
            )
          })}
        </div>
      </div>

      <Toggle
        checked={p.weather_alerts_enabled !== false}
        onChange={v => savePrefs({ weather_alerts_enabled: v })}
        label="Severe Weather Alerts"
      />
      <p className="rs-card-meta" style={{ marginTop: 8 }}>
        Show NWS alerts here when active warnings are in effect.
      </p>
    </InlineSettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Stocks — watchlist tickers
// ---------------------------------------------------------------------------
export function StocksSettings({ prefs, savePrefs }) {
  const tickers = (prefs || {}).stock_tickers || []
  const [addSym, setAddSym] = useState('')
  const add = () => {
    const sym = addSym.trim()
    if (!sym || tickers.includes(sym) || tickers.length >= 15) return
    savePrefs({ stock_tickers: [...tickers, sym] })
    setAddSym('')
  }
  return (
    <InlineSettingsSection title="WATCHLIST" icon="tune" subtitle={`${tickers.length} symbol${tickers.length === 1 ? '' : 's'}`}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {tickers.map(t => (
          <div key={t} className="rs-pill is-active" style={{ fontSize: '0.65rem', cursor: 'default', display: 'flex', alignItems: 'center', gap: 6 }}>
            {t}
            <button
              onClick={() => savePrefs({ stock_tickers: tickers.filter(x => x !== t) })}
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
          type="text" className="rs-input" placeholder="Add ticker (e.g. AAPL)"
          value={addSym}
          onChange={e => setAddSym(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          style={{ flex: 1, fontSize: '0.85rem' }}
        />
        <button className="rs-pill" disabled={!addSym.trim() || tickers.includes(addSym.trim()) || tickers.length >= 15} onClick={add}>
          ADD
        </button>
      </div>
      <p className="rs-card-meta" style={{ marginTop: 8 }}>
        Up to 15 symbols. Prices refresh every 30 seconds.
      </p>
    </InlineSettingsSection>
  )
}

// ---------------------------------------------------------------------------
// Space / Earth / Happenings — per-source toggles (the tab's own enable switch
// lives in the Feeds "manage tabs" gear, so it can't hide its own control).
// ---------------------------------------------------------------------------
export function SpaceSettings({ prefs, savePrefs }) {
  const p = prefs || {}
  return (
    <InlineSettingsSection title="SPACE SETTINGS" icon="tune">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Toggle checked={p.space_show_solar !== false}    onChange={v => savePrefs({ space_show_solar: v })}    label="Show Solar Weather" />
        <Toggle checked={p.space_show_aurora !== false}   onChange={v => savePrefs({ space_show_aurora: v })}   label="Show Aurora Forecast" />
        <Toggle checked={p.space_show_launches !== false} onChange={v => savePrefs({ space_show_launches: v })} label="Show Rocket Launches" />
      </div>
    </InlineSettingsSection>
  )
}

export function EarthSettings({ prefs, savePrefs }) {
  const p = prefs || {}
  return (
    <InlineSettingsSection title="EARTH SETTINGS" icon="tune">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Toggle checked={p.earth_show_eonet !== false}   onChange={v => savePrefs({ earth_show_eonet: v })}   label="Show NASA EONET" />
        <Toggle checked={p.earth_show_neows !== false}   onChange={v => savePrefs({ earth_show_neows: v })}   label="Show NASA NeoWs" />
        <Toggle checked={p.earth_show_ocearch !== false} onChange={v => savePrefs({ earth_show_ocearch: v })} label="Show OCEARCH Sharks" />
      </div>
    </InlineSettingsSection>
  )
}

export function HappeningsSettings({ prefs, savePrefs }) {
  const p = prefs || {}
  const [radius, setRadius] = useState(25)
  useEffect(() => {
    setRadius(p.happenings_event_radius_mi || 25)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.happenings_event_radius_mi])
  return (
    <InlineSettingsSection title="HAPPENINGS SETTINGS" icon="tune">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Toggle checked={p.happenings_show_hn !== false}     onChange={v => savePrefs({ happenings_show_hn: v })}     label="Show HackerNews" />
        <Toggle checked={p.happenings_show_reddit !== false} onChange={v => savePrefs({ happenings_show_reddit: v })} label="Show Reddit" />
        <Toggle checked={p.happenings_show_events !== false} onChange={v => savePrefs({ happenings_show_events: v })} label="Show Local Events" />
        {p.happenings_show_events !== false && (
          <div style={{ marginTop: 4 }}>
            <div className="rs-card-meta" style={{ marginBottom: 8 }}>Event Search Radius: {radius} mi</div>
            <input
              type="range" min="5" max="100" step="5"
              value={radius}
              onChange={e => setRadius(parseInt(e.target.value))}
              onMouseUp={e => savePrefs({ happenings_event_radius_mi: parseInt(e.target.value) })}
              onTouchEnd={e => savePrefs({ happenings_event_radius_mi: parseInt(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>
    </InlineSettingsSection>
  )
}

// ---------------------------------------------------------------------------
// FeedTabsManager — the "which optional tabs are shown" switches. Rendered in
// the Feeds header gear (not inside a tab, since disabling a tab would hide its
// own control).
// ---------------------------------------------------------------------------
export const OPTIONAL_TABS = [
  { key: 'space',      flag: 'feed_space_enabled',      label: 'Space' },
  { key: 'earth',      flag: 'feed_earth_enabled',      label: 'Earth' },
  { key: 'happenings', flag: 'feed_happenings_enabled', label: 'Happenings' },
]

export function FeedTabsManager({ prefs, savePrefs }) {
  const p = prefs || {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="rs-card-label" style={{ fontSize: '0.58rem', opacity: 0.6 }}>SHOW THESE TABS</div>
      {OPTIONAL_TABS.map(t => (
        <Toggle
          key={t.key}
          checked={p[t.flag] !== false}
          onChange={v => savePrefs({ [t.flag]: v })}
          label={t.label}
        />
      ))}
    </div>
  )
}
