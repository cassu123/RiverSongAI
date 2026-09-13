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
    <div className="rs-p-7 rs-text-center" style={{ opacity: 0.5 }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', animation: 'spin 2s linear infinite' }}>whatshot</span>
    </div>
  )
  
  if (error) return <div className="rs-p-5 rs-c-critical">Error: {error}</div>
  if (!data) return null

  const { trending = [], events_nearby = [] } = data

  return (
    <div className="rs-gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
      
      {/* Trending (HN + Reddit) */}
      <div className="rs-card" style={{ padding: 'var(--rs-space-5)', maxHeight: '800px', overflowY: 'auto' }}>
        <div className="rs-card-label rs-mb-4">TRENDING DISCUSSIONS</div>
        {trending.length > 0 ? trending.map((t, i) => (
          <div key={i} className="rs-mb-4 rs-flex rs-gap-3" style={{ borderBottom: i < trending.length - 1 ? '1px solid var(--md-outline-variant)' : 'none', paddingBottom: 'var(--rs-space-4)' }}>
            <div className="rs-flex rs-items-center rs-justify-center rs-no-shrink rs-type-small rs-c-fg rs-fw-800" style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--md-shape-xs)',
              background: t.source === 'hackernews' ? '#ff6600' : '#ff4500',
            }}>
              {t.source === 'hackernews' ? 'Y' : 'r'}
            </div>
            <div className="rs-grow rs-min-w-0">
              <a href={t.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="rs-mb-2 rs-type-tiny rs-fw-700" style={{ lineHeight: 1.3 }}>
                  {t.title}
                </div>
              </a>
              {t.image_url && (
                <div className="rs-mb-2 rs-clip" style={{ borderRadius: 'var(--md-shape-xs)', border: '1px solid var(--md-outline-variant)', maxHeight: 120 }}>
                  <img src={t.image_url} alt="" className="rs-w-full rs-h-full" style={{ objectFit: 'cover', display: 'block' }} />
                </div>
              )}
              <div className="rs-card-meta rs-flex rs-items-center rs-gap-3 rs-flex-wrap rs-type-nano">
                <span className="rs-flex rs-items-center rs-gap-1">
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>arrow_upward</span>
                  {t.score.toLocaleString()}
                </span>
                <span className="rs-flex rs-items-center rs-gap-1">
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>chat_bubble</span>
                  {t.comments.toLocaleString()}
                </span>
                {t.subreddit && (
                  <span style={{ background: 'var(--md-surface-container-high)', padding: '2px 6px', borderRadius: 'var(--md-shape-xs)' }}>
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
          <div className="rs-card-meta rs-type-micro">No trending discussions.</div>
        )}
      </div>

      {/* Events Nearby */}
      <div className="rs-card" style={{ padding: 'var(--rs-space-5)', maxHeight: '800px', overflowY: 'auto' }}>
        <div className="rs-card-label rs-mb-4 rs-flex rs-justify-between">
          <span>EVENTS NEARBY</span>
          <span style={{ opacity: 0.5 }}>Eventbrite</span>
        </div>
        {events_nearby.length > 0 ? events_nearby.map((e, i) => (
          <div key={i} className="rs-mb-4 rs-flex rs-gap-3" style={{ borderBottom: i < events_nearby.length - 1 ? '1px solid var(--md-outline-variant)' : 'none', paddingBottom: 'var(--rs-space-4)' }}>
            {e.image_url ? (
              <img src={e.image_url} alt="" className="rs-no-shrink" style={{ width: 64, height: 64, borderRadius: 'var(--md-shape-sm)', objectFit: 'cover' }} />
            ) : (
              <div className="rs-flex rs-items-center rs-justify-center rs-no-shrink" style={{ width: 64, height: 64, borderRadius: 'var(--md-shape-sm)', background: 'var(--md-surface-container-high)' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.5rem', opacity: 0.3 }}>event</span>
              </div>
            )}
            <div className="rs-grow rs-min-w-0">
              <a href={e.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="rs-mb-1 rs-type-tiny rs-fw-700" style={{ lineHeight: 1.3 }}>
                  {e.title}
                </div>
              </a>
              <div className="rs-mb-1 rs-type-nano rs-fw-600 rs-c-accent">
                {new Date(e.start_time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="rs-card-meta rs-mb-1 rs-flex rs-justify-between rs-type-nano">
                <span className="rs-nowrap rs-clip rs-ellipsis">{e.venue || e.city}</span>
                <span className="rs-nowrap">{e.distance_mi} mi</span>
              </div>
              <div className="rs-type-nano rs-fw-700" style={{ background: 'var(--md-surface-container-highest)', display: 'inline-block', padding: '2px 6px', borderRadius: 'var(--md-shape-xs)' }}>
                {e.price_max > 0 ? (
                  e.price_min === e.price_max ? `$${e.price_min}` : `$${e.price_min} - $${e.price_max}`
                ) : 'Free'}
              </div>
            </div>
          </div>
        )) : (
          <div className="rs-card-meta rs-type-micro">No local events found.</div>
        )}
      </div>

    </div>
  )
}
