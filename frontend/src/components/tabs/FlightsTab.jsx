// Backend: GET /api/feeds/flights → { aircraft: [...], cached, timestamp, lat, lon }
// Normalized fields: icao24, callsign, origin_country, longitude, latitude,
//   altitude_ft (int|null), on_ground (bool), velocity_kts (float|null), heading_deg (float|null)
// Settings: PATCH /api/settings/page { flights: { radar_radius_deg, filter, refresh_interval_sec } }

import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { InlineSettingsSection, SettingsRow, ToggleGroup } from '../TabSettingsPanel.jsx'

function trackArrow(deg) {
  if (deg == null) return '·'
  return ['↑','↗','→','↘','↓','↙','←','↖'][Math.round(deg / 45) % 8]
}

async function searchPlaces(q) {
  if (!q || q.length < 2) return []
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
      { headers: { 'User-Agent': 'RiverSongAI/1.0' } }
    )
    return res.ok ? await res.json() : []
  } catch { return [] }
}

function LocationSearch({ onSelect }) {
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
      setResults(r); setSrch(false)
    }, 400)
    return () => clearTimeout(debounce.current)
  }, [q])

  return (
    <div className="rs-relative">
      <input
        className="rs-input rs-w-full rs-type-tiny"
        placeholder="Search city to set radar origin…"
        value={q}
        onChange={e => setQ(e.target.value)}
        style={{ boxSizing: 'border-box' }}
        autoFocus
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
              setQ(''); setResults([])
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

function FlightMap({ lat, lon, radiusDeg, aircraft }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const markersRef  = useRef([])
  const circleRef   = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!mapRef.current || lat == null || lon == null) return
    import('leaflet').then(L => {
      if (instanceRef.current) return
      const map = L.map(mapRef.current, {
        center: [lat, lon], zoom: 8,
        zoomControl: false, attributionControl: false,
      })
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map)
      instanceRef.current = map
      setMapReady(true)
    })
    return () => {
      if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; setMapReady(false) }
    }
  }, [lat, lon])

  useEffect(() => {
    if (!mapReady || !instanceRef.current || lat == null || lon == null) return
    import('leaflet').then(L => {
      const map = instanceRef.current
      if (!map) return

      if (circleRef.current) circleRef.current.remove()
      circleRef.current = L.circle([lat, lon], {
        radius: radiusDeg * 111000,
        color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.05,
        weight: 1, opacity: 0.35,
      }).addTo(map)

      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      aircraft.forEach(a => {
        if (a.latitude == null || a.longitude == null) return
        const hdg  = a.heading_deg ?? 0
        const clr  = a.on_ground ? '#888' : '#60a5fa'
        const icon = L.divIcon({
          className: '',
          html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" `
              + `style="transform:rotate(${hdg}deg)">`
              + `<path fill="${clr}" d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 `
              + `10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>`,
          iconSize: [18, 18], iconAnchor: [9, 9],
        })
        const popup = [
          `<b>${a.callsign || a.icao24}</b>`,
          a.origin_country || null,
          a.altitude_ft   != null ? `${a.altitude_ft.toLocaleString()} ft`  : null,
          a.velocity_kts  != null ? `${a.velocity_kts} kts`                 : null,
          a.heading_deg   != null ? `${Math.round(a.heading_deg)}°`    : null,
          a.on_ground ? 'On ground' : 'Airborne',
        ].filter(Boolean).join('<br>')
        markersRef.current.push(
          L.marker([a.latitude, a.longitude], { icon }).bindPopup(popup).addTo(map)
        )
      })
    })
  }, [aircraft, radiusDeg, lat, lon, mapReady])

  return (
    <div ref={mapRef} className="rs-w-full rs-h-full rs-clip" style={{ borderRadius: 8 }} />
  )
}

function AircraftRow({ a, i, total }) {
  const statusColor = a.on_ground ? 'var(--md-on-surface-variant)' : 'oklch(71% 0.17 145)'
  return (
    <div className="rs-flights-row" style={{
      padding: '8px 12px',
      borderBottom: i < total - 1 ? '1px solid var(--md-outline-variant)' : 'none',
    }}>
      <div>
        <div className="rs-type-micro rs-nowrap rs-clip rs-ellipsis" style={{ fontWeight: 800, letterSpacing: '0.05em' }}>
          {a.callsign || '—'}
        </div>
        <div className="rs-card-meta rs-muted rs-type-nano" style={{ marginTop: 1 }}>
          {a.icao24}
        </div>
      </div>
      <div className="rs-card-meta rs-flight-country rs-type-nano rs-clip rs-ellipsis rs-nowrap">
        {a.origin_country || '—'}
      </div>
      <div className="rs-mono rs-type-nano rs-nowrap" style={{ fontWeight: 700 }}>
        {a.altitude_ft != null ? `${a.altitude_ft.toLocaleString()} ft` : '—'}
      </div>
      <div className="rs-mono rs-type-nano rs-nowrap">
        {a.velocity_kts != null ? `${a.velocity_kts}` : '—'}
      </div>
      <div className="rs-flight-hdg rs-text-center rs-type-tiny">
        {trackArrow(a.heading_deg)}
      </div>
      <div className="rs-type-nano rs-text-right" style={{ fontWeight: 700, color: statusColor }}>
        {a.on_ground ? 'GND' : 'AIR'}
      </div>
    </div>
  )
}

export default function FlightsTab({ token, active }) {
  const [aircraft, setAircraft]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [wxSettings, setWxSet]    = useState(null)
  const [flSettings, setFlSet]    = useState(null)
  const [settingsOpen, setSOpen]  = useState(false)
  const [lastUpdated, setLastUpd] = useState(null)
  const [agoText, setAgoText]     = useState('')
  const intervalRef               = useRef(null)
  const agoTimerRef               = useRef(null)
  const authHeaders = { Authorization: `Bearer ${token}` }

  const flDef = { radar_radius_deg: 0.5, filter: 'all', refresh_interval_sec: 30 }

  useEffect(() => {
    clearInterval(agoTimerRef.current)
    if (!lastUpdated) return
    const tick = () => {
      const s = Math.floor((Date.now() - lastUpdated) / 1000)
      setAgoText(s < 5 ? 'just now' : `${s}s ago`)
    }
    tick()
    agoTimerRef.current = setInterval(tick, 1000)
    return () => clearInterval(agoTimerRef.current)
  }, [lastUpdated])

  const patchFlights = useCallback(async (patch) => {
    const next = { ...flDef, ...(flSettings || {}), ...patch }
    setFlSet(next)
    await fetch('/api/settings/page', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ flights: next }),
    }).catch(() => {})
    return next
  }, [flSettings, token])

  const patchWeather = useCallback(async (patch) => {
    const next = { ...(wxSettings || {}), ...patch }
    setWxSet(next)
    await fetch('/api/settings/page', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ weather: next }),
    }).catch(() => {})
    return next
  }, [wxSettings, token])

  const fetchFlights = useCallback(async (fl, wx) => {
    if (!active) return
    const cur = fl || flDef
    const lat = wx?.lat
    const lon = wx?.lon
    if (!lat || !lon) { setError('location'); setLoading(false); return }

    setError(null)
    const params = new URLSearchParams({ lat, lon, radius: cur.radar_radius_deg })
    if (cur.filter !== 'all') params.set('filter_status', cur.filter)
    try {
      const res = await fetch(`/api/feeds/flights?${params}`, { headers: authHeaders })
      if (res.status === 404) { setError('location'); return }
      if (!res.ok) throw new Error('Flights unavailable')
      const data = await res.json()
      setAircraft(data.aircraft || [])
      setLastUpd(Date.now())
    } catch (e) {
      if (!e.message?.includes('AbortError')) setError(e.message)
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
        const fl = { ...flDef, ...(page?.flights || {}) }
        setWxSet(wx)
        setFlSet(fl)
        fetchFlights(fl, wx)
      })
      .catch(() => { setWxSet({}); setFlSet(flDef); setError('location'); setLoading(false) })
  }, [token, active])

  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!active || !wxSettings?.lat || error === 'location') return
    const ms = ((flSettings?.refresh_interval_sec) || 30) * 1000
    intervalRef.current = setInterval(() => fetchFlights(flSettings, wxSettings), ms)
    return () => clearInterval(intervalRef.current)
  }, [active, flSettings, wxSettings, error, fetchFlights])

  const handleLocationSelect = async ({ lat, lon, location_query }) => {
    const nextWx = await patchWeather({ lat, lon, location_query })
    setError(null); setLoading(true)
    fetchFlights(flSettings, nextWx)
  }

  const handleRadiusChange = async (v) => {
    const next = await patchFlights({ radar_radius_deg: parseFloat(v) })
    fetchFlights(next, wxSettings)
  }

  const handleFilterChange = async (v) => {
    const next = await patchFlights({ filter: v })
    fetchFlights(next, wxSettings)
  }

  const handleRefreshChange = async (v) => {
    await patchFlights({ refresh_interval_sec: parseInt(v) })
  }

  const fl        = flSettings || flDef
  const radiusDeg = fl.radar_radius_deg || 0.5
  const radiusKm  = Math.round(radiusDeg * 111)
  const lat       = wxSettings?.lat
  const lon       = wxSettings?.lon

  const sortedAircraft = [...aircraft].sort(
    (a, b) => (b.altitude_ft ?? -1) - (a.altitude_ft ?? -1)
  )

  const noLocation = error === 'location'

  return (
    <div>
      <InlineSettingsSection
        title="RADAR SETTINGS"
        icon="tune"
        subtitle={wxSettings?.location_query?.split(',').slice(0, 2).join(',') || 'no origin set'}
        open={settingsOpen || noLocation}
        onOpenChange={setSOpen}
      >
        <SettingsRow label={`RADIUS — ${radiusDeg}° ≈ ${radiusKm} km`}>
          <input
            type="range" min={0.1} max={2.0} step={0.1}
            value={radiusDeg}
            onChange={e => handleRadiusChange(e.target.value)}
            className="rs-w-full" style={{ accentColor: 'var(--primary)' }}
          />
          <div className="rs-flex rs-justify-between">
            <span className="rs-card-meta rs-muted rs-type-nano">~11 km</span>
            <span className="rs-card-meta rs-muted rs-type-nano">~222 km</span>
          </div>
        </SettingsRow>
        <SettingsRow label="FILTER">
          <ToggleGroup
            options={[
              { value: 'all',      label: 'All'      },
              { value: 'airborne', label: 'Airborne' },
              { value: 'ground',   label: 'Ground'   },
            ]}
            value={fl.filter || 'all'}
            onChange={handleFilterChange}
          />
        </SettingsRow>
        <SettingsRow label="AUTO-REFRESH">
          <ToggleGroup
            options={[
              { value: '10', label: '10s' },
              { value: '30', label: '30s' },
              { value: '60', label: '60s' },
            ]}
            value={String(fl.refresh_interval_sec || 30)}
            onChange={handleRefreshChange}
          />
        </SettingsRow>
        <SettingsRow label="RADAR ORIGIN">
          <LocationSearch onSelect={handleLocationSelect} />
          {wxSettings?.location_query && (
            <div className="rs-card-meta rs-mt-2 rs-muted rs-type-nano">
              {wxSettings.location_query.split(',').slice(0, 2).join(',')}
            </div>
          )}
        </SettingsRow>
      </InlineSettingsSection>

      {/* Status row */}
      <div className="rs-flex rs-items-center rs-justify-between rs-mb-4">
        <div className="rs-flex rs-items-center rs-gap-3">
          <span className="rs-card-meta rs-type-micro" style={{ fontWeight: 700 }}>
            OVERHEAD RADAR
          </span>
          {!loading && !error && (
            <span className="rs-card-label rs-muted rs-type-nano">
              {aircraft.length} aircraft · {radiusDeg}° ≈ {radiusKm} km
            </span>
          )}
        </div>
        <button
          className="rs-pill"
          onClick={() => { setLoading(true); fetchFlights(flSettings, wxSettings) }}
          style={{ padding: '5px 10px' }}
          title="Refresh"
        >
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>refresh</span>
        </button>
      </div>

      {/* No-location state */}
      {error === 'location' && (
        <div style={{ padding: '16px 0' }}>
          <div className="rs-text-center rs-mb-5">
            <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block' }}>
              flight
            </span>
            <div className="rs-card-label rs-mb-2">NO RADAR ORIGIN SET</div>
            <div className="rs-card-meta rs-mb-4">
              Set your location in Weather settings, or search here — coordinates are shared.
            </div>
          </div>
          <LocationSearch onSelect={handleLocationSelect} />
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div className="rs-text-center" style={{ padding: '24px 0' }}>
          <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block' }}>
            flight_off
          </span>
          <div className="rs-card-meta rs-mb-3">{error}</div>
          <button className="rs-pill" onClick={() => fetchFlights(flSettings, wxSettings)}>RETRY</button>
        </div>
      )}

      {/* Map + list split */}
      {!error && (
        <div className="rs-flex rs-gap-4" style={{ height: 380 }}>

          {/* Map — 60% */}
          <div className="rs-relative rs-min-w-0" style={{ flex: '3 1 0' }}>
            {loading && (
              <div className="rs-flex rs-items-center rs-justify-center" style={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                borderRadius: 8,
                background: 'var(--md-surface-container)',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2 }}>flight</span>
              </div>
            )}
            {lat && lon ? (
              <FlightMap lat={lat} lon={lon} radiusDeg={radiusDeg} aircraft={loading ? [] : sortedAircraft} />
            ) : (
              <div className="rs-w-full rs-flex rs-items-center rs-justify-center rs-h-full" style={{
                borderRadius: 8,
                background: 'var(--md-surface-container)',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.15 }}>map</span>
              </div>
            )}
          </div>

          {/* Aircraft list — 40% */}
          <div className="rs-flex rs-flex-col rs-min-w-0 rs-clip" style={{
            flex: '2 1 0',
            border: '1px solid var(--md-outline-variant)',
            borderRadius: 8,
          }}>
            {/* Column headers */}
            <div className="rs-flights-row rs-no-shrink" style={{
              padding: '7px 12px',
              borderBottom: '1px solid var(--md-outline-variant)',
              background: 'var(--md-surface-container)',
            }}>
              {['CALLSIGN', 'COUNTRY', 'ALT', 'KTS', 'HDG', 'STATUS'].map(h => (
                <div key={h} className={'rs-card-label' + (h === 'COUNTRY' ? ' rs-flight-country' : h === 'HDG' ? ' rs-flight-hdg' : '')} style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)',
                  textAlign: h === 'STATUS' ? 'right' : 'left',
                }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            <div className="rs-grow" style={{ overflowY: 'auto' }}>
              {loading && (
                <div>
                  {[0,1,2,3,4,5].map(i => (
                    <div key={i} className="rs-flights-row" style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--md-outline-variant)',
                    }}>
                      <div style={{ height: 9, width: '80%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
                      <div style={{ height: 8, width: '70%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
                      <div style={{ height: 8, width: '75%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
                      <div style={{ height: 8, width: '60%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
                      <div style={{ height: 8, width: '80%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
                      <div style={{ height: 8, width: '70%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3, marginLeft: 'auto' }} />
                    </div>
                  ))}
                </div>
              )}
              {!loading && sortedAircraft.length === 0 && (
                <div className="rs-text-center" style={{ padding: '32px 16px' }}>
                  <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '2rem', opacity: 0.2, display: 'block' }}>
                    flight_land
                  </span>
                  <div className="rs-card-label rs-mb-1 rs-type-nano">CLEAR SKIES</div>
                  <div className="rs-card-meta rs-type-nano">
                    No aircraft in {radiusKm} km radius.
                  </div>
                </div>
              )}
              {!loading && sortedAircraft.map((a, i) => (
                <AircraftRow key={a.icao24 + i} a={a} i={i} total={sortedAircraft.length} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer: last updated */}
      {!error && !loading && agoText && (
        <div className="rs-mt-2 rs-text-right">
          <span className="rs-card-meta rs-muted rs-type-nano">
            Updated {agoText}
          </span>
        </div>
      )}
    </div>
  )
}
