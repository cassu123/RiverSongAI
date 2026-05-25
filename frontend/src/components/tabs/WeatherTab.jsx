// Backend: GET /api/feeds/weather — Open-Meteo, no key.
// Settings: PATCH /api/settings/page { weather: { lat, lon, location_query, units, wind_unit, alerts_enabled } }
// units: 'metric' | 'imperial'   wind_unit: 'kmh' | 'mph'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { InlineSettingsSection, SettingsRow, ToggleGroup, Toggle } from '../TabSettingsPanel.jsx'

function wmoIcon(code) {
  if (code == null)  return 'wb_sunny'
  if (code === 0)    return 'wb_sunny'
  if (code <= 3)     return 'partly_cloudy_day'
  if (code <= 48)    return 'foggy'
  if (code <= 57)    return 'grain'
  if (code <= 67)    return 'rainy'
  if (code <= 77)    return 'weather_snowy'
  if (code <= 82)    return 'thunderstorm'
  if (code <= 86)    return 'weather_snowy'
  return 'thunderstorm'
}

function fmtHour(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', hour12: true })
}
function fmtDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
}

const ALERT_COLORS = {
  Extreme: 'oklch(50% 0.18 22)', Severe: 'oklch(58% 0.20 40)',
  Moderate: 'oklch(62% 0.18 75)', Minor: 'oklch(65% 0.15 95)',
}

// Debounced Nominatim geocode search
async function searchPlaces(q) {
  if (!q || q.length < 2) return []
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
      { headers: { 'User-Agent': 'RiverSongAI/1.0' } }
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

function LocationSearch({ onSelect, token }) {
  const [q, setQ]             = useState('')
  const [results, setResults] = useState([])
  const [searching, setSrch]  = useState(false)
  const debounce              = useRef(null)

  useEffect(() => {
    clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); return }
    setSrch(true)
    debounce.current = setTimeout(async () => {
      const r = await searchPlaces(q)
      setResults(r)
      setSrch(false)
    }, 400)
    return () => clearTimeout(debounce.current)
  }, [q])

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="rs-input"
        placeholder="Search city or place…"
        value={q}
        onChange={e => setQ(e.target.value)}
        style={{ width: '100%', fontSize: '0.82rem', boxSizing: 'border-box' }}
        autoFocus
      />
      {(results.length > 0 || searching) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--md-surface-container-high)',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 8, marginTop: 4, overflow: 'hidden',
        }}>
          {searching && (
            <div className="rs-card-meta" style={{ padding: '8px 14px', fontSize: '0.72rem' }}>Searching…</div>
          )}
          {results.map((r, i) => (
            <button key={i} onClick={() => {
              onSelect({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), location_query: r.display_name })
              setQ('')
              setResults([])
            }} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '9px 14px', background: 'none', border: 'none',
              borderTop: i > 0 ? '1px solid var(--md-outline-variant)' : 'none',
              cursor: 'pointer', fontSize: '0.75rem',
            }}>
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WeatherTab({ token, active }) {
  const [weather, setWeather]     = useState(null)
  const [alerts, setAlerts]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [settings, setSettings]   = useState(null)   // settings_json.weather
  const [settingsOpen, setSOpen]  = useState(false)
  const [radarTs, setRadarTs]     = useState(null)
  const authHeaders = { Authorization: `Bearer ${token}` }

  const patchSettings = useCallback(async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    await fetch('/api/settings/page', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ weather: next }),
    }).catch(() => {})
    return next
  }, [settings, token])

  const fetchWeather = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const [wRes, aRes] = await Promise.all([
        fetch('/api/feeds/weather', { headers: authHeaders }),
        fetch('/api/feeds/weather/alerts', { headers: authHeaders }),
      ])
      if (wRes.status === 404) { setError('location'); setLoading(false); return }
      if (!wRes.ok) throw new Error('Weather service unavailable')
      setWeather(await wRes.json())
      if (aRes.ok) {
        const ad = await aRes.json()
        setAlerts(ad.alerts || [])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  // Load settings on mount, then fetch weather
  useEffect(() => {
    if (!active) return
    fetch('/api/settings/page', { headers: authHeaders })
      .then(r => r.ok ? r.json() : {})
      .then(page => {
        const wx = page?.weather || {}
        setSettings(wx)
        if (!wx.lat || !wx.lon) {
          setError('location')
          setLoading(false)
          setSOpen(true)   // auto-expand settings when no location
        } else {
          fetchWeather()
        }
      })
      .catch(() => { setSettings({}); fetchWeather() })
  }, [token, active])

  // Fetch latest RainViewer radar frame when this tab is active and we
  // have a location. The frame path is appended to the tile URL below.
  useEffect(() => {
    if (!active || !settings?.lat || !settings?.lon) return
    let cancelled = false
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        const frames = d?.radar?.past || []
        if (frames.length) setRadarTs(frames[frames.length - 1].path)
      })
      .catch(() => {/* radar is supplemental; ignore failure */})
    return () => { cancelled = true }
  }, [active, settings?.lat, settings?.lon])

  // Re-fetch when settings change (location/units/wind)
  const handleSettingChange = useCallback(async (patch) => {
    const next = await patchSettings(patch)
    if (next.lat && next.lon) {
      fetchWeather()
    }
  }, [patchSettings, fetchWeather])

  const handleLocationSelect = useCallback(async ({ lat, lon, location_query }) => {
    await handleSettingChange({ lat, lon, location_query })
    setError(null)
    setSOpen(false)
  }, [handleSettingChange])

  if (loading && !settings) return <WeatherSkeleton />

  const noLocation = error === 'location'
  const { current, hourly = [], daily = [], air_quality = {}, location_name, unit } = weather || {}
  const C = current || {}
  const alertsEnabled = settings?.alerts_enabled !== false

  // Auto-open the inline settings panel when the user has no saved location
  // so the next step (search and select a city) is obvious.
  const locationLabel = settings?.location_query?.split(',').slice(0, 2).join(',') || location_name || 'no location set'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <InlineSettingsSection
        title="WEATHER SETTINGS"
        icon="tune"
        subtitle={locationLabel}
        open={settingsOpen || noLocation}
        onOpenChange={setSOpen}
      >
        <SettingsRow label="LOCATION">
          <LocationSearch onSelect={handleLocationSelect} token={token} />
          {settings?.location_query && (
            <div className="rs-card-meta" style={{ fontSize: '0.62rem', marginTop: 6, opacity: 0.6 }}>
              {settings.location_query.split(',').slice(0, 3).join(',')}
            </div>
          )}
        </SettingsRow>
        <SettingsRow label="TEMPERATURE">
          <ToggleGroup
            options={[{ value: 'metric', label: '°C' }, { value: 'imperial', label: '°F' }]}
            value={settings?.units || 'metric'}
            onChange={v => handleSettingChange({ units: v, wind_unit: v === 'imperial' ? 'mph' : 'kmh' })}
          />
        </SettingsRow>
        <SettingsRow label="WIND SPEED">
          <ToggleGroup
            options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]}
            value={settings?.wind_unit || (settings?.units === 'imperial' ? 'mph' : 'kmh')}
            onChange={v => handleSettingChange({ wind_unit: v })}
          />
        </SettingsRow>
        <SettingsRow label="ALERTS">
          <Toggle
            checked={alertsEnabled}
            onChange={v => handleSettingChange({ alerts_enabled: v })}
            label="Severe weather alerts"
          />
        </SettingsRow>
      </InlineSettingsSection>

      {/* No-location state — inline prompt */}
      {noLocation && (
        <div style={{ padding: '20px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>location_off</span>
            <div className="rs-card-label" style={{ marginBottom: 6 }}>NO LOCATION SET</div>
            <div className="rs-card-meta">Search for your city below.</div>
          </div>
          <LocationSearch onSelect={handleLocationSelect} token={token} />
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>cloud_off</span>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
          <button className="rs-pill" onClick={fetchWeather}>RETRY</button>
        </div>
      )}

      {/* Loading skeleton after location is set */}
      {loading && !noLocation && !error && <WeatherSkeleton />}

      {/* Weather content */}
      {!loading && !error && weather && (
        <>
          {/* Alerts */}
          {alertsEnabled && alerts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.slice(0, 2).map(a => (
                <div key={a.id} style={{
                  background: (ALERT_COLORS[a.severity] || '#88888822') + '22',
                  border: `1px solid ${ALERT_COLORS[a.severity] || '#88888888'}55`,
                  borderRadius: 8, padding: '12px 16px',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                  <span className="material-symbols-rounded" style={{ color: ALERT_COLORS[a.severity], flexShrink: 0, marginTop: 2 }}>warning</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: 2, color: ALERT_COLORS[a.severity] }}>{a.event}</div>
                    <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>{a.headline}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Current conditions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span className="material-symbols-rounded" style={{ fontSize: '3.5rem', color: 'var(--primary)', lineHeight: 1 }}>
                {wmoIcon(C.weathercode)}
              </span>
              <div>
                <div style={{ fontSize: '3.5rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em' }}>
                  {C.temperature != null ? Math.round(C.temperature) : '--'}{unit}
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.85rem', marginTop: 2 }}>
                  {C.condition}{location_name ? ` · ${location_name}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'FEELS',    value: C.feels_like    != null ? `${Math.round(C.feels_like)}${unit}` : '--' },
                { label: 'HUMIDITY', value: C.humidity      != null ? `${C.humidity}%` : '--' },
                { label: 'WIND',     value: C.wind_speed    != null ? `${Math.round(C.wind_speed)} ${C.wind_unit || 'km/h'}` : '--' },
                { label: 'UV',       value: C.uv_index      != null ? C.uv_index.toFixed(1) : '--' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.5 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem' }}>{value}</div>
                </div>
              ))}
              {air_quality?.aqi != null && (
                <div>
                  <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.5 }}>AQI</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', color: air_quality.color }}>
                    {air_quality.aqi} <span style={{ fontSize: '0.65rem', fontWeight: 400 }}>{air_quality.label}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Hourly strip */}
          {hourly.length > 0 && (
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.5, marginBottom: 10 }}>NEXT 24 HOURS</div>
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
                {hourly.map((h, i) => (
                  <div key={i} style={{
                    flexShrink: 0, textAlign: 'center', padding: '10px',
                    borderRadius: 8, minWidth: 52,
                    background: i === 0 ? 'var(--md-surface-container-high)' : 'transparent',
                  }}>
                    <div className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: 6 }}>{fmtHour(h.time)}</div>
                    <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                      {wmoIcon(h.weathercode)}
                    </span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem' }}>
                      {h.temperature != null ? Math.round(h.temperature) : '--'}°
                    </div>
                    {h.precip_prob > 0 && (
                      <div style={{ fontSize: '0.5rem', color: 'oklch(65% 0.15 240)', marginTop: 3, fontWeight: 600 }}>
                        {h.precip_prob}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7-day forecast */}
          {daily.length > 0 && (
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.5, marginBottom: 12 }}>7-DAY FORECAST</div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {daily.map((d, i) => (
                  <div key={d.date} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '10px 0',
                    borderBottom: i < daily.length - 1 ? '1px solid var(--md-outline-variant)' : 'none',
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '0.78rem', width: 32 }}>
                      {i === 0 ? 'TODAY' : fmtDay(d.date)}
                    </span>
                    <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--primary)', width: 24, textAlign: 'center' }}>
                      {wmoIcon(d.weathercode)}
                    </span>
                    <span className="rs-card-meta" style={{ flex: 1, fontSize: '0.75rem' }}>{d.condition}</span>
                    {d.precipitation > 0 && (
                      <span style={{ fontSize: '0.65rem', color: 'oklch(65% 0.15 240)', fontWeight: 600 }}>
                        {d.precipitation.toFixed(1)} mm
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', minWidth: 60 }}>
                      {d.temp_max != null ? Math.round(d.temp_max) : '--'}° / {d.temp_min != null ? Math.round(d.temp_min) : '--'}°
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live radar */}
          {settings?.lat && settings?.lon && (
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.5, marginBottom: 12 }}>
                LIVE RADAR
              </div>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 320,
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--md-outline-variant)',
                }}
              >
                <RadarMap lat={settings.lat} lon={settings.lon} radarTs={radarTs} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RadarMap({ lat, lon, radarTs }) {
  const mapRef        = useRef(null)
  const instanceRef   = useRef(null)
  const radarLayerRef = useRef(null)

  // Initialize map once per (lat, lon) — base tile layer + framing
  useEffect(() => {
    if (!mapRef.current || lat == null || lon == null) return
    let disposed = false
    import('leaflet').then(L => {
      if (disposed || instanceRef.current) return
      const map = L.map(mapRef.current, {
        center: [lat, lon],
        zoom: 8,
        zoomControl: false,
        attributionControl: false,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map)
      instanceRef.current = map
    })
    return () => {
      disposed = true
      if (instanceRef.current) {
        instanceRef.current.remove()
        instanceRef.current = null
        radarLayerRef.current = null
      }
    }
  }, [lat, lon])

  // Swap the radar overlay when the latest RainViewer frame changes
  useEffect(() => {
    if (!instanceRef.current || !radarTs) return
    let disposed = false
    import('leaflet').then(L => {
      if (disposed || !instanceRef.current) return
      if (radarLayerRef.current) instanceRef.current.removeLayer(radarLayerRef.current)
      radarLayerRef.current = L.tileLayer(
        `https://tilecache.rainviewer.com${radarTs}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0.6 },
      )
      radarLayerRef.current.addTo(instanceRef.current)
    })
    return () => { disposed = true }
  }, [radarTs])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}

function WeatherSkeleton() {
  const bar = (w, h = 10) => (
    <div style={{ height: h, width: w, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bar('80px', 40)}{bar('120px', 10)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0,1,2,3,4,5].map(i => (
          <div key={i} style={{ width: 52, height: 80, borderRadius: 8, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
        ))}
      </div>
    </div>
  )
}
