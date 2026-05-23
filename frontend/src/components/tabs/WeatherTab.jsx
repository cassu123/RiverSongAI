// Audit: GET /api/feeds/weather — Open-Meteo, no key required.
// Response: { current, hourly[24], daily[7], air_quality, location_name, unit }.
// Current: { temperature, feels_like, condition, weathercode, wind_speed,
//            humidity, uv_index, visibility, unit }.
// Hourly: { time, temperature, condition, weathercode, precip_prob, wind_speed }.
// Daily: { date, condition, weathercode, temp_max, temp_min, precipitation,
//           uv_index_max, sunrise, sunset }.
// Cache: 10-min at provider level; no client-side cache needed.
// Alerts: GET /api/feeds/weather/alerts → { alerts: [...] }.

import React, { useState, useEffect, useCallback } from 'react'

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
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', hour12: true })
}

function fmtDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
}

const ALERT_COLORS = {
  Extreme:  'oklch(50% 0.18 22)',
  Severe:   'oklch(58% 0.20 40)',
  Moderate: 'oklch(62% 0.18 75)',
  Minor:    'oklch(65% 0.15 95)',
}

export default function WeatherTab({ token, active }) {
  const [weather, setWeather]   = useState(null)
  const [alerts, setAlerts]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const fetch_ = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const [wRes, aRes] = await Promise.all([
        fetch('/api/feeds/weather', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/feeds/weather/alerts', { headers: { Authorization: `Bearer ${token}` } }),
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

  useEffect(() => { fetch_() }, [fetch_])

  if (loading) return <WeatherSkeleton />

  if (error === 'location') return (
    <div style={{ padding: '32px 0', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>location_off</span>
      <div className="rs-card-label" style={{ marginBottom: 8 }}>NO LOCATION SET</div>
      <div className="rs-card-meta">Go to Settings and add your location under the Feeds section.</div>
    </div>
  )

  if (error) return (
    <div style={{ padding: '32px 0', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>cloud_off</span>
      <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
      <button className="rs-pill" onClick={fetch_}>RETRY</button>
    </div>
  )

  if (!weather) return null

  const { current, hourly = [], daily = [], air_quality = {}, location_name, unit } = weather
  const C = current || {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.slice(0, 2).map(a => (
            <div
              key={a.id}
              style={{
                background: (ALERT_COLORS[a.severity] || 'oklch(50% 0.10 50)') + '22',
                border: `1px solid ${ALERT_COLORS[a.severity] || 'oklch(50% 0.10 50)'}55`,
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <span className="material-symbols-rounded" style={{ color: ALERT_COLORS[a.severity], flexShrink: 0, marginTop: 2 }}>warning</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: 2, color: ALERT_COLORS[a.severity] }}>
                  {a.event}
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>{a.headline}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Current conditions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            className="material-symbols-rounded"
            style={{ fontSize: '3.5rem', color: 'var(--primary)', lineHeight: 1 }}
          >
            {wmoIcon(C.weathercode)}
          </span>
          <div>
            <div style={{ fontSize: '3.5rem', fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em' }}>
              {C.temperature != null ? Math.round(C.temperature) : '--'}{unit}
            </div>
            <div className="rs-card-meta" style={{ fontSize: '0.85rem', marginTop: 2 }}>
              {C.condition}
              {location_name ? ` · ${location_name}` : ''}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {[
            { label: 'FEELS',    value: C.feels_like != null ? `${Math.round(C.feels_like)}${unit}` : '--' },
            { label: 'HUMIDITY', value: C.humidity != null ? `${C.humidity}%` : '--' },
            { label: 'WIND',     value: C.wind_speed != null ? `${Math.round(C.wind_speed)} km/h` : '--' },
            { label: 'UV',       value: C.uv_index != null ? C.uv_index.toFixed(1) : '--' },
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
          <div style={{
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            paddingBottom: 4,
          }}>
            {hourly.map((h, i) => (
              <div
                key={i}
                style={{
                  flexShrink: 0,
                  textAlign: 'center',
                  padding: '10px 10px',
                  borderRadius: 8,
                  background: i === 0 ? 'var(--md-surface-container-high)' : 'transparent',
                  minWidth: 52,
                }}
              >
                <div className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.5, marginBottom: 6 }}>
                  {fmtHour(h.time)}
                </div>
                <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--primary)', display: 'block', marginBottom: 6 }}>
                  {wmoIcon(h.weathercode)}
                </span>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem' }}>
                  {h.temperature != null ? Math.round(h.temperature) : '--'}°
                </div>
                {h.precip_prob != null && h.precip_prob > 0 && (
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
              <div
                key={d.date}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '10px 0',
                  borderBottom: i < daily.length - 1 ? '1px solid var(--md-outline-variant)' : 'none',
                }}
              >
                <span style={{ fontWeight: 800, fontSize: '0.78rem', width: 32 }}>
                  {i === 0 ? 'TODAY' : fmtDay(d.date)}
                </span>
                <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--primary)', width: 24, textAlign: 'center' }}>
                  {wmoIcon(d.weathercode)}
                </span>
                <span className="rs-card-meta" style={{ flex: 1, fontSize: '0.75rem' }}>{d.condition}</span>
                {d.precipitation != null && d.precipitation > 0 && (
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
    </div>
  )
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
          {bar('80px', 40)}
          {bar('120px', 10)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ width: 52, height: 80, borderRadius: 8, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
        ))}
      </div>
    </div>
  )
}
