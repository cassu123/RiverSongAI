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
    <div style={{ padding: 40, textAlign: 'center', opacity: 0.5 }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', animation: 'spin 2s linear infinite' }}>rocket</span>
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

  const { solar, aurora, launches } = data

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
      
      {/* Solar Activity */}
      <div className="rs-card" style={{ padding: '20px' }}>
        <div className="rs-card-label" style={{ marginBottom: 16 }}>SOLAR ACTIVITY</div>
        {solar && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ fontSize: '3rem', fontWeight: 200, lineHeight: 1, letterSpacing: '-0.06em' }}>
                {solar.kp_index?.toFixed(1) || '0.0'}
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: solar.kp_color || '#888' }}>
                  {solar.kp_label || 'Normal'}
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.7rem', marginTop: 2 }}>Kp Index</div>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{ background: 'var(--md-surface-container-high)', padding: '10px 12px', borderRadius: 8 }}>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 4 }}>SOLAR WIND</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                  {solar.solar_wind_speed_kms != null ? `${solar.solar_wind_speed_kms} km/s` : '—'}
                </div>
              </div>
              <div style={{ background: 'var(--md-surface-container-high)', padding: '10px 12px', borderRadius: 8 }}>
                <div className="rs-card-meta" style={{ fontSize: '0.6rem', marginBottom: 4 }}>MAGNETIC FIELD</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                  {solar.bz_nt != null ? `${solar.bz_nt} nT` : '—'}
                </div>
              </div>
            </div>

            <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.5, marginBottom: 8 }}>FLARES (24H)</div>
            {solar.flares_24h?.length > 0 ? (
              solar.flares_24h.map((f, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < solar.flares_24h.length - 1 ? '1px solid var(--md-outline-variant)' : 'none' }}>
                  <span style={{ color: '#ff8800', fontWeight: 700, fontSize: '0.8rem' }}>{f.class}</span>
                  <span className="rs-card-meta" style={{ fontSize: '0.75rem' }}>{f.region || 'Unknown Region'}</span>
                </div>
              ))
            ) : (
              <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No significant flares reported.</div>
            )}
          </div>
        )}
      </div>

      {/* Aurora */}
      <div className="rs-card" style={{ padding: '20px' }}>
        <div className="rs-card-label" style={{ marginBottom: 16 }}>AURORA FORECAST</div>
        {aurora && (
          <div>
            {aurora.ovation_img && (
              <div style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--md-outline-variant)' }}>
                <img src={aurora.ovation_img} alt="Ovation Aurora Forecast" style={{ width: '100%', display: 'block' }} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--md-surface-container-high)', padding: '12px 16px', borderRadius: 8 }}>
              <span className="rs-card-meta" style={{ fontSize: '0.75rem' }}>Visibility at your location:</span>
              <span style={{ 
                fontSize: '0.75rem', fontWeight: 700,
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
        <div className="rs-card-label" style={{ marginBottom: 16 }}>UPCOMING LAUNCHES</div>
        {launches?.length > 0 ? launches.map((l, i) => (
          <div key={i} style={{ marginBottom: 16, display: 'flex', gap: 14 }}>
            {l.image_url ? (
              <img src={l.image_url} alt={l.name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--md-surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.5rem', opacity: 0.3 }}>rocket</span>
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 4, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.name}
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.65rem', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.provider} · {l.pad}
              </div>
              <div style={{ 
                fontSize: '0.7rem', fontWeight: 600,
                color: l.status === 'Go' ? 'var(--primary)' : 'var(--md-on-surface-variant)'
              }}>
                {new Date(l.net).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                <span style={{ opacity: 0.5, marginLeft: 6, fontWeight: 400 }}>({l.status})</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No upcoming launches found.</div>
        )}
      </div>

    </div>
  )
}
