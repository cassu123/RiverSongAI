import React, { useState, useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

function OcearchMap({ lat, lon, sharks }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const markersRef = useRef([])
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!mapRef.current || lat == null || lon == null) return
    import('leaflet').then(L => {
      if (instanceRef.current) return
      const map = L.map(mapRef.current, {
        center: [lat, lon], zoom: 3,
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
    if (!mapReady || !instanceRef.current) return
    import('leaflet').then(L => {
      const map = instanceRef.current
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []

      sharks.forEach(s => {
        if (s.lat == null || s.lon == null) return
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:var(--primary);width:12px;height:12px;border-radius:50%;border:2px solid #000;box-shadow:0 0 4px #000"></div>`,
          iconSize: [12, 12], iconAnchor: [6, 6]
        })
        const popup = [
          `<div style="color:#000;font-family:var(--font-sans)">`,
          `<div style="font-weight:700;font-size:14px;margin-bottom:2px">${s.name || 'Unknown Shark'}</div>`,
          `<div style="font-size:12px;opacity:0.8">${s.species || ''}</div>`,
          s.length_ft || s.weight_lb ? `<div style="font-size:11px;margin-top:6px;font-family:var(--font-mono)">${s.length_ft ? s.length_ft + ' ft' : ''} ${s.weight_lb ? s.weight_lb + ' lb' : ''}</div>` : '',
          `</div>`
        ].join('')
        markersRef.current.push(L.marker([s.lat, s.lon], { icon }).bindPopup(popup).addTo(map))
      })
    })
  }, [sharks, mapReady])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 8, overflow: 'hidden' }} />
}

export default function EarthTab({ token, active }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weatherLatLon, setWeatherLatLon] = useState(null)

  useEffect(() => {
    if (!active) return
    let isMounted = true
    setLoading(true)

    // First fetch preferences to get lat/lon for the map center
    fetch('/api/settings/page', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : {})
      .then(prefs => {
        if (isMounted) {
          const wx = prefs?.weather || {}
          if (wx.lat && wx.lon) setWeatherLatLon({ lat: wx.lat, lon: wx.lon })
        }
      })
      .catch(() => {})

    fetch('/api/feeds/earth', { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          if (r.status === 404) throw new Error('location')
          throw new Error('Earth feed unavailable')
        }
        return r.json()
      })
      .then(d => { if (isMounted) { setData(d); setError(null); setLoading(false) } })
      .catch(e => { if (isMounted) { setError(e.message); setLoading(false) } })
    return () => { isMounted = false }
  }, [token, active])

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', opacity: 0.5 }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', animation: 'spin 2s linear infinite' }}>public</span>
    </div>
  )
  
  if (error === 'location') return (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>location_off</span>
      <div className="rs-card-label" style={{ marginBottom: 6 }}>NO LOCATION SET</div>
      <div className="rs-card-meta" style={{ marginBottom: 20 }}>Please set your location in Weather settings first.</div>
    </div>
  )
  
  if (error) return <div style={{ padding: 20, color: 'red' }}>Error: {error}</div>
  if (!data) return null

  const { eonet = [], neows = [], ocearch = [] } = data

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
      
      {/* EONET Events */}
      <div className="rs-card" style={{ padding: '20px', maxHeight: '600px', overflowY: 'auto' }}>
        <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <span>NATURAL EVENTS</span>
          <span style={{ opacity: 0.5 }}>NASA EONET</span>
        </div>
        {eonet.length > 0 ? eonet.map((e, i) => (
          <div key={i} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: i < eonet.length - 1 ? '1px solid var(--md-outline-variant)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{e.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ 
                    fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: e.category_color + '33', color: e.category_color
                  }}>
                    {e.category}
                  </div>
                  <div className="rs-card-meta" style={{ fontSize: '0.65rem' }}>
                    {e.distance_mi.toLocaleString()} mi away
                  </div>
                </div>
              </div>
              {e.source_url && (
                <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'var(--md-on-surface-variant)', flexShrink: 0 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>open_in_new</span>
                </a>
              )}
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No nearby events reported recently.</div>
        )}
      </div>

      {/* Near Earth Objects */}
      <div className="rs-card" style={{ padding: '20px' }}>
        <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <span>NEAR EARTH OBJECTS</span>
          <span style={{ opacity: 0.5 }}>NASA NeoWs</span>
        </div>
        {neows.length > 0 ? neows.map((n, i) => (
          <div key={i} style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--md-surface-container-high)', borderRadius: 8, border: n.hazardous ? '1px solid #ff440055' : '1px solid transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800 }}>{n.name}</div>
              {n.hazardous && (
                <div style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#ff440033', color: '#ff4400' }}>
                  HAZARDOUS
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 2 }}>APPROACH</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{new Date(n.approach_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
              </div>
              <div>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 2 }}>MISS DISTANCE</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{n.miss_distance_lunar.toFixed(1)} LD</div>
              </div>
              <div>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 2 }}>VELOCITY</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{n.velocity_kph.toLocaleString()} km/h</div>
              </div>
              <div>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 2 }}>EST. DIAMETER</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>{n.diameter_m} m</div>
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No close approaches today.</div>
        )}
      </div>

      {/* OCEARCH */}
      <div className="rs-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
        <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <span>MARINE WILDLIFE</span>
          <span style={{ opacity: 0.5 }}>OCEARCH</span>
        </div>
        {ocearch.length > 0 && weatherLatLon ? (
          <div style={{ height: 300, position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
            <OcearchMap lat={weatherLatLon.lat} lon={weatherLatLon.lon} sharks={ocearch} />
          </div>
        ) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No marine tracking data available.</div>
        )}
      </div>

    </div>
  )
}
