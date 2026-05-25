// Backend: GET /api/feeds/weather — Open-Meteo, no key.
// Settings: PATCH /api/settings/page { weather: { lat, lon, location_query, units, wind_unit, alerts_enabled } }
// units: 'metric' | 'imperial'   wind_unit: 'kmh' | 'mph'
//
// Pixel-style layout:
//   Settings (collapsible inline)
//   Alerts banner (severe weather)
//   Hero card — big temp, big icon, location, "feels like · H/L"
//   Details row — wind, humidity, UV, AQI as compact cards
//   Hourly strip — temp curve + precip bars over time pills
//   Daily forecast — min/max range bars
//   Sun card — sunrise/sunset with arc
//   Live radar (Leaflet + RainViewer)

import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { InlineSettingsSection, SettingsRow, ToggleGroup, Toggle } from '../TabSettingsPanel.jsx'

// ── Weather → icon mapping ──────────────────────────────────────────────────
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
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')
}

function fmtDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
}

function fmtClockTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

const ALERT_COLORS = {
  Extreme: 'oklch(50% 0.18 22)', Severe: 'oklch(58% 0.20 40)',
  Moderate: 'oklch(62% 0.18 75)', Minor: 'oklch(65% 0.15 95)',
}
const PRECIP_COLOR = 'oklch(65% 0.15 240)'

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

function LocationSearch({ onSelect, autoFocus = true }) {
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
        autoFocus={autoFocus}
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

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export default function WeatherTab({ token, active }) {
  const [weather, setWeather]     = useState(null)
  const [alerts, setAlerts]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [settings, setSettings]   = useState(null)
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
        } else {
          fetchWeather()
        }
      })
      .catch(() => { setSettings({}); fetchWeather() })
  }, [token, active])

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
      .catch(() => {})
    return () => { cancelled = true }
  }, [active, settings?.lat, settings?.lon])

  const handleSettingChange = useCallback(async (patch) => {
    const next = await patchSettings(patch)
    if (next.lat && next.lon) fetchWeather()
  }, [patchSettings, fetchWeather])

  const handleLocationSelect = useCallback(async ({ lat, lon, location_query }) => {
    await handleSettingChange({ lat, lon, location_query })
    setError(null)
    setSOpen(false)
  }, [handleSettingChange])

  if (loading && !settings) return <WeatherSkeleton />

  const noLocation = error === 'location'
  const { current = {}, hourly = [], daily = [], air_quality = {}, location_name, unit } = weather || {}
  const alertsEnabled = settings?.alerts_enabled !== false
  const today = daily[0] || {}
  const tonight = today.sunset
  const tomorrow = today.sunrise
  const locationLabel = settings?.location_query?.split(',').slice(0, 2).join(',') || location_name || 'no location set'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InlineSettingsSection
        title="WEATHER SETTINGS"
        icon="tune"
        subtitle={locationLabel}
        open={settingsOpen || noLocation}
        onOpenChange={setSOpen}
      >
        <SettingsRow label="LOCATION">
          <LocationSearch onSelect={handleLocationSelect} />
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

      {/* No-location state */}
      {noLocation && (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>location_off</span>
          <div className="rs-card-label" style={{ marginBottom: 6 }}>NO LOCATION SET</div>
          <div className="rs-card-meta" style={{ marginBottom: 20 }}>Search for your city to get started.</div>
          <div style={{ maxWidth: 380, margin: '0 auto' }}>
            <LocationSearch onSelect={handleLocationSelect} />
          </div>
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

      {loading && !noLocation && !error && <WeatherSkeleton />}

      {!loading && !error && weather && (
        <>
          {/* Severe alerts */}
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

          <HeroCard current={current} today={today} location_name={location_name} unit={unit} />
          <DetailsRow current={current} aqi={air_quality} />
          <HourlyStrip hourly={hourly} unit={unit} />
          <DailyForecast daily={daily} unit={unit} />
          {today.sunrise && today.sunset && (
            <SunCard sunrise={today.sunrise} sunset={today.sunset} />
          )}
          {settings?.lat && settings?.lon && (
            <RadarCard lat={settings.lat} lon={settings.lon} radarTs={radarTs} />
          )}
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Hero card — Pixel-style massive temp glyph + condition icon + place line
// ──────────────────────────────────────────────────────────────────────────────

function HeroCard({ current, today, location_name, unit }) {
  const temp = current.temperature != null ? Math.round(current.temperature) : null
  const feels = current.feels_like != null ? Math.round(current.feels_like) : null
  const hi = today?.temp_max != null ? Math.round(today.temp_max) : null
  const lo = today?.temp_min != null ? Math.round(today.temp_min) : null
  return (
    <div
      className="rs-card"
      style={{
        padding: '28px 28px 24px',
        background: 'linear-gradient(160deg, var(--md-surface-container-high) 0%, var(--md-surface-container) 100%)',
        borderRadius: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: '6.5rem',
            color: 'var(--primary)',
            lineHeight: 0.9,
            filter: 'drop-shadow(0 4px 14px rgba(var(--primary-rgb,100,100,255),0.18))',
          }}
        >
          {wmoIcon(current.weathercode)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '5.5rem', fontWeight: 200, lineHeight: 1, letterSpacing: '-0.06em',
            color: 'var(--md-on-surface)',
          }}>
            {temp != null ? temp : '--'}{unit || '°'}
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: 6, color: 'var(--md-on-surface)' }}>
            {current.condition || '—'}
          </div>
          <div className="rs-card-meta" style={{ fontSize: '0.78rem', marginTop: 4 }}>
            {location_name || ''}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', fontSize: '0.78rem' }}>
            {feels != null && (
              <span className="rs-card-meta">Feels {feels}{unit || '°'}</span>
            )}
            {hi != null && lo != null && (
              <span className="rs-card-meta">H {hi}° · L {lo}°</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Details row — wind / humidity / UV / AQI
// ──────────────────────────────────────────────────────────────────────────────

function DetailCard({ label, value, sub, color, badge }) {
  return (
    <div className="rs-card" style={{ padding: '14px 16px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.5, marginBottom: 4 }}>{label}</div>
        {badge && (
          <div style={{ fontSize: '0.45rem', padding: '2px 4px', background: 'var(--md-surface-container-highest)', borderRadius: 4, opacity: 0.7, whiteSpace: 'nowrap' }}>
            {badge}
          </div>
        )}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.15rem', color: color || 'var(--md-on-surface)',
      }}>
        {value}
      </div>
      {sub && (
        <div className="rs-card-meta" style={{ fontSize: '0.62rem', opacity: 0.55, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  )
}

function DetailsRow({ current, aqi }) {
  const items = [
    {
      label: 'WIND',
      value: current.wind_speed != null ? `${Math.round(current.wind_speed)}` : '—',
      sub: current.wind_speed != null ? (current.wind_unit || 'km/h') : null,
    },
    {
      label: 'HUMIDITY',
      value: current.humidity != null ? `${current.humidity}%` : '—',
      sub: current.precipitation != null && current.precipitation > 0 ? `${current.precipitation.toFixed(1)} mm` : null,
    },
    {
      label: 'UV INDEX',
      value: current.uv_index != null ? current.uv_index.toFixed(1) : '—',
      sub: current.uv_index != null ? uvLabel(current.uv_index) : null,
    },
  ]
  if (aqi?.aqi != null) {
    items.push({
      label: 'AIR QUALITY',
      value: String(aqi.aqi),
      sub: aqi.label,
      color: aqi.color,
      badge: aqi.source === 'purpleair' ? 'via PurpleAir' : 'via Open-Meteo',
    })
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {items.map((it, i) => <DetailCard key={i} {...it} />)}
    </div>
  )
}

function uvLabel(uv) {
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Moderate'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very high'
  return 'Extreme'
}

// ──────────────────────────────────────────────────────────────────────────────
// Hourly strip — temperature curve over time pills with precipitation bars
// ──────────────────────────────────────────────────────────────────────────────

function HourlyStrip({ hourly, unit }) {
  if (!hourly?.length) return null
  const W_PER_HOUR = 52
  const W = hourly.length * W_PER_HOUR
  const H_CURVE = 36
  const temps = hourly.map(h => h.temperature).filter(t => t != null)
  if (!temps.length) return null
  const tmin = Math.min(...temps)
  const tmax = Math.max(...temps)
  const trange = (tmax - tmin) || 1
  const pts = hourly.map((h, i) => {
    if (h.temperature == null) return null
    const x = i * W_PER_HOUR + W_PER_HOUR / 2
    const y = H_CURVE - ((h.temperature - tmin) / trange) * (H_CURVE - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).filter(Boolean).join(' ')

  return (
    <div className="rs-card" style={{ padding: '16px 16px 14px' }}>
      <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.55, marginBottom: 12 }}>NEXT 24 HOURS</div>
      <div style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}>
        <div style={{ width: W, position: 'relative' }}>
          {/* Curve overlay */}
          <svg
            width={W} height={H_CURVE}
            style={{ display: 'block', marginBottom: 6 }}
          >
            <polyline
              points={pts}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.2}
              strokeLinejoin="round"
              opacity={0.85}
            />
            {hourly.map((h, i) => {
              if (h.temperature == null) return null
              const x = i * W_PER_HOUR + W_PER_HOUR / 2
              const y = H_CURVE - ((h.temperature - tmin) / trange) * (H_CURVE - 8) - 4
              return <circle key={i} cx={x} cy={y} r={2} fill="var(--primary)" />
            })}
          </svg>

          {/* Temp labels under curve */}
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {hourly.map((h, i) => (
              <div key={i} style={{ width: W_PER_HOUR, textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem',
                  color: 'var(--md-on-surface)',
                }}>
                  {h.temperature != null ? Math.round(h.temperature) : '--'}°
                </div>
              </div>
            ))}
          </div>

          {/* Icon row */}
          <div style={{ display: 'flex', marginTop: 6 }}>
            {hourly.map((h, i) => (
              <div key={i} style={{ width: W_PER_HOUR, textAlign: 'center' }}>
                <span
                  className="material-symbols-rounded"
                  style={{ fontSize: '1.05rem', color: 'var(--md-on-surface-variant)' }}
                >
                  {wmoIcon(h.weathercode)}
                </span>
              </div>
            ))}
          </div>

          {/* Precip bars */}
          <div style={{ display: 'flex', marginTop: 4, height: 18, alignItems: 'flex-end' }}>
            {hourly.map((h, i) => {
              const p = h.precip_prob || 0
              const barH = Math.max(0, (p / 100) * 14)
              return (
                <div key={i} style={{ width: W_PER_HOUR, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <div style={{
                    width: 14,
                    height: barH,
                    background: PRECIP_COLOR,
                    borderRadius: 3,
                    opacity: p > 0 ? 0.7 : 0,
                  }} />
                </div>
              )
            })}
          </div>

          {/* Precip labels */}
          <div style={{ display: 'flex', marginTop: 2 }}>
            {hourly.map((h, i) => (
              <div key={i} style={{ width: W_PER_HOUR, textAlign: 'center' }}>
                <span style={{
                  fontSize: '0.52rem', fontWeight: 600,
                  color: h.precip_prob > 0 ? PRECIP_COLOR : 'transparent',
                }}>
                  {h.precip_prob > 0 ? `${h.precip_prob}%` : '·'}
                </span>
              </div>
            ))}
          </div>

          {/* Time labels */}
          <div style={{ display: 'flex', marginTop: 4 }}>
            {hourly.map((h, i) => (
              <div key={i} style={{ width: W_PER_HOUR, textAlign: 'center' }}>
                <span className="rs-card-label" style={{ fontSize: '0.5rem', opacity: i === 0 ? 0.9 : 0.45 }}>
                  {i === 0 ? 'NOW' : fmtHour(h.time)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Daily forecast — min/max range bars
// ──────────────────────────────────────────────────────────────────────────────

function DailyForecast({ daily, unit }) {
  if (!daily?.length) return null
  // Range of all min/max across the week
  const allMins = daily.map(d => d.temp_min).filter(t => t != null)
  const allMaxs = daily.map(d => d.temp_max).filter(t => t != null)
  if (!allMins.length || !allMaxs.length) return null
  const weekMin = Math.min(...allMins)
  const weekMax = Math.max(...allMaxs)
  const weekRange = (weekMax - weekMin) || 1

  return (
    <div className="rs-card" style={{ padding: '16px' }}>
      <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.55, marginBottom: 12 }}>7-DAY FORECAST</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {daily.map((d, i) => {
          const minPct = d.temp_min != null ? ((d.temp_min - weekMin) / weekRange) * 100 : 0
          const maxPct = d.temp_max != null ? ((d.temp_max - weekMin) / weekRange) * 100 : 0
          const widthPct = Math.max(2, maxPct - minPct)
          const isLast = i === daily.length - 1
          return (
            <div key={d.date} style={{
              display: 'grid',
              gridTemplateColumns: '46px 28px 1fr 130px 70px',
              alignItems: 'center',
              gap: 12,
              padding: '12px 0',
              borderBottom: isLast ? 'none' : '1px solid var(--md-outline-variant)',
            }}>
              <span style={{ fontWeight: 800, fontSize: '0.78rem' }}>
                {i === 0 ? 'TODAY' : fmtDay(d.date)}
              </span>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem', color: 'var(--primary)', textAlign: 'center' }}>
                {wmoIcon(d.weathercode)}
              </span>
              <span className="rs-card-meta" style={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.condition || '—'}
              </span>
              {/* Range bar */}
              <div style={{ position: 'relative', height: 6, background: 'var(--md-surface-container-high)', borderRadius: 3 }}>
                <div style={{
                  position: 'absolute',
                  left: `${minPct}%`,
                  width: `${widthPct}%`,
                  top: 0, bottom: 0,
                  background: 'linear-gradient(90deg, oklch(70% 0.12 240), oklch(75% 0.15 60))',
                  borderRadius: 3,
                }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, textAlign: 'right' }}>
                <span style={{ opacity: 0.5 }}>{d.temp_min != null ? Math.round(d.temp_min) : '--'}°</span>
                <span style={{ margin: '0 4px', opacity: 0.3 }}>·</span>
                {d.temp_max != null ? Math.round(d.temp_max) : '--'}°
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Sun arc card
// ──────────────────────────────────────────────────────────────────────────────

function SunCard({ sunrise, sunset }) {
  const sunriseT = new Date(sunrise).getTime()
  const sunsetT  = new Date(sunset).getTime()
  const now      = Date.now()
  const dayLength = Math.max(1, sunsetT - sunriseT)
  // Sun position along the arc (0..1). Clamped — before sunrise: 0, after sunset: 1.
  const pos = Math.max(0, Math.min(1, (now - sunriseT) / dayLength))

  // Arc geometry — a semicircle from (0, 50) to (200, 50), radius 80
  const W = 240, H = 84
  const cx = W / 2, cy = 70
  const r = 90
  // For pos t in [0,1], angle is from PI (left, sunrise) to 0 (right, sunset).
  const angle = Math.PI - pos * Math.PI
  const sunX = cx + r * Math.cos(angle)
  const sunY = cy - r * Math.sin(angle)

  // Build the semicircular path
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`

  return (
    <div className="rs-card" style={{ padding: '16px' }}>
      <div className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.55, marginBottom: 12 }}>SUN</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.4rem', color: 'oklch(78% 0.16 75)' }}>wb_twilight</span>
          <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: 4 }}>SUNRISE</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.85rem' }}>
            {fmtClockTime(sunrise)}
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, maxWidth: '50%' }}>
          <path d={arcPath} stroke="var(--md-outline-variant)" strokeWidth={2} fill="none" strokeDasharray="3 4" />
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${sunX} ${sunY}`}
            stroke="oklch(78% 0.16 75)" strokeWidth={2.5} fill="none"
          />
          <circle cx={sunX} cy={sunY} r={6} fill="oklch(78% 0.16 75)" />
          <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="var(--md-outline-variant)" strokeWidth={1} opacity={0.5} />
        </svg>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.4rem', color: 'oklch(60% 0.18 30)' }}>bedtime</span>
          <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.5, marginTop: 4 }}>SUNSET</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.85rem' }}>
            {fmtClockTime(sunset)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Radar card
// ──────────────────────────────────────────────────────────────────────────────

function RadarCard({ lat, lon, radarTs }) {
  return (
    <div className="rs-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 16px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--md-outline-variant)',
      }}>
        <span className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.55 }}>LIVE RADAR</span>
        <span className="rs-card-meta" style={{ fontSize: '0.58rem', opacity: 0.45 }}>RainViewer</span>
      </div>
      <div style={{ height: 320, position: 'relative' }}>
        <RadarMap lat={lat} lon={lon} radarTs={radarTs} />
      </div>
    </div>
  )
}

function RadarMap({ lat, lon, radarTs }) {
  const mapRef        = useRef(null)
  const instanceRef   = useRef(null)
  const radarLayerRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || lat == null || lon == null) return
    let disposed = false
    import('leaflet').then(L => {
      if (disposed || instanceRef.current) return
      const map = L.map(mapRef.current, {
        center: [lat, lon], zoom: 8,
        zoomControl: false, attributionControl: false,
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

// ──────────────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────────────

function WeatherSkeleton() {
  const bar = (w, h = 10) => (
    <div style={{ height: h, width: w, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ width: 80, height: 80, borderRadius: 16, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bar('120px', 50)}{bar('160px', 12)}{bar('100px', 10)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ height: 60, flex: 1, borderRadius: 12, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} style={{ width: 52, height: 110, borderRadius: 8, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
        ))}
      </div>
    </div>
  )
}
