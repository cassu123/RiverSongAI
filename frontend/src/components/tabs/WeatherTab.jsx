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
    <div className="rs-relative">
      <input
        className="rs-input rs-w-full rs-type-tiny"
        placeholder="Search city or place…"
        value={q}
        onChange={e => setQ(e.target.value)}
        style={{ boxSizing: 'border-box' }}
        autoFocus={autoFocus}
      />
      {(results.length > 0 || searching) && (
        <div className="rs-mt-1 rs-clip" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 200,
          background: 'var(--md-surface-container-high)',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 8,
        }}>
          {searching && (
            <div className="rs-card-meta rs-type-micro" style={{ padding: '8px 14px' }}>Searching…</div>
          )}
          {results.map((r, i) => (
            <button key={i} onClick={() => {
              onSelect({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), location_query: r.display_name })
              setQ('')
              setResults([])
            }} className="rs-w-full rs-text-left rs-pointer rs-type-micro" style={{
              display: 'block',
              padding: '9px 14px',
              background: 'none',
              border: 'none',
              borderTop: i > 0 ? '1px solid var(--md-outline-variant)' : 'none',
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
    <div className="rs-wx">
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
            <div className="rs-card-meta rs-mt-2 rs-muted rs-type-nano">
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
        <div className="rs-text-center" style={{ padding: '40px 0' }}>
          <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '3rem', opacity: 0.2, display: 'block' }}>location_off</span>
          <div className="rs-card-label rs-mb-2">NO LOCATION SET</div>
          <div className="rs-card-meta rs-mb-5">Search for your city to get started.</div>
          <div style={{ maxWidth: 380, margin: '0 auto' }}>
            <LocationSearch onSelect={handleLocationSelect} />
          </div>
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div className="rs-text-center" style={{ padding: '24px 0' }}>
          <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block' }}>cloud_off</span>
          <div className="rs-card-meta rs-mb-3">{error}</div>
          <button className="rs-pill" onClick={fetchWeather}>RETRY</button>
        </div>
      )}

      {loading && !noLocation && !error && <WeatherSkeleton />}

      {!loading && !error && weather && (
        <>
          {/* Severe alerts */}
          {alertsEnabled && alerts.length > 0 && (
            <div className="rs-flex rs-flex-col rs-gap-2">
              {alerts.slice(0, 2).map(a => (
                <div key={a.id} className="rs-flex rs-gap-3 rs-items-start" style={{
                  background: (ALERT_COLORS[a.severity] || '#88888822') + '22',
                  border: `1px solid ${ALERT_COLORS[a.severity] || '#88888888'}55`,
                  borderRadius: 8,
                  padding: '12px 16px',
                }}>
                  <span className="material-symbols-rounded rs-no-shrink" style={{ color: ALERT_COLORS[a.severity], marginTop: 2 }}>warning</span>
                  <div>
                    <div className="rs-type-micro" style={{ fontWeight: 700, marginBottom: 2, color: ALERT_COLORS[a.severity] }}>{a.event}</div>
                    <div className="rs-card-meta rs-type-micro">{a.headline}</div>
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
    <div className="rs-wx-panel is-hero">
      <div className="rs-flex rs-items-center rs-gap-5 rs-flex-wrap">
        <span
          className="material-symbols-rounded rs-no-shrink"
          style={{
            fontSize: 'clamp(3.25rem, 15vw, 6.5rem)',
            color: 'var(--primary)',
            lineHeight: 0.9,
            filter: 'drop-shadow(0 4px 14px rgba(var(--primary-rgb,100,100,255),0.18))',
          }}
        >
          {wmoIcon(current.weathercode)}
        </span>
        <div className="rs-grow rs-min-w-0">
          <div className="rs-nowrap" style={{
            fontSize: 'clamp(3rem, 15vw, 5.5rem)',
            fontWeight: 200,
            lineHeight: 1,
            letterSpacing: '-0.06em',
            color: 'var(--md-on-surface)',
          }}>
            {temp != null ? temp : '--'}{unit || '°'}
          </div>
          <div className="rs-mt-2 rs-type-body" style={{ fontWeight: 700, color: 'var(--md-on-surface)' }}>
            {current.condition || '—'}
          </div>
          <div className="rs-card-meta rs-mt-1 rs-type-micro">
            {location_name || ''}
          </div>
          <div className="rs-flex rs-gap-4 rs-mt-3 rs-items-center rs-type-micro">
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
    <div className="rs-wx-panel is-detail">
      <div className="rs-flex rs-justify-between rs-items-start">
        <div className="rs-card-label rs-mb-1 rs-muted rs-type-nano">{label}</div>
        {badge && (
          <div className="rs-muted rs-type-nano rs-nowrap" style={{ padding: '2px 4px', background: 'var(--md-surface-container-highest)', borderRadius: 4 }}>
            {badge}
          </div>
        )}
      </div>
      <div className="rs-mono rs-type-body rs-nowrap" style={{
        fontWeight: 800,
        color: color || 'var(--md-on-surface)',
      }}>
        {value}
      </div>
      {sub && (
        <div className="rs-card-meta rs-muted rs-type-nano" style={{ marginTop: 2 }}>{sub}</div>
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
    <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))' }}>
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
    <div className="rs-wx-panel">
      <div className="rs-card-label rs-mb-3 rs-muted rs-type-nano">NEXT 24 HOURS</div>
      <div style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4 }}>
        <div className="rs-relative" style={{ width: W }}>
          {/* Curve overlay */}
          <svg
            width={W} height={H_CURVE}
            className="rs-mb-2" style={{ display: 'block' }}
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
          <div className="rs-flex rs-items-start">
            {hourly.map((h, i) => (
              <div key={i} className="rs-text-center" style={{ width: W_PER_HOUR }}>
                <div className="rs-mono rs-type-micro" style={{
                  fontWeight: 700,
                  color: 'var(--md-on-surface)',
                }}>
                  {h.temperature != null ? Math.round(h.temperature) : '--'}°
                </div>
              </div>
            ))}
          </div>

          {/* Icon row */}
          <div className="rs-flex rs-mt-2">
            {hourly.map((h, i) => (
              <div key={i} className="rs-text-center" style={{ width: W_PER_HOUR }}>
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
          <div className="rs-flex rs-mt-1" style={{ height: 18, alignItems: 'flex-end' }}>
            {hourly.map((h, i) => {
              const p = h.precip_prob || 0
              const barH = Math.max(0, (p / 100) * 14)
              return (
                <div key={i} className="rs-flex rs-flex-col rs-items-center" style={{ width: W_PER_HOUR, justifyContent: 'flex-end' }}>
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
          <div className="rs-flex" style={{ marginTop: 2 }}>
            {hourly.map((h, i) => (
              <div key={i} className="rs-text-center" style={{ width: W_PER_HOUR }}>
                <span className="rs-type-nano" style={{
                  fontWeight: 600,
                  color: h.precip_prob > 0 ? PRECIP_COLOR : 'transparent',
                }}>
                  {h.precip_prob > 0 ? `${h.precip_prob}%` : '·'}
                </span>
              </div>
            ))}
          </div>

          {/* Time labels */}
          <div className="rs-flex rs-mt-1">
            {hourly.map((h, i) => (
              <div key={i} className="rs-text-center" style={{ width: W_PER_HOUR }}>
                <span className="rs-card-label rs-type-nano" style={{ opacity: i === 0 ? 0.9 : 0.45 }}>
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
    <div className="rs-wx-panel">
      <div className="rs-card-label rs-mb-3 rs-muted rs-type-nano">7-DAY FORECAST</div>
      <div className="rs-flex rs-flex-col">
        {daily.map((d, i) => {
          const minPct = d.temp_min != null ? ((d.temp_min - weekMin) / weekRange) * 100 : 0
          const maxPct = d.temp_max != null ? ((d.temp_max - weekMin) / weekRange) * 100 : 0
          const widthPct = Math.max(2, maxPct - minPct)
          const isLast = i === daily.length - 1
          return (
            <div key={d.date} className="rs-weather-row" style={{
              padding: '12px 0',
              borderBottom: isLast ? 'none' : '1px solid var(--md-outline-variant)',
            }}>
              {/* Day labels are short and must never split — "TODAY" was
                  breaking to "TODA / Y" once the column tightened. */}
              <span className="rs-type-micro rs-nowrap" style={{ fontWeight: 800 }}>
                {i === 0 ? 'TODAY' : fmtDay(d.date)}
              </span>
              <span className="material-symbols-rounded rs-text-center" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>
                {wmoIcon(d.weathercode)}
              </span>
              <span className="rs-card-meta rs-type-micro rs-clip rs-ellipsis rs-nowrap">
                {d.condition || '—'}
              </span>
              {/* Range bar */}
              <div className="rs-weather-bar rs-relative" style={{ height: 6, background: 'var(--md-surface-container-high)', borderRadius: 3 }}>
                <div style={{
                  position: 'absolute',
                  left: `${minPct}%`,
                  width: `${widthPct}%`,
                  top: 0, bottom: 0,
                  background: 'linear-gradient(90deg, oklch(70% 0.12 240), oklch(75% 0.15 60))',
                  borderRadius: 3,
                }} />
              </div>
              <span className="rs-mono rs-type-micro rs-text-right" style={{ fontWeight: 700 }}>
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
    <div className="rs-wx-panel">
      <div className="rs-card-label rs-mb-3 rs-muted rs-type-nano">SUN</div>
      <div className="rs-flex rs-items-center rs-flex-wrap" style={{ justifyContent: 'space-around' }}>
        <div className="rs-text-center" style={{ minWidth: 60 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.4rem', color: 'oklch(78% 0.16 75)' }}>wb_twilight</span>
          <div className="rs-card-label rs-mt-1 rs-muted rs-type-nano">SUNRISE</div>
          <div className="rs-mono rs-type-tiny" style={{ fontWeight: 700 }}>
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
        <div className="rs-text-center" style={{ minWidth: 60 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.4rem', color: 'oklch(60% 0.18 30)' }}>bedtime</span>
          <div className="rs-card-label rs-mt-1 rs-muted rs-type-nano">SUNSET</div>
          <div className="rs-mono rs-type-tiny" style={{ fontWeight: 700 }}>
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
    <div className="rs-wx-panel is-flush">
      <div className="rs-wx-panel-head">
        <span className="rs-wx-label">Live radar</span>
        <span className="rs-wx-attrib">RainViewer &middot; CARTO &middot; OpenStreetMap</span>
      </div>
      <div className="rs-wx-radar">
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
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        // CARTO dark_all is the darkest tileset they publish; over an already
        // dark panel the map read as a black rectangle. Lifted in CSS
        // (.rs-wx-basemap) rather than swapped for a lighter tileset, so the
        // radar echo keeps its contrast against the land.
        className: 'rs-wx-basemap',
      }).addTo(map)
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
        { opacity: 0.8, className: 'rs-wx-echo' },
      )
      radarLayerRef.current.addTo(instanceRef.current)
    })
    return () => { disposed = true }
  }, [radarTs])

  return <div ref={mapRef} className="rs-wx-map" />
}

// ──────────────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────────────

function WeatherSkeleton() {
  const bar = (w, h = 10) => (
    <div style={{ height: h, width: w, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
  )
  return (
    <div className="rs-flex rs-flex-col rs-gap-5">
      <div className="rs-flex rs-gap-4 rs-items-center">
        <div style={{ width: 80, height: 80, borderRadius: 16, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
        <div className="rs-flex rs-flex-col rs-gap-3">
          {bar('120px', 50)}{bar('160px', 12)}{bar('100px', 10)}
        </div>
      </div>
      <div className="rs-flex rs-gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rs-grow" style={{ height: 60, borderRadius: 12, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
        ))}
      </div>
      <div className="rs-flex rs-gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} style={{ width: 52, height: 110, borderRadius: 8, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
        ))}
      </div>
    </div>
  )
}
