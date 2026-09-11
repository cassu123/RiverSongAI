import React, { useState, useEffect } from 'react'

export default function SpaceTab({ token, active }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!active) return
    let isMounted = true
    setLoading(true)
    fetch('/api/feeds/space', { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) {
          if (r.status === 404) throw new Error('location')
          throw new Error('Space feed unavailable')
        }
        return r.json()
      })
      .then(d => { if (isMounted) { setData(d); setError(null); setLoading(false) } })
      .catch(e => { if (isMounted) { setError(e.message); setLoading(false) } })
    return () => { isMounted = false }
  }, [token, active])

  if (loading) return (
    <div className="rs-p-7 rs-text-center" style={{ opacity: 0.5 }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', animation: 'spin 2s linear infinite' }}>rocket</span>
    </div>
  )
  
  if (error === 'location') return (
    <div className="rs-text-center" style={{ padding: 'var(--rs-space-7) 0' }}>
      <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '3rem', opacity: 0.2, display: 'block' }}>location_off</span>
      <div className="rs-card-label rs-mb-2">NO LOCATION SET</div>
      <div className="rs-card-meta rs-mb-5">Please set your location in Weather settings first.</div>
    </div>
  )
  
  if (error) return <div className="rs-p-5 rs-c-critical">Error: {error}</div>
  if (!data) return null

  const { solar, aurora, launches } = data

  return (
    <div className="rs-gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      
      {/* Solar Activity */}
      <div className="rs-card" style={{ padding: 'var(--rs-space-5)' }}>
        <div className="rs-card-label rs-mb-4">SOLAR ACTIVITY</div>
        {solar && (
          <div>
            <div className="rs-flex rs-items-center rs-gap-4 rs-mb-5">
              <div style={{ fontSize: '3rem', fontWeight: 200, lineHeight: 1, letterSpacing: '-0.06em' }}>
                {solar.kp_index?.toFixed(1) || '0.0'}
              </div>
              <div>
                <div className="rs-type-tiny rs-fw-700" style={{ color: solar.kp_color || '#888' }}>
                  {solar.kp_label || 'Normal'}
                </div>
                <div className="rs-card-meta rs-type-nano" style={{ marginTop: 2 }}>Kp Index</div>
              </div>
            </div>
            
            <div className="rs-gap-3 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ background: 'var(--md-surface-container-high)', padding: 'var(--rs-space-3) var(--rs-space-3)', borderRadius: 'var(--md-shape-sm)' }}>
                <div className="rs-card-meta rs-mb-1 rs-type-nano">SOLAR WIND</div>
                <div className="rs-mono rs-type-small rs-fw-700">
                  {solar.solar_wind_speed_kms != null ? `${solar.solar_wind_speed_kms} km/s` : '—'}
                </div>
              </div>
              <div style={{ background: 'var(--md-surface-container-high)', padding: 'var(--rs-space-3) var(--rs-space-3)', borderRadius: 'var(--md-shape-sm)' }}>
                <div className="rs-card-meta rs-mb-1 rs-type-nano">MAGNETIC FIELD</div>
                <div className="rs-mono rs-type-small rs-fw-700">
                  {solar.bz_nt != null ? `${solar.bz_nt} nT` : '—'}
                </div>
              </div>
            </div>

            <div className="rs-card-label rs-mb-2 rs-muted rs-type-nano">FLARES (24H)</div>
            {solar.flares_24h?.length > 0 ? (
              solar.flares_24h.map((f, i) => (
                <div key={i} className="rs-flex rs-justify-between" style={{ padding: 'var(--rs-space-2) 0', borderBottom: i < solar.flares_24h.length - 1 ? '1px solid var(--md-outline-variant)' : 'none' }}>
                  <span className="rs-type-tiny rs-fw-700" style={{ color: '#ff8800' }}>{f.class}</span>
                  <span className="rs-card-meta rs-type-micro">{f.region || 'Unknown Region'}</span>
                </div>
              ))
            ) : (
              <div className="rs-card-meta rs-type-micro">No significant flares reported.</div>
            )}
          </div>
        )}
      </div>

      {/* Aurora */}
      <div className="rs-card" style={{ padding: 'var(--rs-space-5)' }}>
        <div className="rs-card-label rs-mb-4">AURORA FORECAST</div>
        {aurora && (
          <div>
            {aurora.ovation_img && (
              <div className="rs-mb-4 rs-clip" style={{ borderRadius: 'var(--md-shape-md)', border: '1px solid var(--md-outline-variant)' }}>
                <img src={aurora.ovation_img} alt="Ovation Aurora Forecast" className="rs-w-full" style={{ display: 'block' }} />
              </div>
            )}
            <div className="rs-flex rs-justify-between rs-items-center" style={{ background: 'var(--md-surface-container-high)', padding: 'var(--rs-space-3) var(--rs-space-4)', borderRadius: 'var(--md-shape-sm)' }}>
              <span className="rs-card-meta rs-type-micro">Visibility at your location:</span>
              <span className="rs-type-micro rs-fw-700" style={{
                color: aurora.your_chance === 'none' ? 'var(--md-on-surface-variant)' : 'var(--primary)',
              }}>
                {aurora.your_chance === 'none' ? 'None' : aurora.your_chance === 'low' ? 'Low' : 'Likely'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Launches */}
      <div className="rs-card" style={{ padding: 'var(--rs-space-5)', maxHeight: '500px', overflowY: 'auto' }}>
        <div className="rs-card-label rs-mb-4">UPCOMING LAUNCHES</div>
        {launches?.length > 0 ? launches.map((l, i) => (
          <div key={i} className="rs-mb-4 rs-flex rs-gap-4">
            {l.image_url ? (
              <img src={l.image_url} alt={l.name} className="rs-no-shrink" style={{ width: 56, height: 56, borderRadius: 'var(--md-shape-sm)', objectFit: 'cover' }} />
            ) : (
              <div className="rs-flex rs-items-center rs-justify-center rs-no-shrink" style={{ width: 56, height: 56, borderRadius: 'var(--md-shape-sm)', background: 'var(--md-surface-container-high)' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.5rem', opacity: 0.3 }}>rocket</span>
              </div>
            )}
            <div className="rs-min-w-0">
              <div className="rs-mb-1 rs-type-tiny rs-nowrap rs-clip rs-ellipsis rs-fw-700" style={{ lineHeight: 1.2 }}>
                {l.name}
              </div>
              <div className="rs-card-meta rs-mb-1 rs-type-nano rs-nowrap rs-clip rs-ellipsis">
                {l.provider} · {l.pad}
              </div>
              <div className="rs-type-nano rs-fw-600" style={{
                color: l.status === 'Go' ? 'var(--primary)' : 'var(--md-on-surface-variant)',
              }}>
                {new Date(l.net).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <span className="rs-muted rs-fw-400" style={{ marginLeft: 'var(--rs-space-2)' }}>({l.status})</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta rs-type-micro">No upcoming launches found.</div>
        )}
      </div>

    </div>
  )
}
