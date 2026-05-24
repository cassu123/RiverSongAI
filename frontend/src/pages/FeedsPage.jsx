import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import 'leaflet/dist/leaflet.css'

const FEED_DEFS = [
  { key: 'news',    prefKey: 'feed_news_enabled',    icon: 'newspaper',     label: 'NEWS' },
  { key: 'weather', prefKey: 'feed_weather_enabled', icon: 'cloud',          label: 'WEATHER' },
  { key: 'sports',  prefKey: 'feed_sports_enabled',  icon: 'sports_kabaddi', label: 'SPORTS' },
  { key: 'stocks',  prefKey: 'feed_stocks_enabled',  icon: 'trending_up',    label: 'MARKETS' },
  { key: 'flights', prefKey: 'feed_flights_enabled', icon: 'flight',         label: 'FLIGHTS' },
]

export default function FeedsPage({ setAction }) {
  const { token, user } = useAuth()

  const [activeTab, setActiveTab]     = useState('news')
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [configOpen, setConfigOpen]   = useState(true)

  const [news, setNews]       = useState([])
  const [weather, setWeather] = useState(null)
  const [sports, setSports]   = useState({ results: [], fixtures: [] })
  const [stocks, setStocks]   = useState([])
  const [flights, setFlights] = useState([])

  const [prefs, setPrefs]         = useState(null)
  const [allSources, setAllSources] = useState([])
  const [catMeta, setCatMeta]       = useState({})
  const [radarTs, setRadarTs]       = useState(null)

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch('/api/feeds/preferences', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setPrefs(await res.json())
      const sRes = await fetch('/api/feeds/news/sources')
      if (sRes.ok) {
        const data = await sRes.json()
        setAllSources(data.sources || [])
        setCatMeta(data.categories || {})
      }
    } catch (err) {
      console.warn('[FeedsPage] fetchPrefs failed:', err)
    }
  }, [token])

  const fetchFeed = useCallback(async (tab) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feeds/${tab}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Failed to load ${tab}.`)
      const data = await res.json()
      if (tab === 'news')    setNews(data)
      if (tab === 'weather') setWeather(data)
      if (tab === 'sports')  setSports(data)
      if (tab === 'stocks')  setStocks(data)
      if (tab === 'flights') setFlights(data.flights || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPrefs() }, [fetchPrefs])
  useEffect(() => { fetchFeed(activeTab) }, [activeTab, fetchFeed])

  useEffect(() => {
    if (activeTab === 'weather' && prefs?.weather_lat) {
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(r => r.json())
        .then(d => {
          const frames = d?.radar?.past || []
          if (frames.length) setRadarTs(frames[frames.length - 1].path)
        })
        .catch(err => console.warn('[FeedsPage] radar fetch failed:', err))
    }
  }, [activeTab, prefs])

  const saveSources = async (sources) => {
    const updated = { ...prefs, news_sources: sources }
    setPrefs(updated)
    await fetch('/api/feeds/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updated),
    })
    fetchFeed('news')
  }

  const savePrefsPatch = async (patch) => {
    const updated = { ...prefs, ...patch }
    setPrefs(updated)
    await fetch('/api/feeds/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updated),
    })
  }

  const enabledTabs = FEED_DEFS.filter(f => prefs?.[f.prefKey] !== false)

  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {enabledTabs.map(t => (
            <button
              key={t.key}
              className={`rs-pill ${activeTab === t.key ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <span className="material-symbols-rounded">{t.icon}</span>
              <span className="rs-speak-actions-label">{t.label}</span>
            </button>
          ))}
          <div style={{ width: 1, height: 24, background: 'var(--md-outline-variant)', margin: '0 4px' }} />
          <button className="rs-pill" onClick={() => fetchFeed(activeTab)}>
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
  }, [activeTab, prefs, setAction, fetchFeed, enabledTabs])

  const activeSourceCount = (prefs?.news_sources || []).length

  const hasCurrentTabData = (
    (activeTab === 'news'    && news.length > 0) ||
    (activeTab === 'weather' && weather !== null) ||
    (activeTab === 'sports'  && (sports.results?.length > 0 || sports.fixtures?.length > 0)) ||
    (activeTab === 'stocks'  && stocks.length > 0) ||
    (activeTab === 'flights' && flights.length > 0)
  )

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head" style={{ marginBottom: 24 }}>
        <h1 className="rs-greeting">Global Intelligence</h1>
        <div className="rs-greeting-sub">Live feeds, weather, sports, markets, and air traffic.</div>
      </div>

      {/* ── Inline config panel ─────────────────────────────────────────── */}
      <div
        className="rs-card is-wide"
        style={{ marginBottom: 32, overflow: 'hidden' }}
      >
        {/* Header row — always visible, acts as toggle */}
        <div
          onClick={() => setConfigOpen(o => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <span className="rs-card-label" style={{ letterSpacing: '0.1em' }}>CONFIGURATION</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Feed status dots — always shown */}
            <div style={{ display: 'flex', gap: 10 }}>
              {FEED_DEFS.map(f => {
                const on = prefs?.[f.prefKey] !== false
                return (
                  <span
                    key={f.key}
                    title={f.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: '0.58rem',
                      fontWeight: 800,
                      letterSpacing: '0.07em',
                      color: on ? 'var(--primary)' : 'var(--md-on-surface-variant)',
                      opacity: on ? 1 : 0.3,
                      transition: 'opacity 0.2s',
                    }}
                  >
                    <span
                      className="material-symbols-rounded"
                      style={{ fontSize: '0.8rem' }}
                    >
                      {f.icon}
                    </span>
                    {f.label}
                  </span>
                )
              })}
            </div>

            {/* Source count badge — news only */}
            {prefs && activeSourceCount > 0 && (
              <span
                className="rs-card-label"
                style={{
                  fontSize: '0.56rem',
                  color: 'var(--md-on-surface-variant)',
                  opacity: 0.5,
                }}
              >
                {activeSourceCount} {activeSourceCount === 1 ? 'SOURCE' : 'SOURCES'}
              </span>
            )}

            <span
              className="material-symbols-rounded"
              style={{
                fontSize: '1.1rem',
                color: 'var(--md-on-surface-variant)',
                transition: 'transform 0.22s ease',
                transform: configOpen ? 'rotate(180deg)' : 'none',
              }}
            >
              expand_more
            </span>
          </div>
        </div>

        {/* Expanded body */}
        {configOpen && (
          <div
            className="animate-fade-in"
            style={{ borderTop: '1px solid var(--md-outline-variant)', padding: '20px 20px 24px' }}
          >
            {/* Feed toggles */}
            <div style={{ marginBottom: activeTab === 'news' ? 24 : 0 }}>
              <div
                className="rs-card-label"
                style={{ marginBottom: 12, fontSize: '0.58rem', opacity: 0.6 }}
              >
                ACTIVE FEEDS
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {FEED_DEFS.map(f => {
                  const on = prefs?.[f.prefKey] !== false
                  return (
                    <button
                      key={f.key}
                      className={`rs-pill ${on ? 'is-active' : ''}`}
                      onClick={() => savePrefsPatch({ [f.prefKey]: !on })}
                    >
                      <span className="material-symbols-rounded">{f.icon}</span>
                      <span className="rs-speak-actions-label">{f.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* News sources — only visible when on the news tab */}
            {activeTab === 'news' && (
              <div style={{ borderTop: '1px solid var(--md-outline-variant)', paddingTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <div className="rs-card-label" style={{ fontSize: '0.58rem', opacity: 0.6 }}>
                    NEWS SOURCES
                  </div>
                  {activeSourceCount > 0 && (
                    <span
                      className="rs-card-label"
                      style={{ fontSize: '0.58rem', color: 'var(--primary)', opacity: 0.8 }}
                    >
                      {activeSourceCount} ACTIVE
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '16px 32px',
                  }}
                >
                  {Object.entries(catMeta).map(([cat, meta]) => {
                    const catSources = allSources.filter(s => s.category === cat)
                    if (!catSources.length) return null
                    return (
                      <div key={cat}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 8,
                          }}
                        >
                          <span
                            className="material-symbols-rounded"
                            style={{
                              fontSize: '0.85rem',
                              color: 'var(--md-on-surface-variant)',
                              opacity: 0.7,
                            }}
                          >
                            {meta.icon}
                          </span>
                          <span
                            className="rs-card-label"
                            style={{ fontSize: '0.56rem', opacity: 0.6 }}
                          >
                            {meta.label.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {catSources.map(src => {
                            const active = (prefs?.news_sources || []).some(
                              s => s.url === src.url
                            )
                            return (
                              <button
                                key={src.url}
                                className={`rs-pill ${active ? 'is-active' : ''}`}
                                onClick={() => {
                                  const current = prefs?.news_sources || []
                                  const next = active
                                    ? current.filter(s => s.url !== src.url)
                                    : [...current, src]
                                  saveSources(next)
                                }}
                                style={{ fontSize: '0.62rem' }}
                              >
                                {src.name.toUpperCase()}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Feed content ────────────────────────────────────────────────── */}
      {error ? (
        <div className="rs-card is-wide" style={{ borderColor: 'var(--md-error)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>ERROR</div>
            <div className="rs-card-meta">{error}</div>
            <button
              className="rs-pill"
              style={{ marginTop: 16 }}
              onClick={() => fetchFeed(activeTab)}
            >
              RETRY
            </button>
          </div>
        </div>
      ) : loading && !hasCurrentTabData ? (
        <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>
          Loading {activeTab}...
        </div>
      ) : (
        <div className="animate-page-in">
          {activeTab === 'news'    && renderNews(news)}
          {activeTab === 'weather' && renderWeather(weather, prefs, radarTs)}
          {activeTab === 'sports'  && renderSports(sports)}
          {activeTab === 'stocks'  && renderStocks(stocks)}
          {activeTab === 'flights' && renderFlights(flights)}
        </div>
      )}
    </div>
  )
}

/* ── Feed renderers (pure functions) ──────────────────────────────────────── */

function renderNews(news) {
  return (
    <div className="rs-card-flow">
      {news.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>
          No news sources selected. Use the Sources panel above to add feeds.
        </div>
      ) : (
        news.map((item, i) => (
          <div
            key={i}
            className="rs-card is-tappable animate-page-in"
            style={{ padding: 0, overflow: 'hidden' }}
            onClick={() => window.open(item.url, '_blank')}
          >
            <div
              className="rs-card-inner"
              style={{ padding: 0, border: 'none', background: 'transparent' }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '16/10',
                  overflow: 'hidden',
                  background: 'var(--md-surface-container-highest)',
                }}
              >
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.1,
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '4rem' }}>
                      satellite_alt
                    </span>
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 60%)',
                  }}
                />
                <div style={{ position: 'absolute', top: 12, left: 12 }}>
                  <span
                    className="rs-pill"
                    style={{
                      background: 'rgba(0,0,0,0.6)',
                      backdropFilter: 'blur(10px)',
                      fontSize: '0.6rem',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {item.source?.toUpperCase()}
                  </span>
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div
                  className="rs-card-value"
                  style={{ fontSize: '1.15rem', lineHeight: 1.25, fontWeight: 700, marginBottom: 12 }}
                >
                  {item.title}
                </div>
                <div
                  className="rs-card-meta"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    fontSize: '0.85rem',
                  }}
                >
                  {item.summary}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: 0.5,
                  }}
                >
                  <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>
                    {new Date(item.published_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>
                    arrow_forward
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function renderWeather(weather, prefs, radarTs) {
  if (!weather)
    return (
      <div className="rs-card-flow">
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>
          Weather unavailable. Set your location in Feed Settings.
        </div>
      </div>
    )

  const { current = {}, daily = [] } = weather
  return (
    <div className="rs-card-flow">
      <div className="rs-card is-wide is-elev">
        <div className="rs-card-inner">
          <div className="rs-card-head">
            <span className="rs-card-label">CURRENT CONDITIONS</span>
            <span className="rs-card-label">{weather.location_name?.toUpperCase()}</span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 64,
              flexWrap: 'wrap',
              padding: '12px 0',
            }}
          >
            <div
              style={{
                fontSize: '5.5rem',
                fontWeight: 900,
                letterSpacing: '-0.08em',
                color: 'var(--primary)',
                lineHeight: 1,
              }}
            >
              {Math.round(current.temperature)}°
            </div>
            <div style={{ flex: 1 }}>
              <div
                className="rs-card-value"
                style={{ fontSize: '2rem', textTransform: 'uppercase' }}
              >
                {current.condition}
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                <div>
                  <div className="rs-card-label">FEELS LIKE</div>
                  <div
                    className="rs-card-value"
                    style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}
                  >
                    {Math.round(current.feels_like)}°
                  </div>
                </div>
                <div>
                  <div className="rs-card-label">WIND</div>
                  <div
                    className="rs-card-value"
                    style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}
                  >
                    {current.wind_speed}{' '}
                    <small style={{ fontSize: '0.6rem' }}>KM/H</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 24,
          width: '100%',
        }}
      >
        <div className="rs-card">
          <div className="rs-card-inner">
            <div className="rs-card-label" style={{ marginBottom: 20 }}>7-DAY FORECAST</div>
            {daily.slice(1, 8).map((day, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: i < 6 ? '1px solid var(--md-outline-variant)' : 'none',
                }}
              >
                <span style={{ fontWeight: 800, width: 50 }}>
                  {new Date(day.date)
                    .toLocaleDateString('en-US', { weekday: 'short' })
                    .toUpperCase()}
                </span>
                <span
                  className="rs-card-meta"
                  style={{ flex: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}
                >
                  {day.condition}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {Math.round(day.temp_max)}° / {Math.round(day.temp_min)}°
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rs-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            className="rs-card-label"
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
              zIndex: 10,
              background: 'rgba(0,0,0,0.5)',
              padding: '4px 12px',
              borderRadius: 20,
            }}
          >
            LIVE RADAR
          </div>
          <RadarMap lat={prefs?.weather_lat} lon={prefs?.weather_lon} radarTs={radarTs} />
        </div>
      </div>
    </div>
  )
}

function renderSports(sports) {
  return (
    <div className="rs-card-flow">
      {!sports.results?.length && !sports.fixtures?.length ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>
          No sports data found. Add teams in Feed Settings.
        </div>
      ) : (
        <>
          {sports.results?.map((res, i) => (
            <div key={`res-${i}`} className="rs-card animate-page-in">
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <span className="rs-card-label" style={{ color: '#4ade80' }}>FINAL</span>
                  <span className="rs-card-label">{res.league_id?.toUpperCase()}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 0',
                  }}
                >
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>
                      {res.home_team}
                    </div>
                    <div
                      style={{
                        fontSize: '2.5rem',
                        fontWeight: 900,
                        color: res.home_winner ? 'var(--primary)' : 'inherit',
                      }}
                    >
                      {res.home_score}
                    </div>
                  </div>
                  <div style={{ opacity: 0.2, fontWeight: 900, fontSize: '1.5rem' }}>:</div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>
                      {res.away_team}
                    </div>
                    <div
                      style={{
                        fontSize: '2.5rem',
                        fontWeight: 900,
                        color: res.away_winner ? 'var(--primary)' : 'inherit',
                      }}
                    >
                      {res.away_score}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {sports.fixtures?.map((fix, i) => (
            <div key={`fix-${i}`} className="rs-card animate-page-in">
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <span
                    className="rs-card-label"
                    style={{ color: fix.is_live ? '#f87171' : 'var(--md-on-surface-variant)' }}
                  >
                    {fix.is_live ? 'LIVE' : 'UPCOMING'}
                  </span>
                  <span className="rs-card-label">{fix.league_id?.toUpperCase()}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 0',
                  }}
                >
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>
                      {fix.home_team}
                    </div>
                    {fix.is_live && (
                      <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{fix.home_score}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', opacity: fix.is_live ? 0.2 : 0.6 }}>
                    {fix.is_live ? (
                      <span style={{ fontWeight: 900, fontSize: '1.5rem' }}>:</span>
                    ) : (
                      <div
                        style={{
                          fontSize: '0.7rem',
                          fontFamily: 'var(--font-mono)',
                          lineHeight: 1.6,
                        }}
                      >
                        {new Date(fix.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                        <br />
                        {new Date(fix.date).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>
                      {fix.away_team}
                    </div>
                    {fix.is_live && (
                      <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{fix.away_score}</div>
                    )}
                  </div>
                </div>
                {fix.venue && (
                  <div
                    className="rs-card-meta"
                    style={{ fontSize: '0.65rem', textAlign: 'center', marginTop: 4 }}
                  >
                    {fix.venue}
                  </div>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function renderStocks(stocks) {
  return (
    <div className="rs-card-flow">
      {stocks.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>
          No tickers saved. Add stocks in Feed Settings.
        </div>
      ) : (
        stocks.map((s, i) => (
          <div key={i} className="rs-card animate-page-in">
            <div className="rs-card-inner">
              <div className="rs-card-head">
                <span
                  className="rs-card-label"
                  style={{ fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}
                >
                  {s.ticker}
                </span>
                <div
                  className="rs-status-strip"
                  style={{
                    background:
                      s.change >= 0 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                    color: s.change >= 0 ? '#4ade80' : '#f87171',
                  }}
                >
                  {s.change >= 0 ? '▲' : '▼'} {Math.abs(s.change_pct)?.toFixed(2)}%
                </div>
              </div>
              <div
                className="rs-card-value"
                style={{
                  fontSize: '2.4rem',
                  fontWeight: 900,
                  margin: '8px 0',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ${s.price?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              {s.name && (
                <div className="rs-card-meta" style={{ fontWeight: 700 }}>
                  {s.name}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function renderFlights(flights) {
  return (
    <div className="rs-card-flow">
      {flights.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>
          No aircraft detected overhead.
        </div>
      ) : (
        flights.map((f, i) => (
          <div key={i} className="rs-card animate-page-in">
            <div className="rs-card-inner">
              <div className="rs-card-head">
                <span
                  className="rs-card-label"
                  style={{ fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}
                >
                  {f.callsign || 'UNKNOWN'}
                </span>
                <div
                  className="rs-status-strip"
                  style={{
                    background: f.on_ground
                      ? 'rgba(248,113,113,0.1)'
                      : 'rgba(74,222,128,0.1)',
                    color: f.on_ground ? '#f87171' : '#4ade80',
                  }}
                >
                  {f.on_ground ? 'GROUNDED' : 'AIRBORNE'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                <div>
                  <div className="rs-card-label">ALTITUDE</div>
                  <div
                    className="rs-card-value"
                    style={{ fontSize: '1.4rem', fontFamily: 'var(--font-mono)' }}
                  >
                    {f.baro_altitude_m != null
                      ? Math.round(f.baro_altitude_m * 3.28084).toLocaleString()
                      : '--'}
                    <small style={{ fontSize: '0.6rem' }}> FT</small>
                  </div>
                </div>
                <div>
                  <div className="rs-card-label">SPEED</div>
                  <div
                    className="rs-card-value"
                    style={{ fontSize: '1.4rem', fontFamily: 'var(--font-mono)' }}
                  >
                    {f.velocity_mps != null ? Math.round(f.velocity_mps * 1.94384) : '--'}
                    <small style={{ fontSize: '0.6rem' }}> KTS</small>
                  </div>
                </div>
                {f.country && (
                  <div>
                    <div className="rs-card-label">ORIGIN</div>
                    <div className="rs-card-value" style={{ fontSize: '1rem' }}>
                      {f.country}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/* ── Radar map ────────────────────────────────────────────────────────────── */

function RadarMap({ lat, lon, radarTs }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const radarLayerRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || !lat || !lon) return
    import('leaflet').then(L => {
      if (instanceRef.current) return
      const map = L.map(mapRef.current, {
        center: [lat, lon],
        zoom: 8,
        zoomControl: false,
        attributionControl: false,
      })
      instanceRef.current = map
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      ).addTo(map)
    })
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove()
        instanceRef.current = null
      }
    }
  }, [lat, lon])

  useEffect(() => {
    if (!instanceRef.current || !radarTs) return
    import('leaflet').then(L => {
      if (radarLayerRef.current) instanceRef.current.removeLayer(radarLayerRef.current)
      radarLayerRef.current = L.tileLayer(
        `https://tilecache.rainviewer.com${radarTs}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0.6 }
      )
      radarLayerRef.current.addTo(instanceRef.current)
    })
  }, [radarTs])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />
}
