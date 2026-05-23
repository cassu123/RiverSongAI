// Backend: GET /api/feeds/flights → { aircraft: [...], cached, timestamp, lat, lon }
// Normalized fields: icao24, callsign, origin_country, longitude, latitude,
//   altitude_ft (int|null), on_ground (bool), velocity_kts (float|null), heading_deg (float|null)
// Settings: PATCH /api/settings/page { flights: { radar_radius_deg, filter, refresh_interval_sec } }

import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import TabSettingsPanel, { SettingsRow, ToggleGroup } from '../TabSettingsPanel.jsx'

const LIST_COLS = '1.7fr 1.4fr 1.6fr 0.9fr 0.55fr 1fr'

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
    <div style={{ position: 'relative' }}>
      <input
        className="rs-input"
        placeholder="Search city to set radar origin…"
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
              setQ(''); setResults([])
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
    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden' }} />
  )
}

function AircraftRow({ a, i, total }) {
  const statusColor = a.on_ground ? 'var(--md-on-surface-variant)' : 'oklch(71% 0.17 145)'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LIST_COLS,
      gap: 6, alignItems: 'center',
      padding: '8px 12px',
      borderBottom: i < total - 1 ? '1px solid var(--md-outline-variant)' : 'none',
    }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: '0.76rem', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {a.callsign || '—'}
        </div>
        <div className="rs-card-meta" style={{ fontSize: '0.55rem', marginTop: 1, opacity: 0.45 }}>
          {a.icao24}
        </div>
      </div>
      <div className="rs-card-meta" style={{ fontSize: '0.64rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.origin_country || '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {a.altitude_ft != null ? `${a.altitude_ft.toLocaleString()} ft` : '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
        {a.velocity_kts != null ? `${a.velocity_kts}` : '—'}
      </div>
      <div style={{ fontSize: '0.85rem', textAlign: 'center' }}>
        {trackArrow(a.heading_deg)}
      </div>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: statusColor, textAlign: 'right' }}>
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
  const panelRef                  = useRef(null)
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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="rs-card-meta" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
            OVERHEAD RADAR
          </span>
          {!loading && !error && (
            <span className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.45 }}>
              {aircraft.length} aircraft · {radiusDeg}° ≈ {radiusKm} km
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="rs-pill"
            onClick={() => { setLoading(true); fetchFlights(flSettings, wxSettings) }}
            style={{ padding: '5px 10px' }}
            title="Refresh"
          >
            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>refresh</span>
          </button>
          <div ref={panelRef} style={{ position: 'relative' }}>
            <button
              className={`rs-pill ${settingsOpen ? 'is-active' : ''}`}
              onClick={() => setSOpen(o => !o)}
              style={{ padding: '5px 10px' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>tune</span>
            </button>
            <TabSettingsPanel open={settingsOpen} onClose={() => setSOpen(false)} panelRef={panelRef} title="RADAR SETTINGS">
              <SettingsRow label={`RADIUS — ${radiusDeg}° ≈ ${radiusKm} km`}>
                <input
                  type="range" min={0.1} max={2.0} step={0.1}
                  value={radiusDeg}
                  onChange={e => handleRadiusChange(e.target.value)}
                  style={{ width: '100%', accentColor: 'var(--primary)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="rs-card-meta" style={{ fontSize: '0.58rem', opacity: 0.5 }}>~11 km</span>
                  <span className="rs-card-meta" style={{ fontSize: '0.58rem', opacity: 0.5 }}>~222 km</span>
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
                  <div className="rs-card-meta" style={{ fontSize: '0.62rem', marginTop: 6, opacity: 0.6 }}>
                    {wxSettings.location_query.split(',').slice(0, 2).join(',')}
                  </div>
                )}
              </SettingsRow>
            </TabSettingsPanel>
          </div>
        </div>
      </div>

      {/* No-location state */}
      {error === 'location' && (
        <div style={{ padding: '16px 0' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>
              flight
            </span>
            <div className="rs-card-label" style={{ marginBottom: 6 }}>NO RADAR ORIGIN SET</div>
            <div className="rs-card-meta" style={{ marginBottom: 16 }}>
              Set your location in Weather settings, or search here — coordinates are shared.
            </div>
          </div>
          <LocationSearch onSelect={handleLocationSelect} />
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>
            flight_off
          </span>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
          <button className="rs-pill" onClick={() => fetchFlights(flSettings, wxSettings)}>RETRY</button>
        </div>
      )}

      {/* Map + list split */}
      {!error && (
        <div style={{ display: 'flex', gap: 16, height: 380 }}>

          {/* Map — 60% */}
          <div style={{ flex: '3 1 0', position: 'relative', minWidth: 0 }}>
            {loading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 10, borderRadius: 8,
                background: 'var(--md-surface-container)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2 }}>flight</span>
              </div>
            )}
            {lat && lon ? (
              <FlightMap lat={lat} lon={lon} radiusDeg={radiusDeg} aircraft={loading ? [] : sortedAircraft} />
            ) : (
              <div style={{
                width: '100%', height: '100%', borderRadius: 8,
                background: 'var(--md-surface-container)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.15 }}>map</span>
              </div>
            )}
          </div>

          {/* Aircraft list — 40% */}
          <div style={{
            flex: '2 1 0', minWidth: 0, display: 'flex', flexDirection: 'column',
            border: '1px solid var(--md-outline-variant)', borderRadius: 8, overflow: 'hidden',
          }}>
            {/* Column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: LIST_COLS,
              gap: 6, padding: '7px 12px', flexShrink: 0,
              borderBottom: '1px solid var(--md-outline-variant)',
              background: 'var(--md-surface-container)',
            }}>
              {['CALLSIGN', 'COUNTRY', 'ALT', 'KTS', 'HDG', 'STATUS'].map(h => (
                <div key={h} className="rs-card-label" style={{
                  fontSize: '0.47rem', opacity: 0.45,
                  textAlign: h === 'STATUS' ? 'right' : 'left',
                }}>{h}</div>
              ))}
            </div>

            {/* Rows */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loading && (
                <div>
                  {[0,1,2,3,4,5].map(i => (
                    <div key={i} style={{
                      display: 'grid', gridTemplateColumns: LIST_COLS,
                      gap: 6, padding: '8px 12px', alignItems: 'center',
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
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>
                    flight_land
                  </span>
                  <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>CLEAR SKIES</div>
                  <div className="rs-card-meta" style={{ fontSize: '0.62rem' }}>
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
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <span className="rs-card-meta" style={{ fontSize: '0.6rem', opacity: 0.38 }}>
            Updated {agoText}
          </span>
        </div>
      )}
    </div>
  )
}
