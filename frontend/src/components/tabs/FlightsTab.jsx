// Backend: GET /api/feeds/flights?lat=&lon=&radius=&filter_status=
// Settings: PATCH /api/settings/page { flights: { radar_radius_deg, filter, refresh_interval_sec } }
// Location: shared from settings_json.weather.lat/lon

import React, { useState, useEffect, useCallback, useRef } from 'react'
import TabSettingsPanel, { SettingsRow, ToggleGroup } from '../TabSettingsPanel.jsx'

const MPS_TO_KTS = 1.94384
const M_TO_FT    = 3.28084

function mpsToKts(v) { return v != null ? Math.round(v * MPS_TO_KTS) : null }
function mToFt(m) { return m != null ? Math.round(m * M_TO_FT) : null }

function trackArrow(deg) {
  if (deg == null) return '·'
  const idx = Math.round(deg / 45) % 8
  return ['↑','↗','→','↘','↓','↙','←','↖'][idx]
}

// Reuse the same LocationSearch as WeatherTab (inline copy to avoid cross-tab coupling)
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
          {searching && <div className="rs-card-meta" style={{ padding: '8px 14px', fontSize: '0.72rem' }}>Searching…</div>}
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

function AircraftRow({ flight, i, total }) {
  const alt = mToFt(flight.baro_altitude_m)
  const spd = mpsToKts(flight.velocity_mps)
  const status = flight.on_ground ? 'Ground' : 'Airborne'
  const statusColor = flight.on_ground ? 'var(--md-on-surface-variant)' : 'oklch(71% 0.17 145)'
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '88px 80px 80px 60px 40px 72px',
      gap: 8, alignItems: 'center',
      padding: '10px 0',
      borderBottom: i < total - 1 ? '1px solid var(--md-outline-variant)' : 'none',
    }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.06em' }}>
          {flight.callsign || '—'}
        </div>
        <div className="rs-card-meta" style={{ fontSize: '0.58rem', marginTop: 1 }}>
          {flight.icao24}
        </div>
      </div>
      <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
        {flight.country || '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700 }}>
        {alt != null ? `${alt.toLocaleString()} ft` : '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
        {spd != null ? `${spd} kts` : '—'}
      </div>
      <div style={{ fontSize: '0.9rem', textAlign: 'center' }}>
        {trackArrow(flight.true_track_deg)}
      </div>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: statusColor, textAlign: 'right' }}>
        {status}
      </div>
    </div>
  )
}

export default function FlightsTab({ token, active }) {
  const [flights, setFlights]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [wxSettings, setWxSet]    = useState(null)   // settings_json.weather
  const [flSettings, setFlSet]    = useState(null)   // settings_json.flights
  const [settingsOpen, setSOpen]  = useState(false)
  const intervalRef               = useRef(null)
  const panelRef                  = useRef(null)
  const authHeaders = { Authorization: `Bearer ${token}` }

  const flDef = { radar_radius_deg: 0.5, filter: 'all', refresh_interval_sec: 30 }

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
    const params = new URLSearchParams({
      lat, lon,
      radius: cur.radar_radius_deg,
      filter_status: cur.filter === 'all' ? '' : cur.filter,
    })
    try {
      const res = await fetch(`/api/feeds/flights?${params}`, { headers: authHeaders })
      if (res.status === 404) { setError('location'); return }
      if (!res.ok) throw new Error('Flights unavailable')
      const data = await res.json()
      setFlights(data.flights || [])
    } catch (e) {
      if (!e.message?.includes('AbortError')) setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  // Load settings on mount
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

  // Polling based on refresh interval
  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!active || !wxSettings?.lat || error === 'location') return
    const ms = ((flSettings?.refresh_interval_sec) || 30) * 1000
    intervalRef.current = setInterval(() => fetchFlights(flSettings, wxSettings), ms)
    return () => clearInterval(intervalRef.current)
  }, [active, flSettings, wxSettings, error, fetchFlights])

  const handleLocationSelect = async ({ lat, lon, location_query }) => {
    const nextWx = await patchWeather({ lat, lon, location_query })
    setError(null)
    setLoading(true)
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

  const fl = flSettings || flDef
  const radiusDeg = fl.radar_radius_deg || 0.5
  const radiusKm  = Math.round(radiusDeg * 111)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="rs-card-meta" style={{ fontSize: '0.72rem', fontWeight: 700 }}>
            OVERHEAD RADAR
          </span>
          {!loading && !error && (
            <span className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.45 }}>
              {flights.length} aircraft · {radiusDeg}° ≈ {radiusKm} km
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
                    { value: 'all', label: 'All' },
                    { value: 'airborne', label: 'Airborne' },
                    { value: 'ground', label: 'Ground' },
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
              Set your location in Weather settings, or search here — the coordinates are shared.
            </div>
          </div>
          <LocationSearch onSelect={handleLocationSelect} />
        </div>
      )}

      {/* Generic error */}
      {error && error !== 'location' && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 10 }}>flight_off</span>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
          <button className="rs-pill" onClick={() => fetchFlights(flSettings, wxSettings)}>RETRY</button>
        </div>
      )}

      {loading && !error && <FlightsSkeleton />}

      {!loading && !error && (
        <>
          {/* Column headers */}
          {flights.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '88px 80px 80px 60px 40px 72px',
              gap: 8, paddingBottom: 8,
              borderBottom: '1px solid var(--md-outline-variant)',
            }}>
              {['CALLSIGN', 'COUNTRY', 'ALTITUDE', 'SPEED', 'HDG', 'STATUS'].map(h => (
                <div key={h} className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.45,
                  textAlign: h === 'STATUS' ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>
          )}

          {flights.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>
                flight_land
              </span>
              <div className="rs-card-label" style={{ marginBottom: 6 }}>CLEAR SKIES</div>
              <div className="rs-card-meta">No aircraft detected within {radiusKm} km. Try expanding the radar radius.</div>
            </div>
          ) : (
            <div>
              {flights.map((f, i) => (
                <AircraftRow key={f.icao24 + i} flight={f} i={i} total={flights.length} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FlightsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '88px 80px 80px 60px 40px 72px',
          gap: 8, padding: '10px 0',
          borderBottom: '1px solid var(--md-outline-variant)', alignItems: 'center',
        }}>
          <div style={{ height: 10, width: 72, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
          <div style={{ height: 8, width: 60, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          <div style={{ height: 8, width: 64, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          <div style={{ height: 8, width: 44, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          <div style={{ height: 8, width: 20, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
          <div style={{ height: 8, width: 56, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3, marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}
