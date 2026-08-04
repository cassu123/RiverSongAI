// Audit: GET /api/feeds/news — returns articles from user-selected RSS sources.
// Response: array of { title, summary, url, source, published_at, image_url, category }.
//
// Source picker:
//   GET  /api/feeds/news/sources         — { sources, categories } catalogue
//   GET  /api/feeds/preferences          — current user prefs (incl. news_sources)
//   PUT  /api/feeds/preferences          — full prefs object; sibling fields preserved
//                                          by merging with the most recent GET result.

import React, { useState, useEffect, useCallback } from 'react'
import { InlineSettingsSection } from '../TabSettingsPanel.jsx'

export default function NewsTab({ token, active }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [prefs, setPrefs]         = useState(null)
  const [allSources, setAllSources] = useState([])
  const [catMeta, setCatMeta]       = useState({})

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchArticles = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/feeds/news', { headers: authHeaders })
      if (!res.ok) throw new Error('Feed unavailable')
      setArticles(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  // Load preferences + sources catalogue once when the tab activates
  useEffect(() => {
    if (!active) return
    let cancelled = false
    Promise.all([
      fetch('/api/feeds/preferences', { headers: authHeaders })
        .then(r => r.ok ? r.json() : null),
      fetch('/api/feeds/news/sources')
        .then(r => r.ok ? r.json() : null),
    ]).then(([p, cat]) => {
      if (cancelled) return
      if (p)   setPrefs(p)
      if (cat) {
        setAllSources(cat.sources || [])
        setCatMeta(cat.categories || {})
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [token, active])

  useEffect(() => { fetchArticles() }, [fetchArticles])

  const saveSources = async (nextSources) => {
    if (!prefs) return
    const updated = { ...prefs, news_sources: nextSources }
    setPrefs(updated)
    try {
      await fetch('/api/feeds/preferences', {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      // Articles depend on the saved source list — refetch.
      fetchArticles()
    } catch {/* preference save is best-effort; UI already reflects new state */}
  }

  const selected = prefs?.news_sources || []
  const activeCount = selected.length

  const renderSourcePicker = () => {
    if (!Object.keys(catMeta).length) {
      return (
        <div className="rs-card-meta" style={{ fontSize: '0.72rem', opacity: 0.5 }}>
          Loading source catalogue…
        </div>
      )
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '16px 28px',
        }}
      >
        {Object.entries(catMeta).map(([cat, meta]) => {
          const catSources = allSources.filter(s => s.category === cat)
          if (!catSources.length) return null
          return (
            <div key={cat}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span
                  className="material-symbols-rounded"
                  style={{ fontSize: '0.85rem', color: 'var(--md-on-surface-variant)', opacity: 0.7 }}
                >
                  {meta?.icon || 'rss_feed'}
                </span>
                <span className="rs-card-label" style={{ fontSize: '0.56rem', opacity: 0.6 }}>
                  {/* A category arriving without a label took the whole Feeds
                      page down with a render fault; fall back to its key. */}
                  {(meta?.label || cat).toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {catSources.map(src => {
                  const isOn = selected.some(s => s.url === src.url)
                  return (
                    <button
                      key={src.url}
                      className={`rs-pill ${isOn ? 'is-active' : ''}`}
                      onClick={() => {
                        const next = isOn
                          ? selected.filter(s => s.url !== src.url)
                          : [...selected, src]
                        saveSources(next)
                      }}
                      style={{ fontSize: '0.62rem' }}
                    >
                      {(src.name || src.url || '').toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const cats = [...new Set(articles.map(a => a.category).filter(Boolean))]

  return (
    <div>
      <InlineSettingsSection
        title="NEWS SOURCES"
        icon="rss_feed"
        subtitle={activeCount > 0 ? `${activeCount} active` : 'none selected'}
        defaultOpen={!loading && !error && articles.length === 0}
      >
        {renderSourcePicker()}
      </InlineSettingsSection>

      {loading ? (
        <NewsSkeletons />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchArticles} />
      ) : !articles.length ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <span
            className="material-symbols-rounded"
            style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}
          >
            newspaper
          </span>
          <div className="rs-card-label" style={{ marginBottom: 8 }}>NO SOURCES SELECTED</div>
          <div className="rs-card-meta">Expand the Sources panel above and pick a few feeds.</div>
        </div>
      ) : (
        <>
          {cats.length > 1 && (
            <div className="rs-feeds-chips">
              {cats.map(c => (
                /* Was .rs-pill, which is the control grammar — these are
                   labels and were being read as tappable filters. */
                <span key={c} className="rs-feeds-chip">{c.toUpperCase()}</span>
              ))}
            </div>
          )}
          <div className="rs-feed-list">
            {articles.map((a, i) => (
              <ArticleCard key={a.url || i} article={a} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ArticleCard({ article: a }) {
  const time = a.published_at
    ? new Date(a.published_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
  return (
    <article className="rs-feed-item" onClick={() => window.open(a.url, '_blank', 'noopener')}>
      {a.image_url && (
        <img
          src={a.image_url}
          alt=""
          loading="lazy"
          className="rs-feed-thumb"
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      <div className="rs-feed-main">
        <div className="rs-feed-meta">
          <span className="rs-feed-source">{a.source?.toUpperCase()}</span>
          {a.category && <span className="rs-feed-category">{a.category.toUpperCase()}</span>}
          {time && <span className="rs-feed-time">{time}</span>}
        </div>
        <h3 className="rs-feed-title">{a.title}</h3>
        {a.summary && <p className="rs-feed-summary">{a.summary}</p>}
      </div>
    </article>
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
