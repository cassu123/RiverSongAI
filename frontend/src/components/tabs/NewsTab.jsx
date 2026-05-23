// Audit: GET /api/feeds/news — returns articles from user-selected RSS sources.
// Response: array of { title, summary, url, source, published_at, image_url, category }.
// Cache: handled by FeedService / browser; no external cache needed here.

import React, { useState, useEffect, useCallback } from 'react'

export default function NewsTab({ token, active }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const fetch_ = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/feeds/news', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Feed unavailable')
      setArticles(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  useEffect(() => { fetch_() }, [fetch_])

  if (loading) return <NewsSkeletons />

  if (error) return (
    <ErrorState message={error} onRetry={fetch_} />
  )

  if (!articles.length) return (
    <div style={{ padding: '32px 0', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>newspaper</span>
      <div className="rs-card-label" style={{ marginBottom: 8 }}>NO SOURCES SELECTED</div>
      <div className="rs-card-meta">Open the Feeds page and enable news sources in the configuration panel.</div>
    </div>
  )

  // Deduplicate categories for the filter strip
  const cats = [...new Set(articles.map(a => a.category).filter(Boolean))]

  return (
    <div>
      {cats.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {cats.map(c => (
            <span
              key={c}
              className="rs-pill"
              style={{ fontSize: '0.58rem', padding: '3px 10px', pointerEvents: 'none', opacity: 0.7 }}
            >
              {c.toUpperCase()}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {articles.map((a, i) => (
          <ArticleCard key={a.url || i} article={a} />
        ))}
      </div>
    </div>
  )
}

function ArticleCard({ article: a }) {
  return (
    <div
      onClick={() => window.open(a.url, '_blank')}
      style={{
        display: 'flex',
        gap: 16,
        padding: '14px 0',
        borderBottom: '1px solid var(--md-outline-variant)',
        cursor: 'pointer',
      }}
    >
      {a.image_url && (
        <img
          src={a.image_url}
          alt=""
          style={{
            width: 80,
            height: 64,
            objectFit: 'cover',
            borderRadius: 6,
            flexShrink: 0,
            background: 'var(--md-surface-container-highest)',
          }}
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="rs-card-label" style={{ fontSize: '0.56rem', color: 'var(--primary)', opacity: 0.9 }}>
            {a.source?.toUpperCase()}
          </span>
          {a.category && (
            <span className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.4 }}>
              {a.category.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{
          fontWeight: 650,
          fontSize: '0.9rem',
          lineHeight: 1.3,
          marginBottom: 4,
          color: 'var(--md-on-surface)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {a.title}
        </div>
        {a.summary && (
          <div className="rs-card-meta" style={{
            fontSize: '0.78rem',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {a.summary}
          </div>
        )}
        <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.35, marginTop: 6 }}>
          {a.published_at ? new Date(a.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
      </div>
    </div>
  )
}

function NewsSkeletons() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{ display: 'flex', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ width: 80, height: 64, borderRadius: 6, background: 'var(--md-outline-variant)', flexShrink: 0, opacity: 0.4 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 9, width: '35%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.5 }} />
            <div style={{ height: 12, width: '85%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
            <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{ padding: '32px 0', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.3, display: 'block', marginBottom: 8 }}>wifi_off</span>
      <div className="rs-card-meta" style={{ marginBottom: 12 }}>{message}</div>
      <button className="rs-pill" onClick={onRetry}>RETRY</button>
    </div>
  )
}
