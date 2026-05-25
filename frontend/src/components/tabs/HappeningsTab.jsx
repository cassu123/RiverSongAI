import React, { useState, useEffect } from 'react'

export default function HappeningsTab({ token, active }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!active) return
    let isMounted = true
    setLoading(true)
    fetch('/api/feeds/happenings', { headers: { Authorization: `Bearer ${token}` } })
      .then(async r => {
        if (!r.ok) throw new Error('Happenings feed unavailable')
        return r.json()
      })
      .then(d => { if (isMounted) { setData(d); setError(null); setLoading(false) } })
      .catch(e => { if (isMounted) { setError(e.message); setLoading(false) } })
    return () => { isMounted = false }
  }, [token, active])

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', opacity: 0.5 }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', animation: 'spin 2s linear infinite' }}>whatshot</span>
    </div>
  )
  
  if (error) return <div style={{ padding: 20, color: 'red' }}>Error: {error}</div>
  if (!data) return null

  const { trending = [], events_nearby = [] } = data

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      
      {/* Trending (HN + Reddit) */}
      <div className="rs-card" style={{ padding: '20px', maxHeight: '800px', overflowY: 'auto' }}>
        <div className="rs-card-label" style={{ marginBottom: 16 }}>TRENDING DISCUSSIONS</div>
        {trending.length > 0 ? trending.map((t, i) => (
          <div key={i} style={{ marginBottom: 16, display: 'flex', gap: 12, borderBottom: i < trending.length - 1 ? '1px solid var(--md-outline-variant)' : 'none', paddingBottom: 16 }}>
            <div style={{ 
              width: 24, height: 24, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: t.source === 'hackernews' ? '#ff6600' : '#ff4500',
              color: '#fff', fontSize: '14px', fontWeight: 800
            }}>
              {t.source === 'hackernews' ? 'Y' : 'r'}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <a href={t.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>
                  {t.title}
                </div>
              </a>
              {t.image_url && (
                <div style={{ marginBottom: 8, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--md-outline-variant)', maxHeight: 120 }}>
                  <img src={t.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div className="rs-card-meta" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>arrow_upward</span>
                  {t.score.toLocaleString()}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>chat_bubble</span>
                  {t.comments.toLocaleString()}
                </span>
                {t.subreddit && (
                  <span style={{ background: 'var(--md-surface-container-high)', padding: '2px 6px', borderRadius: 4 }}>
                    r/{t.subreddit}
                  </span>
                )}
                <span style={{ opacity: 0.5 }}>
                  {Math.floor((Date.now() - new Date(t.posted_at).getTime()) / 3600000)}h ago by {t.author}
                </span>
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No trending discussions.</div>
        )}
      </div>

      {/* Events Nearby */}
      <div className="rs-card" style={{ padding: '20px', maxHeight: '800px', overflowY: 'auto' }}>
        <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
          <span>EVENTS NEARBY</span>
          <span style={{ opacity: 0.5 }}>Eventbrite</span>
        </div>
        {events_nearby.length > 0 ? events_nearby.map((e, i) => (
          <div key={i} style={{ marginBottom: 16, display: 'flex', gap: 12, borderBottom: i < events_nearby.length - 1 ? '1px solid var(--md-outline-variant)' : 'none', paddingBottom: 16 }}>
            {e.image_url ? (
              <img src={e.image_url} alt="" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 64, height: 64, borderRadius: 8, background: 'var(--md-surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.5rem', opacity: 0.3 }}>event</span>
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <a href={e.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>
                  {e.title}
                </div>
              </a>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
                {new Date(e.start_time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.7rem', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.venue || e.city}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{e.distance_mi} mi</span>
              </div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, background: 'var(--md-surface-container-highest)', display: 'inline-block', padding: '2px 6px', borderRadius: 4 }}>
                {e.price_max > 0 ? (
                  e.price_min === e.price_max ? `$${e.price_min}` : `$${e.price_min} - $${e.price_max}`
                ) : 'Free'}
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No local events found.</div>
        )}
      </div>

    </div>
  )
}
