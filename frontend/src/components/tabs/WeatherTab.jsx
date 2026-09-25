// WeatherTab — the Weather tab of Feeds.
//
// Backend: GET /api/feeds/weather (Open-Meteo + NWS text), /api/feeds/weather/alerts (NWS).
// Settings: PATCH /api/settings/page { weather: { lat, lon, location_query, units, wind_unit, alerts_enabled } }
// units: 'metric' | 'imperial'   wind_unit: 'kmh' | 'mph'
//
// Layout, for a phone and for a wall panel (two columns from 1024px):
//   Settings (collapsed)
//   Alerts — tap for the full text and what to do
//   Now — temperature, sky (day/night), feels-like, high/low, when rain comes
//   Next two hours of rain, only when some is coming
//   Hourly, 48 hours
//   10 days, with range bars and rain chance
//   The National Weather Service's forecast in words (US)
//   Details — wind, humidity, UV, air, pressure, visibility, sun
//   Radar loop

import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import RadarMap from '../weather/RadarMap.jsx'
import {
  wxIcon, compass, round, pressure, visibility, uvLabel, rangeBar,
  hourLabel, clockLabel, dayLabel, daylightProgress,
} from '../weather/wx.js'
import { InlineSettingsSection, SettingsRow, ToggleGroup, Toggle } from '../TabSettingsPanel.jsx'

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
          borderRadius: 'var(--md-shape-sm)',
        }}>
          {searching && (
            <div className="rs-card-meta rs-type-micro" style={{ padding: 'var(--rs-space-2) var(--rs-space-4)' }}>Searching…</div>
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
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-7) 0' }}>
          <span className="material-symbols-rounded rs-mb-3 rs-empty-glyph" style={{ fontSize: '3rem' }}>location_off</span>
          <div className="rs-card-label rs-mb-2">NO LOCATION SET</div>
          <div className="rs-card-meta rs-mb-5">Search for your city to get started.</div>
          <div style={{ maxWidth: 380, margin: '0 auto' }}>
            <LocationSearch onSelect={handleLocationSelect} />
          </div>
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
          <span className="material-symbols-rounded rs-mb-3 rs-empty-glyph" style={{ fontSize: '2.5rem' }}>cloud_off</span>
          <div className="rs-card-meta rs-mb-3">{error}</div>
          <button className="rs-pill" onClick={fetchWeather}>RETRY</button>
        </div>
      )}

      {loading && !noLocation && !error && <WeatherSkeleton />}

      {!loading && !error && weather && (
        <>
          <div className="rs-wx-body">
            <div className="rs-wx-col">
              {alertsEnabled && alerts.length > 0 && <AlertList alerts={alerts} />}
              <NowCard current={current} today={today} location_name={location_name} outlook={weather.outlook} />
              <NextHours minutely={weather.minutely} />
              <HourlyStrip hourly={hourly} />
              <DailyForecast daily={daily} current={current} />
            </div>
            <div className="rs-wx-col">
              <ForecastText periods={weather.forecast_text} />
              <DetailsGrid current={current} today={today} aqi={air_quality} unit={unit}
                now={weather.minutely?.[0]?.time || hourly[0]?.time} />
              {settings?.lat && settings?.lon && (
                <RadarCard lat={settings.lat} lon={settings.lon} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Alerts — the NWS's own words, one tap away
// ──────────────────────────────────────────────────────────────────────────────

function until(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function AlertList({ alerts }) {
  return (
    <div className="rs-wx-alerts">
      {alerts.map(a => (
        <details key={a.id} className="rs-wx-alert" style={{ '--sev': ALERT_COLORS[a.severity] || 'oklch(65% 0.02 250)' }}>
          <summary>
            <span className="material-symbols-rounded" aria-hidden="true">warning</span>
            <span className="rs-wx-alert-title">{a.event}</span>
            {a.expires && <span className="rs-wx-alert-until">until {until(a.expires)}</span>}
            <span className="material-symbols-rounded rs-wx-alert-more" aria-hidden="true">expand_more</span>
          </summary>
          {a.description && <p>{a.description}</p>}
          {a.instruction && <p><strong>What to do:</strong> {a.instruction}</p>}
          {a.sender && <p className="rs-wx-alert-from">{a.sender}</p>}
        </details>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Now — the glance
// ──────────────────────────────────────────────────────────────────────────────

function outlookIcon(text) {
  if (/^No rain/.test(text)) return 'check_circle'
  if (/snow/i.test(text)) return 'ac_unit'
  if (/storm/i.test(text)) return 'thunderstorm'
  return 'umbrella'
}

function NowCard({ current, today, location_name, outlook }) {
  const temp = round(current.temperature)
  const feels = round(current.feels_like)
  const hi = round(today?.temp_max)
  const lo = round(today?.temp_min)
  const letter = (current.unit || '').replace('°', '')
  return (
    <section className="rs-wx-panel rs-wx-now">
      <div className="rs-wx-now-main">
        <span className="material-symbols-rounded rs-wx-now-icon" aria-hidden="true">
          {wxIcon(current.weathercode, current.is_day)}
        </span>
        <div className="rs-wx-now-read">
          <div className="rs-wx-temp">
            {temp ?? '--'}<span className="rs-wx-temp-deg">°{letter}</span>
          </div>
          <div className="rs-wx-cond">{current.condition || '—'}</div>
          {location_name && <div className="rs-wx-place">{location_name}</div>}
        </div>
      </div>
      <div className="rs-wx-now-meta">
        {feels != null && <span>Feels {feels}°</span>}
        {hi != null && <span>H {hi}°</span>}
        {lo != null && <span>L {lo}°</span>}
      </div>
      {outlook && (
        <div className="rs-wx-outlook">
          <span className="material-symbols-rounded" aria-hidden="true">{outlookIcon(outlook)}</span>
          <span>{outlook}</span>
        </div>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Next two hours — only when rain is coming
// ──────────────────────────────────────────────────────────────────────────────

function NextHours({ minutely }) {
  if (!minutely?.some(m => (m.precipitation || 0) >= 0.1)) return null
  const peak = Math.max(1, ...minutely.map(m => m.precipitation || 0))
  const labels = ['Now', '', '30m', '', '1h', '', '1h30', '']
  return (
    <section className="rs-wx-panel">
      <div className="rs-wx-label">Next two hours</div>
      <div className="rs-wx-nexthours" role="img"
        aria-label={`Rain over the next two hours: ${minutely.map(m => (m.precipitation || 0).toFixed(1)).join(', ')} mm per quarter hour`}>
        {minutely.map((m, i) => (
          <div key={m.time} className="rs-wx-nexthours-col">
            <div className="rs-wx-nexthours-bar" style={{ blockSize: `${Math.max(((m.precipitation || 0) / peak) * 100, 3)}%` }} />
            <span>{labels[i]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Hourly — 48 hours, times on top, the temperature as a line
// ──────────────────────────────────────────────────────────────────────────────

const COL = 56

function HourlyStrip({ hourly }) {
  const temps = hourly.map(h => h.temperature).filter(t => t != null)
  if (!temps.length) return null
  const tmin = Math.min(...temps), tmax = Math.max(...temps)
  const H = 26
  const y = t => H - 4 - ((t - tmin) / ((tmax - tmin) || 1)) * (H - 8)
  const pts = hourly.map((h, i) => h.temperature == null ? null : `${i * COL + COL / 2},${y(h.temperature).toFixed(1)}`).filter(Boolean).join(' ')
  return (
    <section className="rs-wx-panel">
      <div className="rs-wx-label">Next 48 hours</div>
      <div className="rs-wx-hourly-scroll">
        <div className="rs-wx-hourly" style={{ inlineSize: hourly.length * COL }}>
          {hourly.map((h, i) => {
            const midnight = i > 0 && h.time.slice(11, 13) === '00'
            return (
              <div key={h.time} className={`rs-wx-hour${midnight ? ' is-new-day' : ''}`} style={{ inlineSize: COL }}>
                <span className="rs-wx-hour-time">
                  {i === 0 ? 'Now' : midnight ? dayLabel(h.time.slice(0, 10), 1) : hourLabel(h.time)}
                </span>
                <span className="material-symbols-rounded rs-wx-hour-icon" aria-hidden="true">{wxIcon(h.weathercode, h.is_day)}</span>
                <span className="rs-wx-hour-temp">{round(h.temperature) ?? '--'}°</span>
                <span className="rs-wx-hour-rain">{h.precip_prob >= 10 ? `${h.precip_prob}%` : ''}</span>
              </div>
            )
          })}
          <svg className="rs-wx-hourly-line" width={hourly.length * COL} height={H} aria-hidden="true">
            <polyline points={pts} />
          </svg>
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// 10 days — rain chance, low, a bar on the whole forecast's scale, high
// ──────────────────────────────────────────────────────────────────────────────

function DailyForecast({ daily, current }) {
  const days = daily.filter(d => d.temp_min != null && d.temp_max != null)
  if (!days.length) return null
  const min = Math.min(...days.map(d => d.temp_min))
  const max = Math.max(...days.map(d => d.temp_max))
  return (
    <section className="rs-wx-panel">
      <div className="rs-wx-label">{days.length}-day forecast</div>
      <ul className="rs-wx-days">
        {days.map((d, i) => {
          const bar = rangeBar(d.temp_min, d.temp_max, min, max)
          const nowAt = i === 0 && current.temperature != null
            ? Math.min(100, Math.max(0, ((current.temperature - min) / ((max - min) || 1)) * 100)) : null
          return (
            <li key={d.date} className="rs-wx-day">
              <span className="rs-wx-day-name">{dayLabel(d.date, i)}</span>
              <span className="material-symbols-rounded rs-wx-day-icon" title={d.condition} aria-label={d.condition}>{wxIcon(d.weathercode, true)}</span>
              <span className="rs-wx-day-rain">{d.precip_prob_max >= 20 ? `${d.precip_prob_max}%` : ''}</span>
              <span className="rs-wx-day-lo">{round(d.temp_min)}°</span>
              <span className="rs-wx-range" aria-hidden="true">
                <span className="rs-wx-range-fill" style={{ insetInlineStart: `${bar.left}%`, inlineSize: `${bar.width}%` }} />
                {nowAt != null && <span className="rs-wx-range-now" style={{ insetInlineStart: `${nowAt}%` }} />}
              </span>
              <span className="rs-wx-day-hi">{round(d.temp_max)}°</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// The National Weather Service's forecast, in words (US only)
// ──────────────────────────────────────────────────────────────────────────────

function ForecastText({ periods }) {
  if (!periods?.length) return null
  return (
    <section className="rs-wx-panel">
      <div className="rs-wx-panel-head">
        <span className="rs-wx-label">Forecast</span>
        <span className="rs-wx-source">National Weather Service</span>
      </div>
      <dl className="rs-wx-periods">
        {periods.map((p, i) => (
          <div key={`${i}-${p.name}`}>
            <dt>{p.name}</dt>
            <dd>{p.detailed || p.short}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Details
// ──────────────────────────────────────────────────────────────────────────────

function Tile({ label, value, unit, sub, color, children, wide }) {
  return (
    <div className={`rs-wx-tile${wide ? ' is-wide' : ''}`}>
      <div className="rs-wx-label">{label}</div>
      {value != null && (
        <div className="rs-wx-tile-value" style={color ? { color } : undefined}>
          {value}{unit && <span className="rs-wx-tile-unit">{unit}</span>}
        </div>
      )}
      {sub && <div className="rs-wx-tile-sub">{sub}</div>}
      {children}
    </div>
  )
}

function SunArc({ sunrise, sunset, now }) {
  const p = daylightProgress(sunrise, sunset, now)
  const W = 160, H = 70, R = 64, cx = W / 2, cy = H - 4
  const a = p == null ? null : Math.PI * (1 - p)
  return (
    <svg className="rs-wx-sun" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} className="rs-wx-sun-path" />
      <line x1={cx - R - 6} y1={cy} x2={cx + R + 6} y2={cy} className="rs-wx-sun-horizon" />
      {a != null && <circle cx={cx + R * Math.cos(a)} cy={cy - R * Math.sin(a)} r="6" className="rs-wx-sun-dot" />}
    </svg>
  )
}

function DetailsGrid({ current, today, aqi, unit, now }) {
  const imperial = unit === '°F'
  const dir = compass(current.wind_direction)
  const gusts = round(current.wind_gusts)
  const pres = pressure(current.pressure, imperial)
  const vis = visibility(current.visibility, imperial)
  return (
    <section className="rs-wx-details">
      <Tile label="Wind" value={round(current.wind_speed)} unit={` ${current.wind_unit || ''}`}
        sub={[dir && `from the ${dir}`, gusts != null && gusts > (current.wind_speed || 0) && `gusts ${gusts}`].filter(Boolean).join(' · ')} />
      <Tile label="Humidity" value={current.humidity} unit="%"
        sub={current.dew_point != null ? `Dew point ${round(current.dew_point)}°` : null} />
      <Tile label="UV index" value={current.uv_index != null ? round(current.uv_index) : null}
        sub={current.uv_index != null ? uvLabel(current.uv_index) : null} />
      {aqi?.aqi != null && (
        <Tile label="Air quality" value={aqi.aqi} color={aqi.color}
          sub={`${aqi.label} · ${aqi.source === 'purpleair' ? 'PurpleAir' : 'Open-Meteo'}`} />
      )}
      {pres && <Tile label="Pressure" value={pres.value} unit={` ${pres.unit}`} />}
      {vis && <Tile label="Visibility" value={vis.value} unit={` ${vis.unit}`} />}
      {today?.sunrise && today?.sunset && (
        <Tile label="Sun" wide>
          <div className="rs-wx-sun-row">
            <div><span className="rs-wx-tile-sub">Sunrise</span><strong>{clockLabel(today.sunrise)}</strong></div>
            <SunArc sunrise={today.sunrise} sunset={today.sunset} now={now} />
            <div><span className="rs-wx-tile-sub">Sunset</span><strong>{clockLabel(today.sunset)}</strong></div>
          </div>
        </Tile>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Radar
// ──────────────────────────────────────────────────────────────────────────────

function RadarCard({ lat, lon }) {
  return (
    <section className="rs-wx-panel">
      <div className="rs-wx-label">Radar</div>
      <RadarMap lat={lat} lon={lon} />
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Skeleton
// ──────────────────────────────────────────────────────────────────────────────

function WeatherSkeleton() {
  const bar = (w, h = 10) => (
    <div style={{ height: h, width: w, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
  )
  return (
    <div className="rs-flex rs-flex-col rs-gap-5">
      <div className="rs-flex rs-gap-4 rs-items-center">
        <div style={{ width: 80, height: 80, borderRadius: 'var(--md-shape-lg)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
        <div className="rs-flex rs-flex-col rs-gap-3">
          {bar('120px', 50)}{bar('160px', 12)}{bar('100px', 10)}
        </div>
      </div>
      <div className="rs-flex rs-gap-3">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rs-grow" style={{ height: 60, borderRadius: 'var(--md-shape-md)', background: 'var(--md-outline-variant)', opacity: 0.3 }} />
        ))}
      </div>
      <div className="rs-flex rs-gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} style={{ width: 52, height: 110, borderRadius: 'var(--md-shape-sm)', background: 'var(--md-outline-variant)', opacity: 0.25 }} />
        ))}
      </div>
    </div>
  )
}
