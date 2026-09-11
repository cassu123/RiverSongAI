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
    <div className="rs-text-center" style={{ padding: '40px 0' }}>
      <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '3rem', opacity: 0.2, display: 'block' }}>location_off</span>
      <div className="rs-card-label rs-mb-2">NO LOCATION SET</div>
      <div className="rs-card-meta rs-mb-5">Please set your location in Weather settings first.</div>
    </div>
  )
  
  if (error) return <div className="rs-p-5" style={{ color: 'var(--rs-status-critical)' }}>Error: {error}</div>
  if (!data) return null

  const { solar, aurora, launches } = data

  return (
    <div className="rs-gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      
      {/* Solar Activity */}
      <div className="rs-card" style={{ padding: '20px' }}>
        <div className="rs-card-label rs-mb-4">SOLAR ACTIVITY</div>
        {solar && (
          <div>
            <div className="rs-flex rs-items-center rs-gap-4 rs-mb-5">
              <div style={{ fontSize: '3rem', fontWeight: 200, lineHeight: 1, letterSpacing: '-0.06em' }}>
                {solar.kp_index?.toFixed(1) || '0.0'}
              </div>
              <div>
                <div style={{ fontSize: 'var(--rs-fs-tiny)', fontWeight: 700, color: solar.kp_color || '#888' }}>
                  {solar.kp_label || 'Normal'}
                </div>
                <div className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-nano)', marginTop: 2 }}>Kp Index</div>
              </div>
            </div>
            
            <div className="rs-gap-3 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ background: 'var(--md-surface-container-high)', padding: '10px 12px', borderRadius: 8 }}>
                <div className="rs-card-meta rs-mb-1" style={{ fontSize: 'var(--rs-fs-nano)' }}>SOLAR WIND</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-small)', fontWeight: 700 }}>
                  {solar.solar_wind_speed_kms != null ? `${solar.solar_wind_speed_kms} km/s` : '—'}
                </div>
              </div>
              <div style={{ background: 'var(--md-surface-container-high)', padding: '10px 12px', borderRadius: 8 }}>
                <div className="rs-card-meta rs-mb-1" style={{ fontSize: 'var(--rs-fs-nano)' }}>MAGNETIC FIELD</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-small)', fontWeight: 700 }}>
                  {solar.bz_nt != null ? `${solar.bz_nt} nT` : '—'}
                </div>
              </div>
            </div>

            <div className="rs-card-label rs-mb-2" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>FLARES (24H)</div>
            {solar.flares_24h?.length > 0 ? (
              solar.flares_24h.map((f, i) => (
                <div key={i} className="rs-flex rs-justify-between" style={{ padding: '6px 0', borderBottom: i < solar.flares_24h.length - 1 ? '1px solid var(--md-outline-variant)' : 'none' }}>
                  <span style={{ color: '#ff8800', fontWeight: 700, fontSize: 'var(--rs-fs-tiny)' }}>{f.class}</span>
                  <span className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-micro)' }}>{f.region || 'Unknown Region'}</span>
                </div>
              ))
            ) : (
              <div className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-micro)' }}>No significant flares reported.</div>
            )}
          </div>
        )}
      </div>

      {/* Aurora */}
      <div className="rs-card" style={{ padding: '20px' }}>
        <div className="rs-card-label rs-mb-4">AURORA FORECAST</div>
        {aurora && (
          <div>
            {aurora.ovation_img && (
              <div className="rs-mb-4" style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--md-outline-variant)' }}>
                <img src={aurora.ovation_img} alt="Ovation Aurora Forecast" className="rs-w-full" style={{ display: 'block' }} />
              </div>
            )}
            <div className="rs-flex rs-justify-between rs-items-center" style={{ background: 'var(--md-surface-container-high)', padding: '12px 16px', borderRadius: 8 }}>
              <span className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-micro)' }}>Visibility at your location:</span>
              <span style={{ 
                fontSize: 'var(--rs-fs-micro)', fontWeight: 700,
                color: aurora.your_chance === 'none' ? 'var(--md-on-surface-variant)' : 'var(--primary)'
              }}>
                {aurora.your_chance === 'none' ? 'None' : aurora.your_chance === 'low' ? 'Low' : 'Likely'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Launches */}
      <div className="rs-card" style={{ padding: '20px', maxHeight: '500px', overflowY: 'auto' }}>
        <div className="rs-card-label rs-mb-4">UPCOMING LAUNCHES</div>
        {launches?.length > 0 ? launches.map((l, i) => (
          <div key={i} className="rs-mb-4 rs-flex rs-gap-4">
            {l.image_url ? (
              <img src={l.image_url} alt={l.name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div className="rs-flex rs-items-center rs-justify-center" style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--md-surface-container-high)', flexShrink: 0 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.5rem', opacity: 0.3 }}>rocket</span>
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div className="rs-mb-1" style={{ fontSize: 'var(--rs-fs-tiny)', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.name}
              </div>
              <div className="rs-card-meta rs-mb-1" style={{ fontSize: 'var(--rs-fs-nano)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.provider} · {l.pad}
              </div>
              <div style={{ 
                fontSize: 'var(--rs-fs-nano)', fontWeight: 600,
                color: l.status === 'Go' ? 'var(--primary)' : 'var(--md-on-surface-variant)'
              }}>
                {new Date(l.net).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>({l.status})</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-micro)' }}>No upcoming launches found.</div>
        )}
      </div>

    </div>
  )
}
