import React, { useState, useEffect, useCallback, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import './FeedsPage.css'

const API = '/api/feeds'

function authHeaders() {
  const token = localStorage.getItem('rs-auth-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

const TABS = [
  { key: 'news',    label: 'News',    icon: <IconNews /> },
  { key: 'weather', label: 'Weather', icon: <IconWeather /> },
  { key: 'sports',  label: 'Sports',  icon: <IconSports /> },
  { key: 'stocks',  label: 'Stocks',  icon: <IconStocks /> },
]

const REFRESH_OPTIONS = [
  { value: 5,   label: '5 min' },
  { value: 15,  label: '15 min' },
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 360, label: '6 hours' },
]

export default function FeedsPage() {
  const [tab, setTab] = useState('news')
  const [prefs, setPrefs] = useState(null)
  const [prefsLoading, setPrefsLoading] = useState(true)

  useEffect(() => {
    apiFetch('/preferences')
      .then(setPrefs)
      .catch(() => setPrefs({
        news_sources: [], weather_lat: null, weather_lon: null, weather_unit: 'celsius',
        sport_teams: [], stock_tickers: [], refresh_news_min: 30,
        refresh_weather_min: 30, refresh_sports_min: 60, refresh_stocks_min: 60,
      }))
      .finally(() => setPrefsLoading(false))
  }, [])

  const savePrefs = useCallback(async (updated) => {
    const merged = { ...prefs, ...updated }
    setPrefs(merged)
    await apiFetch('/preferences', { method: 'PUT', body: JSON.stringify(merged) })
  }, [prefs])

  if (prefsLoading) return (
    <div className="page-wrap">
      <div className="feeds-loading">Loading preferences…</div>
    </div>
  )

  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>DATA</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>FEEDS</span>
      </div>
      <h1 className="page-title">Feeds</h1>
      <p className="page-subtitle">Live data streams River can read, summarise, and discuss with you.</p>

      <div className="feeds-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`feeds-tab${tab === t.key ? ' feeds-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="feeds-body">
        {tab === 'news'    && <NewsTab    prefs={prefs} savePrefs={savePrefs} />}
        {tab === 'weather' && <WeatherTab prefs={prefs} savePrefs={savePrefs} />}
        {tab === 'sports'  && <SportsTab  prefs={prefs} savePrefs={savePrefs} />}
        {tab === 'stocks'  && <StocksTab  prefs={prefs} savePrefs={savePrefs} />}
      </div>
    </div>
  )
}

// =============================================================================
// NEWS TAB
// =============================================================================

const SOURCE_CAT_COLORS = {
  world:         '#96CBFF',
  us:            '#B6C9D9',
  local:         '#FFB86C',
  technology:    '#D9BBFF',
  business:      '#FFD080',
  sports:        '#80E8A0',
  nfl:           '#80D0E0',
  nba:           '#F0A080',
  mlb:           '#A0D8A0',
  nhl:           '#A0C8F0',
  nascar:        '#F0E080',
  entertainment: '#E0A8F0',
  health:        '#88EEB8',
  science:       '#88D0FF',
  sport:         '#80E8A0',  // legacy compat
}

const SPORTS_CATS = new Set(['sports', 'nfl', 'nba', 'mlb', 'nhl', 'nascar'])

const ESPN_LEAGUES_STUB = new Set(['f1', 'nascar', 'ufc', 'boxing', 'rugby', 'cricket', 'afl', 'esports'])

function NewsTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [allSources, setAllSources]     = useState([])
  const [catMeta, setCatMeta]           = useState({})  // { key: {label, icon} }
  const [articles, setArticles]         = useState([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [search, setSearch]             = useState('')
  const [activeCat, setActiveCat]       = useState('all')
  const [view, setView]                 = useState('card') // 'card' | 'list'
  const [readIds, setReadIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('rs-news-read') || '[]')) }
    catch { return new Set() }
  })
  const [secondsLeft, setSecondsLeft] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    apiFetch('/news/sources')
      .then(data => {
        if (Array.isArray(data)) {
          setAllSources(data)
        } else {
          setAllSources(data.sources || [])
          setCatMeta(data.categories || {})
        }
      })
      .catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!prefs?.news_sources?.length) return
    setLoading(true)
    setError('')
    apiFetch('/news')
      .then(data => { setArticles(data); startTimer() })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [prefs?.news_sources]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  const startTimer = useCallback(() => {
    const mins = prefs?.refresh_news_min || 30
    setSecondsLeft(mins * 60)
  }, [prefs?.refresh_news_min])

  useEffect(() => {
    if (secondsLeft <= 0) return
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { load(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [secondsLeft, load])

  const markRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('rs-news-read', JSON.stringify([...next]))
      return next
    })
  }

  const categories = ['all', ...new Set(allSources.map(s => s.category))]

  const toggleSource = (src) => {
    const current = prefs.news_sources || []
    const exists = current.find(s => s.url === src.url)
    const updated = exists ? current.filter(s => s.url !== src.url) : [...current, src]
    savePrefs({ news_sources: updated })
  }
  const isSelected = (src) => (prefs?.news_sources || []).some(s => s.url === src.url)

  const isNew = (pub) => {
    if (!pub) return false
    return (Date.now() - new Date(pub).getTime()) < 2 * 60 * 60 * 1000
  }

  const filtered = articles.filter(a => {
    if (SPORTS_CATS.has(a.category)) return false
    if (activeCat !== 'all' && a.category !== activeCat) return false
    if (search) {
      const q = search.toLowerCase()
      return (a.title + a.summary + a.source).toLowerCase().includes(q)
    }
    return true
  })

  const refreshMins = prefs?.refresh_news_min || 30
  const totalSecs = refreshMins * 60
  const progressPct = totalSecs > 0 ? ((totalSecs - secondsLeft) / totalSecs) * 100 : 0
  const minsLeft = Math.floor(secondsLeft / 60)
  const secsLeft = secondsLeft % 60

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">
          Latest Headlines
          {articles.length > 0 && <span style={{ marginLeft: 8, color: 'var(--text-dim)', fontFamily: 'var(--font-body)', fontSize: '0.8rem', letterSpacing: 0 }}>{filtered.length} articles</span>}
        </span>
        <button className="feeds-gear-btn" onClick={() => setShowSettings(s => !s)}>
          <IconGear /> {showSettings ? 'Close' : 'Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="feeds-settings-panel">
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">News sources</span>
            {[...new Set(allSources.map(s => s.category))].map(cat => {
              const meta  = catMeta[cat] || {}
              const label = meta.label || cat
              const color = SOURCE_CAT_COLORS[cat] || 'var(--md-on-surface-variant)'
              const sourcesInCat = allSources.filter(s => s.category === cat)
              const selectedCount = sourcesInCat.filter(s => isSelected(s)).length
              return (
                <div key={cat}>
                  <div className="feeds-sports-section-title" style={{ marginTop: 14, color }}>
                    {label}
                    {selectedCount > 0 && (
                      <span style={{
                        marginLeft: 8, fontSize: '0.625rem', fontWeight: 500,
                        background: color + '22', color, borderRadius: 10, padding: '1px 7px',
                      }}>
                        {selectedCount} selected
                      </span>
                    )}
                  </div>
                  <div className="feeds-source-category-grid">
                    {sourcesInCat.map(src => (
                      <button
                        key={src.url}
                        className={`feeds-source-cat-btn${isSelected(src) ? ' feeds-source-cat-btn--active' : ''}`}
                        style={isSelected(src) ? { '--cat-color': color, borderColor: color, color } : {}}
                        onClick={() => toggleSource(src)}
                      >
                        {src.name} {isSelected(src) && '✓'}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select className="feeds-refresh-select" value={prefs.refresh_news_min}
              onChange={e => savePrefs({ refresh_news_min: Number(e.target.value) })}>
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>Apply & Refresh</button>
          </div>
        </div>
      )}

      {!prefs?.news_sources?.length && (
        <div className="feeds-empty">No sources selected. Open Settings to pick your news sources.</div>
      )}

      {prefs?.news_sources?.length > 0 && (
        <div className="feeds-news-toolbar">
          <div className="feeds-news-toolbar-row">
            <input
              className="feeds-news-search"
              placeholder="Search headlines…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="feeds-view-toggle">
              <button className={`feeds-view-btn${view === 'card' ? ' feeds-view-btn--active' : ''}`} onClick={() => setView('card')} title="Card view">▦</button>
              <button className={`feeds-view-btn${view === 'list' ? ' feeds-view-btn--active' : ''}`} onClick={() => setView('list')} title="List view">☰</button>
            </div>
          </div>

          {categories.length > 1 && (
            <div className="feeds-cat-pills">
              {categories.map(cat => (
                <button
                  key={cat}
                  className={`feeds-cat-pill${activeCat === cat ? ' feeds-cat-pill--active' : ''}`}
                  onClick={() => setActiveCat(cat)}
                  style={activeCat === cat && cat !== 'all' ? { borderColor: SOURCE_CAT_COLORS[cat], color: SOURCE_CAT_COLORS[cat] } : {}}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {secondsLeft > 0 && (
            <div className="feeds-refresh-bar">
              <div className="feeds-refresh-progress">
                <div className="feeds-refresh-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span>Refresh in {minsLeft}:{String(secsLeft).padStart(2, '0')}</span>
              <button className="feeds-refresh-now-btn" onClick={load}>Refresh now</button>
            </div>
          )}
        </div>
      )}

      {loading && <div className="feeds-loading">Fetching headlines…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {!loading && filtered.length > 0 && view === 'card' && (
        <div className="feeds-news-grid">
          {filtered.map(a => (
            <a
              key={a.id || a.url}
              className={`feeds-news-card${readIds.has(a.id) ? ' feeds-news-card--read' : ''}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => markRead(a.id)}
            >
              {a.image_url
                ? <img className="feeds-news-card-img" src={a.image_url} alt="" loading="lazy" onError={e => { e.target.style.display = 'none' }} />
                : <div className="feeds-news-card-img-placeholder" style={{ background: `${SOURCE_CAT_COLORS[a.category] || '#0a2236'}22` }}>
                    📰
                  </div>
              }
              <div className="feeds-news-card-body">
                <div className="feeds-news-meta-row">
                  <span className="feeds-news-source" style={{ color: SOURCE_CAT_COLORS[a.category] || 'var(--primary)' }}>{a.source}</span>
                  {isNew(a.published_at) && <span className="feeds-news-new-badge">NEW</span>}
                </div>
                <span className="feeds-news-title">{a.title}</span>
                {a.summary && <span className="feeds-news-summary">{a.summary}</span>}
                <span className="feeds-news-date">{formatDate(a.published_at)}</span>
              </div>
            </a>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && view === 'list' && (
        <div className="feeds-news-list">
          {filtered.map(a => (
            <a
              key={a.id || a.url}
              className={`feeds-news-list-item${readIds.has(a.id) ? ' feeds-news-list-item--read' : ''}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => markRead(a.id)}
            >
              {a.image_url && <img className="feeds-news-list-thumb" src={a.image_url} alt="" loading="lazy" onError={e => { e.target.style.display = 'none' }} />}
              <div className="feeds-news-list-text">
                <div className="feeds-news-list-title">{a.title}</div>
                <div className="feeds-news-list-meta">
                  <span style={{ color: SOURCE_CAT_COLORS[a.category] || 'var(--primary)' }}>{a.source}</span>
                  <span>{formatDate(a.published_at)}</span>
                  {isNew(a.published_at) && <span style={{ color: 'var(--primary)' }}>● NEW</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {!loading && !error && prefs?.news_sources?.length > 0 && filtered.length === 0 && articles.length > 0 && (
        <div className="feeds-empty">No articles match your filter.</div>
      )}
    </>
  )
}

// =============================================================================
// WEATHER TAB
// =============================================================================

const UV_LEVELS = [
  { max: 2,  label: 'Low',       color: '#00cc44' },
  { max: 5,  label: 'Moderate',  color: '#ffcc00' },
  { max: 7,  label: 'High',      color: '#ff8800' },
  { max: 10, label: 'Very High', color: '#ff3300' },
  { max: 99, label: 'Extreme',   color: '#9933cc' },
]

function uvInfo(uv) {
  if (uv == null) return null
  return UV_LEVELS.find(l => uv <= l.max) || UV_LEVELS[UV_LEVELS.length - 1]
}

function WindArrow({ degrees }) {
  return (
    <span
      className="feeds-wind-arrow"
      style={{ transform: `rotate(${degrees}deg)` }}
      title={`${degrees}°`}
    >↑</span>
  )
}

function WeatherTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [weather, setWeather]           = useState(null)
  const [alerts, setAlerts]             = useState([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [locating, setLocating]         = useState(false)
  const [radarFrames, setRadarFrames]   = useState([])
  const [secondsLeft, setSecondsLeft]   = useState(0)
  const [expandedAlerts, setExpandedAlerts] = useState(new Set())
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const timerRef      = useRef(null)
  const alertPollRef  = useRef(null)
  const seenAlertIds  = useRef(new Set(
    JSON.parse(localStorage.getItem('rs-seen-alerts') || '[]')
  ))

  const loadAlerts = useCallback(async () => {
    if (prefs?.weather_lat == null) return
    try {
      const al = await apiFetch('/weather/alerts')
      const incoming = al.alerts || []
      setAlerts(incoming)

      const newCritical = incoming.filter(a =>
        (a.severity === 'Extreme' || a.severity === 'Severe') &&
        !seenAlertIds.current.has(a.id)
      )
      newCritical.forEach(a => {
        seenAlertIds.current.add(a.id)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification(`⚠ ${a.event}`, {
            body: a.headline,
            tag: a.id,
            icon: '/favicon.ico',
          })
        }
      })
      if (newCritical.length) {
        localStorage.setItem('rs-seen-alerts', JSON.stringify([...seenAlertIds.current]))
      }
    } catch (_) { }
  }, [prefs?.weather_lat, prefs?.weather_lon])

  const load = useCallback(() => {
    if (prefs?.weather_lat == null) return
    setLoading(true)
    setError('')
    apiFetch('/weather')
      .then(wx => { setWeather(wx); startTimer() })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    loadAlerts()
  }, [prefs?.weather_lat, prefs?.weather_lon, prefs?.weather_unit]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (prefs?.weather_lat == null) return
    alertPollRef.current = setInterval(loadAlerts, 5 * 60 * 1000)
    return () => clearInterval(alertPollRef.current)
  }, [loadAlerts])

  useEffect(() => {
    if (prefs?.weather_lat == null) return
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(d => { const f = d?.radar?.past || []; if (f.length) setRadarFrames(f) })
      .catch(() => {})
  }, [prefs?.weather_lat])

  const startTimer = useCallback(() => {
    const mins = prefs?.refresh_weather_min || 30
    setSecondsLeft(mins * 60)
  }, [prefs?.refresh_weather_min])

  useEffect(() => {
    if (secondsLeft <= 0) return
    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { load(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [secondsLeft, load])

  const getLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        savePrefs({ weather_lat: pos.coords.latitude, weather_lon: pos.coords.longitude })
        setLocating(false)
      },
      () => { setError('Location permission denied.'); setLocating(false) }
    )
  }

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setNotifPermission(result)
  }

  const toggleAlertExpand = (id) => {
    setExpandedAlerts(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const criticalAlerts = alerts.filter(a => a.severity === 'Extreme' || a.severity === 'Severe')
  const refreshMins  = prefs?.refresh_weather_min || 30
  const totalSecs    = refreshMins * 60
  const progressPct  = totalSecs > 0 ? ((totalSecs - secondsLeft) / totalSecs) * 100 : 0
  const minsLeft     = Math.floor(secondsLeft / 60)
  const secsLeft     = secondsLeft % 60

  return (
    <>
      {criticalAlerts.length > 0 && (
        <div className="feeds-alert-banner" style={{ borderColor: criticalAlerts[0].color, background: criticalAlerts[0].color + '18' }}>
          <span className="feeds-alert-banner-icon">⚠</span>
          <span className="feeds-alert-banner-text" style={{ color: criticalAlerts[0].color }}>
            {criticalAlerts.length === 1
              ? criticalAlerts[0].event
              : `${criticalAlerts.length} active ${criticalAlerts[0].severity.toLowerCase()} alerts`}
          </span>
          <span className="feeds-alert-banner-sub">{criticalAlerts[0].headline}</span>
        </div>
      )}

      <div className="feeds-section-header">
        <span className="feeds-section-title">
          {weather?.location_name || 'Current Weather'}
        </span>
        <button className="feeds-gear-btn" onClick={() => setShowSettings(s => !s)}>
          <IconGear /> {showSettings ? 'Close' : 'Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="feeds-settings-panel">
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Location</span>
            <div className="feeds-location-row">
              <button className="btn--primary" onClick={getLocation} disabled={locating}>
                {locating ? 'Locating…' : 'Use My Location'}
              </button>
              {prefs?.weather_lat != null && (
                <span className="feeds-coords">
                  {prefs.weather_lat.toFixed(4)}, {prefs.weather_lon.toFixed(4)}
                </span>
              )}
            </div>
          </div>
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Temperature unit</span>
            <select className="feeds-refresh-select" value={prefs.weather_unit}
              onChange={e => savePrefs({ weather_unit: e.target.value })}>
              <option value="celsius">Celsius (°C)</option>
              <option value="fahrenheit">Fahrenheit (°F)</option>
            </select>
          </div>
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select className="feeds-refresh-select" value={prefs.refresh_weather_min}
              onChange={e => savePrefs({ refresh_weather_min: Number(e.target.value) })}>
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Severe weather notifications</span>
            {notifPermission === 'unsupported' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Not supported in this browser.</span>
            )}
            {notifPermission === 'granted' && (
              <span style={{ fontSize: '0.8rem', color: '#00cc44' }}>✓ Enabled — you'll be alerted for Extreme and Severe events.</span>
            )}
            {notifPermission === 'denied' && (
              <span style={{ fontSize: '0.8rem', color: 'var(--error)' }}>Blocked — enable notifications for this site in your browser settings.</span>
            )}
            {notifPermission === 'default' && (
              <button className="btn--primary" onClick={requestNotifications}>
                Enable Notifications
              </button>
            )}
          </div>
          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>
              Apply & Refresh
            </button>
          </div>
        </div>
      )}

      {prefs?.weather_lat == null && (
        <div className="feeds-empty">No location set. Open Settings and click "Use My Location".</div>
      )}

      {loading && <div className="feeds-loading">Fetching weather…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {weather && !loading && (
        <>
          {secondsLeft > 0 && (
            <div className="feeds-refresh-bar">
              <div className="feeds-refresh-progress">
                <div className="feeds-refresh-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span>Refresh in {minsLeft}:{String(secsLeft).padStart(2, '0')}</span>
              <button className="feeds-refresh-now-btn" onClick={load}>Refresh now</button>
            </div>
          )}

          <div className="feeds-weather-current">
            <div className="feeds-weather-current-primary">
              <div className="feeds-weather-temp">
                {Math.round(weather.current.temperature)}{weather.unit}
              </div>
              <div className="feeds-wx-icon" style={{ fontSize: '2.5rem' }}>{wmoIcon(weather.current.weathercode)}</div>
              <div className="feeds-weather-condition">{weather.current.condition}</div>
            </div>
            <div className="feeds-weather-detail-grid">
              <div className="feeds-weather-detail-item">
                <span className="feeds-weather-detail-label">Feels like</span>
                <span className="feeds-weather-detail-val">{Math.round(weather.current.feels_like)}{weather.unit}</span>
              </div>
              <div className="feeds-weather-detail-item">
                <span className="feeds-weather-detail-label">Humidity</span>
                <span className="feeds-weather-detail-val">{weather.current.humidity}%</span>
              </div>
              <div className="feeds-weather-detail-item">
                <span className="feeds-weather-detail-label">Wind</span>
                <span className="feeds-weather-detail-val">
                  {weather.current.wind_direction != null && <WindArrow degrees={weather.current.wind_direction} />}
                  {' '}{weather.current.wind_speed} {weather.current.wind_unit}
                </span>
              </div>
              {weather.current.wind_gusts != null && (
                <div className="feeds-weather-detail-item">
                  <span className="feeds-weather-detail-label">Gusts</span>
                  <span className="feeds-weather-detail-val">{weather.current.wind_gusts} {weather.current.wind_unit}</span>
                </div>
              )}
              {weather.current.visibility != null && (
                <div className="feeds-weather-detail-item">
                  <span className="feeds-weather-detail-label">Visibility</span>
                  <span className="feeds-weather-detail-val">
                    {weather.current.visibility >= 1000
                      ? `${(weather.current.visibility / 1000).toFixed(0)} km`
                      : `${weather.current.visibility} m`}
                  </span>
                </div>
              )}
              {weather.current.uv_index != null && (() => {
                const uv = uvInfo(weather.current.uv_index)
                return (
                  <div className="feeds-weather-detail-item">
                    <span className="feeds-weather-detail-label">UV Index</span>
                    <span className="feeds-uv-badge" style={{ color: uv.color }}>
                      {weather.current.uv_index} <span style={{ fontSize: '0.68rem' }}>{uv.label}</span>
                    </span>
                  </div>
                )
              })()}
              {weather.current.precipitation > 0 && (
                <div className="feeds-weather-detail-item">
                  <span className="feeds-weather-detail-label">Precip</span>
                  <span className="feeds-weather-detail-val">{weather.current.precipitation} mm</span>
                </div>
              )}
            </div>
          </div>

          {alerts.length > 0 && (
            <>
              <div className="feeds-subsection-label" style={{ color: alerts[0].color }}>
                ⚠ Active Alerts ({alerts.length})
              </div>
              <div className="feeds-nws-alerts">
                {alerts.map(alert => {
                  const expanded = expandedAlerts.has(alert.id)
                  return (
                    <div key={alert.id} className="feeds-nws-alert"
                      style={{ borderColor: alert.color, background: alert.color + '14' }}>
                      <div className="feeds-nws-alert-header">
                        <span className="feeds-nws-alert-event" style={{ color: alert.color }}>
                          {alert.event}
                        </span>
                        <span className="feeds-nws-alert-sev"
                          style={{ background: alert.color + '28', color: alert.color }}>
                          {alert.severity}
                        </span>
                        {alert.urgency && (
                          <span className="feeds-nws-alert-sev" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
                            {alert.urgency}
                          </span>
                        )}
                      </div>
                      <div className="feeds-nws-alert-headline">{alert.headline}</div>
                      {alert.description && (
                        <>
                          <div className={`feeds-nws-alert-desc${expanded ? ' feeds-nws-alert-desc--expanded' : ''}`}>
                            {alert.description}
                          </div>
                          {alert.description.length > 200 && (
                            <button className="feeds-alert-expand-btn" onClick={() => toggleAlertExpand(alert.id)}>
                              {expanded ? '▲ Show less' : '▼ Show more'}
                            </button>
                          )}
                        </>
                      )}
                      {alert.instruction && (
                        <div className="feeds-nws-alert-instruction">
                          <strong>What to do:</strong> {alert.instruction}
                        </div>
                      )}
                      <div className="feeds-nws-alert-meta">
                        {alert.onset && <span>Onset: {new Date(alert.onset).toLocaleString()}</span>}
                        {alert.expires && <span>Expires: {new Date(alert.expires).toLocaleString()}</span>}
                        <span style={{ marginLeft: 'auto' }}>{alert.sender}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {weather.hourly?.length > 0 && (
            <>
              <div className="feeds-subsection-label">Next 24 Hours</div>
              <div className="feeds-hourly-strip">
                {weather.hourly.map((h, i) => {
                  const t = new Date(h.time)
                  const label = i === 0 ? 'Now' : t.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
                  return (
                    <div key={h.time} className={`feeds-hourly-item${i === 0 ? ' feeds-hourly-item--now' : ''}`}>
                      <div className="feeds-hourly-time">{label}</div>
                      <div className="feeds-wx-icon">{wmoIcon(h.weathercode)}</div>
                      <div className="feeds-hourly-temp">{Math.round(h.temperature)}{weather.unit}</div>
                      {h.precip_prob != null && h.precip_prob > 0 && (
                        <div className="feeds-hourly-precip">💧{h.precip_prob}%</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div className="feeds-subsection-label">7-Day Forecast</div>
          <div className="feeds-weather-forecast">
            {weather.daily.map((day, i) => {
              const d = new Date(day.date + 'T00:00:00')
              const name = i === 0 ? 'Today' : DAY_NAMES[d.getDay()]
              const uv = uvInfo(day.uv_index_max)
              const rise = day.sunrise ? new Date(day.sunrise).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : null
              const set  = day.sunset  ? new Date(day.sunset).toLocaleTimeString('en-US',  { hour: 'numeric', minute: '2-digit', hour12: true }) : null
              return (
                <div key={day.date} className="feeds-weather-day">
                  <div className="feeds-weather-day-name">{name}</div>
                  <div className="feeds-wx-icon">{wmoIcon(day.weathercode)}</div>
                  <div className="feeds-weather-day-high">{Math.round(day.temp_max)}{weather.unit}</div>
                  <div className="feeds-weather-day-low">{Math.round(day.temp_min)}{weather.unit}</div>
                  <div className="feeds-weather-day-cond">{day.condition}</div>
                  {day.precipitation > 0 && (
                    <div style={{ fontSize: '0.62rem', color: '#4db8ff' }}>💧{day.precipitation}mm</div>
                  )}
                  {uv && <div className="feeds-weather-day-uv" style={{ color: uv.color }}>UV {day.uv_index_max}</div>}
                  {rise && <div className="feeds-weather-day-sun">🌅{rise}</div>}
                  {set  && <div className="feeds-weather-day-sun">🌇{set}</div>}
                </div>
              )
            })}
          </div>

          {weather.air_quality?.aqi != null && (
            <>
              <div className="feeds-subsection-label">Air Quality</div>
              <AirQualityPanel aq={weather.air_quality} />
            </>
          )}

          <div className="feeds-subsection-label">Live Radar</div>
          <RadarMap lat={prefs.weather_lat} lon={prefs.weather_lon} frames={radarFrames} />
        </>
      )}
    </>
  )
}

function AirQualityPanel({ aq }) {
  const pollutants = [
    { name: 'PM2.5', value: aq.pm2_5, unit: 'μg/m³' },
    { name: 'PM10',  value: aq.pm10,  unit: 'μg/m³' },
    { name: 'Ozone', value: aq.ozone, unit: 'μg/m³' },
    { name: 'NO₂',   value: aq.nitrogen_dioxide, unit: 'μg/m³' },
    { name: 'CO',    value: aq.carbon_monoxide,  unit: 'μg/m³' },
  ].filter(p => p.value != null)

  return (
    <div className="feeds-aqi-panel">
      <div className="feeds-aqi-score">
        <div className="feeds-aqi-number" style={{ color: aq.color }}>{aq.aqi}</div>
        <div className="feeds-aqi-label" style={{ color: aq.color }}>{aq.label}</div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>US AQI</div>
      </div>
      <div className="feeds-aqi-pollutants">
        {pollutants.map(p => (
          <div key={p.name} className="feeds-aqi-pollutant">
            <div className="feeds-aqi-poll-name">{p.name}</div>
            <div className="feeds-aqi-poll-value">{p.value.toFixed(1)} <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{p.unit}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RadarMap({ lat, lon, frames }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const layersRef = useRef([])
  const [frameIdx, setFrameIdx] = useState(frames.length ? frames.length - 1 : 0)
  const [playing, setPlaying] = useState(false)
  const playRef = useRef(false)
  const LRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current) return
    let cancelled = false
    import('leaflet').then(L => {
      if (cancelled || instanceRef.current) return
      LRef.current = L
      const map = L.map(mapRef.current, { center: [lat, lon], zoom: 7, zoomControl: true })
      instanceRef.current = map
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO', subdomains: 'abcd', maxZoom: 19,
      }).addTo(map)
    })
    return () => {
      cancelled = true
      if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null }
      layersRef.current = []
      LRef.current = null
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    if (!frames.length || !instanceRef.current || !LRef.current) return
    const L = LRef.current
    const map = instanceRef.current
    layersRef.current.forEach(l => map.removeLayer(l))
    layersRef.current = frames.map((f, i) => {
      const layer = L.tileLayer(
        `https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/4/1_1.png`,
        { opacity: i === frames.length - 1 ? 0.65 : 0, zIndex: 200 }
      )
      layer.addTo(map)
      return layer
    })
    setFrameIdx(frames.length - 1)
  }, [frames])

  useEffect(() => {
    layersRef.current.forEach((l, i) => {
      l.setOpacity(i === frameIdx ? 0.65 : 0)
    })
  }, [frameIdx])

  useEffect(() => {
    playRef.current = playing
    if (!playing) return
    const id = setInterval(() => {
      if (!playRef.current) return
      setFrameIdx(prev => {
        const next = prev + 1
        if (next >= frames.length) { setPlaying(false); return frames.length - 1 }
        return next
      })
    }, 500)
    return () => clearInterval(id)
  }, [playing, frames.length])

  const frameTime = frames[frameIdx]
    ? new Date(frames[frameIdx].time * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : ''
  const progress = frames.length > 1 ? (frameIdx / (frames.length - 1)) * 100 : 100

  return (
    <>
      <div className="feeds-radar-wrap" ref={mapRef} />
      {frames.length > 0 && (
        <div className="feeds-radar-controls">
          <button
            className="feeds-radar-play-btn"
            onClick={() => {
              if (frameIdx >= frames.length - 1) setFrameIdx(0)
              setPlaying(p => !p)
            }}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <div className="feeds-radar-timeline">
            <div
              className="feeds-radar-track"
              onClick={e => {
                const pct = e.nativeEvent.offsetX / e.currentTarget.offsetWidth
                setFrameIdx(Math.round(pct * (frames.length - 1)))
                setPlaying(false)
              }}
            >
              <div className="feeds-radar-progress" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="feeds-radar-time">{frameTime}</div>
        </div>
      )}
    </>
  )
}

// =============================================================================
// SPORTS TAB
// =============================================================================

const ZONE_COLORS = {
  'Champions League': '#00aaff',
  'Europa League': '#ff8800',
  'Conference League': '#00cc88',
  'Relegation': '#ff3322',
  'Promotion': '#00cc44',
  'Playoff': '#ffcc00',
}

function zoneColor(desc) {
  for (const [key, color] of Object.entries(ZONE_COLORS)) {
    if ((desc || '').includes(key)) return color
  }
  return null
}

function FormGuide({ form }) {
  if (!form) return null
  return (
    <div className="feeds-form-guide">
      {form.split('').slice(-5).map((r, i) => (
        <div key={i} className={`feeds-form-dot feeds-form-dot--${r}`}>{r}</div>
      ))}
    </div>
  )
}

function ScoreCard({ game, leagueIcon, onClick }) {
  const isScheduled = game.status === 'STATUS_SCHEDULED'
  return (
    <div className="feeds-match-card feeds-match-card--clickable" onClick={onClick}>
      <div className="feeds-match-header">
        <span className="feeds-match-league">{leagueIcon} {game.short_name}</span>
        {game.is_live ? (
          <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>             
            <span style={{                                                                 
              width:8, height:8, borderRadius:'50%', background:'#ef4444',                 
              animation:'sports-pulse 1.5s ease-in-out infinite',                          
            }} />                                         
            <span style={{ color:'#ef4444', fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.1em' }}>LIVE</span>                                                   
          </span>
        ) : (
          <span className="feeds-match-date">{game.status_detail}</span>
        )}
      </div>
      <div className="feeds-match-body">
        <div className="feeds-match-team">
          {game.home_logo ? (
            <img className="feeds-match-badge" src={game.home_logo} alt="" />
          ) : (
            <div style={{ width: 40, height: 40, background: 'var(--bg-panel)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>
              {game.home_abbr}
            </div>
          )}
          <span className="feeds-match-team-name" style={{ 
            fontWeight: game.home_winner ? 700 : 400,
            color: game.home_winner ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)'
          }}>
            {game.home_team}
          </span>
        </div>

        <div className="feeds-match-centre">
          {!isScheduled ? (
            <div className="feeds-match-score" style={{ fontFamily: 'monospace', fontSize: '1.25rem' }}>
              {game.home_score} – {game.away_score}
            </div>
          ) : (
            <div className="feeds-match-vs">VS</div>
          )}
        </div>

        <div className="feeds-match-team">
          {game.away_logo ? (
            <img className="feeds-match-badge" src={game.away_logo} alt="" />
          ) : (
            <div style={{ width: 40, height: 40, background: 'var(--bg-panel)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>
              {game.away_abbr}
            </div>
          )}
          <span className="feeds-match-team-name" style={{ 
            fontWeight: game.away_winner ? 700 : 400,
            color: game.away_winner ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)'
          }}>
            {game.away_team}
          </span>
        </div>
      </div>
    </div>
  )
}

function BoxScorePanel({ game, onBack }) {
  const [bsData, setBsData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch(`/sports/boxscore/${game.league_id}/${game.id}`)
      .then(setBsData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [game.id, game.league_id])

  const renderBoxBody = () => {
    if (!bsData?.boxscore) return <div>Detailed stats loading...</div>

    const lid = game.league_id
    const teams = bsData.boxscore.teams || []
    
    // Football
    if (lid === 'nfl' || lid === 'ncaaf') {
      const stats = teams.map(t => t.linescore || [])
      return (
        <table className="sports-bs-table">
          <thead>
            <tr>
              <th>TEAM</th>
              {stats[0]?.map((_, i) => <th key={i}>Q{i+1}</th>)}
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={t.team.id} className={i === 0 ? 'home-row' : 'away-row'}>
                <td>{t.team.abbreviation}</td>
                {t.linescore?.map((q, j) => <td key={j}>{q.displayValue}</td>)}
                <td className="score-col">{t.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    // Basketball
    if (['nba', 'wnba', 'ncaab', 'ncaabw'].includes(lid)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <table className="sports-bs-table">
            <thead>
              <tr>
                <th>TEAM</th>
                {teams[0]?.linescore?.map((_, i) => <th key={i}>Q{i+1}</th>)}
                <th>T</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.team.id} className={i === 0 ? 'home-row' : 'away-row'}>
                  <td>{t.team.abbreviation}</td>
                  {t.linescore?.map((q, j) => <td key={j}>{q.displayValue}</td>)}
                  <td className="score-col">{t.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="feeds-subsection-label">Top Performers</div>
          {bsData.boxscore.players?.map(pGrp => (
            <div key={pGrp.team.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--md-primary)', marginBottom: 4 }}>{pGrp.team.displayName}</div>
              <table className="sports-bs-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>PTS</th>
                    <th>REB</th>
                    <th>AST</th>
                  </tr>
                </thead>
                <tbody>
                  {pGrp.statistics[0]?.athletes.slice(0, 5).map(a => (
                    <tr key={a.athlete.id}>
                      <td>{a.athlete.displayName}</td>
                      <td>{a.stats[0]}</td>
                      <td>{a.stats[1]}</td>
                      <td>{a.stats[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )
    }

    // Baseball
    if (lid === 'mlb') {
      return (
        <table className="sports-bs-table">
          <thead>
            <tr>
              <th>TEAM</th>
              {[...Array(9)].map((_, i) => <th key={i}>{i+1}</th>)}
              <th>R</th><th>H</th><th>E</th>
            </tr>
          </thead>
          <tbody>
            {teams.reverse().map((t, i) => (
              <tr key={t.team.id} className={i === 1 ? 'home-row' : 'away-row'}>
                <td>{t.team.abbreviation}</td>
                {t.linescore?.map((q, j) => <td key={j}>{q.displayValue}</td>)}
                <td className="score-col">{t.score}</td>
                <td>{t.hits}</td>
                <td>{t.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    return <div style={{ textAlign: 'center', color: 'var(--md-on-surface-variant)', fontSize: '0.8rem', padding: '20px 0' }}>Detailed stats not available for this sport.</div>
  }

  return (
    <div className="feeds-match-stats-page">
      <div className="feeds-match-stats-header">
        <button className="feeds-back-btn" onClick={onBack}>← Back to Scoreboard</button>
        <div className="feeds-match-stats-league">{game.short_name}</div>
      </div>

      <div className="feeds-match-stats-hero" style={{ padding: '16px 24px' }}>
        <div className="feeds-match-stats-team">
          {game.home_logo && <img src={game.home_logo} alt="" style={{ width: 48, height: 48 }} />}
          <div className="feeds-match-stats-team-name">{game.home_team}</div>
          <div className="feeds-match-stats-score">{game.home_score}</div>
        </div>
        <div className="feeds-match-stats-score-wrap" style={{ minWidth: 80 }}>
           <div style={{ fontSize: '0.75rem', color: 'var(--md-on-surface-variant)', marginBottom: 4 }}>{game.status_detail}</div>
           {game.is_live && (
             <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>             
               <span style={{ width:6, height:6, borderRadius:'50%', background:'#ef4444', animation:'sports-pulse 1.5s ease-in-out infinite' }} />                                         
               <span style={{ color:'#ef4444', fontSize:'0.55rem', fontWeight:700 }}>LIVE</span>                                                   
             </span>
           )}
        </div>
        <div className="feeds-match-stats-team">
          {game.away_logo && <img src={game.away_logo} alt="" style={{ width: 48, height: 48 }} />}
          <div className="feeds-match-stats-team-name">{game.away_team}</div>
          <div className="feeds-match-stats-score">{game.away_score}</div>
        </div>
      </div>

      <div className="feeds-match-stats-body">
        {loading ? <div className="feeds-loading">Loading stats…</div> : renderBoxBody()}
        {!loading && !bsData && <div>Stats unavailable — ESPN may not have detailed data for this game yet.</div>}
      </div>
    </div>
  )
}

function Countdown({ dateStr, timeStr }) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const update = () => {
      if (!dateStr) return
      const dt = new Date(`${dateStr}T${timeStr || '00:00:00'}`)
      const diff = dt - Date.now()
      if (diff <= 0) { setLabel(''); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      if (d > 0) setLabel(`In ${d}d ${h}h`)
      else if (h > 0) setLabel(`In ${h}h ${m}m`)
      else setLabel(`In ${m}m`)
    }
    update()
    const id = setInterval(update, 60000)
    return () => clearInterval(id)
  }, [dateStr, timeStr])
  return label ? <div className="feeds-match-countdown">{label}</div> : null
}

function SportsTab({ prefs, savePrefs }) {
  const [sportsTab, setSportsTab] = useState('scoreboard')
  const [filterTeam, setFilterTeam] = useState('all')
  const [data, setData] = useState(null)
  const [standings, setStandings] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [headlines, setHeadlines] = useState([])
  const [headlinesLoading, setHeadlinesLoading] = useState(false)
  const [headlinesError, setHeadlinesError] = useState('')
  const [headlineSearch, setHeadlineSearch] = useState('')
  const [allSportsSources, setAllSportsSources] = useState([])
  const [sportsCatMeta, setSportsCatMeta] = useState({})
  const [selectedEvent, setSelectedEvent] = useState(null)

  // Scoreboard states
  const [scoreboard, setScoreboard] = useState([])
  const [scoreboardLoading, setScoreboardLoading] = useState(false)
  const [leagueRegistry, setLeagueRegistry] = useState([])

  // Schedule & Standings states
  const [schedule, setSchedule] = useState([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const scheduleCache = useRef({}) // { teamId_or_all: {data, ts} }

  const [espnStandings, setEspnStandings] = useState({})
  const [standingsLoading, setStandingsLoading] = useState(false)

  // Picker states
  const [showPicker, setShowPicker] = useState(false)
  const [leagues, setLeagues] = useState([])
  const [leaguesLoading, setLeaguesLoading] = useState(false)
  const [activeCategory, setActiveCategory] = useState('American Pro')
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [leagueTeams, setLeagueTeams] = useState([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [teamSearch, setTeamSearch] = useState('')
  
  // Headline settings toggle
  const [showHeadlineSettings, setShowHeadlineSettings] = useState(false)

  const load = useCallback(() => {
    if (!prefs?.sport_teams?.length) return
    setLoading(true)
    setError('')
    apiFetch('/sports')
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [prefs?.sport_teams])

  useEffect(() => { load() }, [load])

  // Load league registry once
  useEffect(() => {
    apiFetch('/sports/leagues').then(setLeagueRegistry).catch(() => {})
  }, [])

  const loadScoreboard = useCallback(async () => {
    const teams = prefs?.sport_teams || []
    if (!teams.length) return

    setScoreboardLoading(true)
    try {
      const leagueIds = [...new Set(teams.map(t => t.league_id).filter(id => id && !ESPN_LEAGUES_STUB.has(id)))]
      const results = await Promise.all(
        leagueIds.map(id => apiFetch(`/sports/scoreboard/${id}`).catch(() => []))
      )
      const flat = results.flat()
      const seen = new Set()
      const deduped = flat.filter(ev => {
        if (seen.has(ev.id)) return false
        seen.add(ev.id)
        return true
      })
      deduped.sort((a, b) => {
        if (a.is_live && !b.is_live) return -1
        if (!a.is_live && b.is_live) return 1
        return new Date(a.date) - new Date(b.date)
      })
      setScoreboard(deduped)
    } finally {
      setScoreboardLoading(false)
    }
  }, [prefs?.sport_teams])

  useEffect(() => {
    if (sportsTab === 'scoreboard' || (prefs?.sport_teams?.length && scoreboard.length === 0)) {
      loadScoreboard()
    }
  }, [sportsTab, loadScoreboard, scoreboard.length])

  useEffect(() => {
    if (sportsTab !== 'scoreboard') return
    const id = setInterval(loadScoreboard, 60000)
    return () => clearInterval(id)
  }, [sportsTab, loadScoreboard])

  const loadSchedule = useCallback(async () => {
    const teams = prefs?.sport_teams || []
    if (!teams.length) return

    const cacheKey = filterTeam
    const cached = scheduleCache.current[cacheKey]
    if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
      setSchedule(cached.data)
      return
    }

    setScheduleLoading(true)
    try {
      let results = []
      if (filterTeam !== 'all') {
        const t = teams.find(x => x.id === filterTeam)
        if (t) results = await apiFetch(`/sports/schedule/${t.league_id}/${t.id}`).catch(() => [])
      } else {
        const teamResults = await Promise.all(
          teams.map(t => apiFetch(`/sports/schedule/${t.league_id}/${t.id}`).catch(() => []))
        )
        const flat = teamResults.flat()
        const seen = new Set()
        results = flat.filter(ev => {
          if (seen.has(ev.id)) return false
          seen.add(ev.id)
          return true
        }).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 20)
      }
      setSchedule(results)
      scheduleCache.current[cacheKey] = { data: results, ts: Date.now() }
    } finally {
      setScheduleLoading(false)
    }
  }, [prefs?.sport_teams, filterTeam])

  useEffect(() => {
    if (sportsTab === 'schedule') loadSchedule()
  }, [sportsTab, loadSchedule])

  const loadEspnStandings = useCallback(async () => {
    const teams = prefs?.sport_teams || []
    if (!teams.length) return
    
    setStandingsLoading(true)
    try {
      const leagueIds = [...new Set(teams.map(t => t.league_id).filter(id => id && !ESPN_LEAGUES_STUB.has(id)))]
      const results = await Promise.all(
        leagueIds.map(async id => ({ id, rows: await apiFetch(`/sports/espn-standings/${id}`).catch(() => []) }))
      )
      const newStandings = {}
      results.forEach(r => { newStandings[r.id] = r.rows })
      setEspnStandings(newStandings)
    } finally {
      setStandingsLoading(false)
    }
  }, [prefs?.sport_teams])

  useEffect(() => {
    if (sportsTab === 'standings') loadEspnStandings()
  }, [sportsTab, loadEspnStandings])

  // Load standings (Legacy - keep as fallback)
  useEffect(() => {
    if (!prefs?.sport_teams?.length) return
    const leagueIds = [...new Set(prefs.sport_teams.map(t => t.league_id).filter(Boolean))]
    leagueIds.forEach(id => {
      apiFetch(`/sports/standings?league_id=${id}`)
        .then(rows => setStandings(prev => ({ ...prev, [id]: rows })))
        .catch(() => {})
    })
  }, [prefs?.sport_teams])

  useEffect(() => {
    if (showPicker && !leagues.length) {
      setLeaguesLoading(true)
      apiFetch('/sports/leagues')
        .then(setLeagues)
        .catch(() => {})
        .finally(() => setLeaguesLoading(false))
    }
  }, [showPicker, leagues.length])

  useEffect(() => {
    if (selectedLeague) {
      setTeamsLoading(true)
      setLeagueTeams([])
      apiFetch(`/sports/teams/${selectedLeague.id}`)
        .then(setLeagueTeams)
        .catch(() => {})
        .finally(() => setTeamsLoading(false))
    }
  }, [selectedLeague])

  useEffect(() => {
    apiFetch('/sports/news/sources')
      .then(data => {
        setAllSportsSources(Array.isArray(data) ? data : (data.sources || []))
        setSportsCatMeta(Array.isArray(data) ? {} : (data.categories || {}))
      })
      .catch(() => {})
  }, [])

  const loadHeadlines = useCallback(() => {
    setHeadlinesLoading(true)
    setHeadlinesError('')
    apiFetch('/sports/news')
      .then(setHeadlines)
      .catch(e => setHeadlinesError(e.message))
      .finally(() => setHeadlinesLoading(false))
  }, [prefs?.sports_news_sources]) // eslint-disable-line

  useEffect(() => { loadHeadlines() }, [loadHeadlines])

  const addTeam = (team) => {
    const current = prefs.sport_teams || []
    if (current.find(t => t.id === team.id)) return
    const newTeam = {
      id: team.id,
      name: team.name,
      abbr: team.abbr,
      badge_url: team.logo,
      league_id: team.league_id,
      league_label: team.league_label,
      icon: team.icon,
      sport: team.sport
    }
    savePrefs({ sport_teams: [...current, newTeam] })
  }
  const removeTeam = (id) => {
    if (filterTeam === id) setFilterTeam('all')
    savePrefs({ sport_teams: (prefs.sport_teams || []).filter(t => t.id !== id) })
  }
  const isAdded = (id) => (prefs?.sport_teams || []).some(t => t.id === id)

  const toggleSportsSource = (src) => {
    const current = prefs.sports_news_sources || []
    const exists = current.find(s => s.url === src.url)
    const updated = exists ? current.filter(s => s.url !== src.url) : [...current, src]
    savePrefs({ sports_news_sources: updated })
  }
  const isSportsSourceSelected = (src) => (prefs?.sports_news_sources || []).some(s => s.url === src.url)

  const teams = prefs?.sport_teams || []

  const filterEvents = (events) => {
    if (filterTeam === 'all') return events
    const team = teams.find(t => t.id === filterTeam)
    if (!team) return events
    return events.filter(e => e.home_team === team.name || e.away_team === team.name)
  }

  const standingLeagues = filterTeam === 'all'
    ? Object.entries(standings)
    : Object.entries(standings).filter(([id]) => {
        const team = teams.find(t => t.id === filterTeam)
        return team?.league_id === id
      })

  const followedTeamIds = new Set(teams.map(t => t.id))

  if (selectedEvent) {
    return <BoxScorePanel game={selectedEvent} onBack={() => setSelectedEvent(null)} />
  }

  const pickerCategories = [...new Set(leagues.map(l => l.category))]
  const filteredTeams = leagueTeams.filter(t => 
    t.name.toLowerCase().includes(teamSearch.toLowerCase()) || 
    t.abbr.toLowerCase().includes(teamSearch.toLowerCase())
  )

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">Your Teams</span>
      </div>

      {teams.length === 0 ? (
        <div className="feeds-empty" style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🏟️ </div>                     
          <p style={{ margin: '0 0 16px', color: 'var(--md-on-surface-variant)' }}>          
            No teams followed yet.                                                           
          </p>                                                                               
          <button                                                                            
            style={{                                        
              padding: '8px 20px', borderRadius: 'var(--md-shape-full)',                     
              background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)',                                                      
              border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem'
            }}                                                                               
            onClick={() => setShowPicker(true)}             
          >                                                                                  
            + Add Your Teams                                
          </button>
        </div>
      ) : (
        <>
          <div className="sports-teams-rail">
            <button 
              className={`rail-chip rail-chip--all${filterTeam === 'all' ? ' rail-chip--active' : ''}`}
              onClick={() => setFilterTeam('all')}
            >
              ALL
            </button>
            {teams.map(team => (
              <button 
                key={team.id}
                className={`rail-chip${filterTeam === team.id ? ' rail-chip--active' : ''}`}
                onClick={() => setFilterTeam(team.id)}
              >
                {team.badge_url ? (
                  <img src={team.badge_url} alt="" className="rail-logo" />
                ) : (
                  <span style={{ fontSize: '0.875rem' }}>{team.icon}</span>
                )}
                <span className="rail-abbr">{team.abbr}</span>
                <span className="rail-remove" onClick={(e) => { e.stopPropagation(); removeTeam(team.id); }}>×</span>
              </button>
            ))}
            <button className="rail-add-teams-btn" onClick={() => setShowPicker(true)}>
              + ADD TEAMS
            </button>
          </div>

          <div className="feeds-sports-tab-bar">
            {['scoreboard', 'results', 'fixtures', 'schedule', 'standings', 'headlines'].map(tab => (
              <button key={tab}
                className={`feeds-sports-tab${sportsTab === tab ? ' feeds-sports-tab--active' : ''}`}
                onClick={() => setSportsTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {(loading || scoreboardLoading || scheduleLoading || standingsLoading) && <div className="feeds-loading">Fetching data…</div>}
          {error && <div className="feeds-error">{error}</div>}

          {sportsTab === 'schedule' && !scheduleLoading && (
            <div className="feeds-body">
              {schedule.length > 0 ? (
                schedule.map(game => (
                  <div key={game.id} className="sports-schedule-row">
                    <div style={{ width: 80, color: 'var(--md-on-surface-variant)', fontSize: '0.75rem' }}>
                      {new Date(game.date).toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {game.away_logo && <img src={game.away_logo} alt="" style={{ width: 24, height: 24 }} />}
                      <span style={{ fontWeight: 500 }}>{game.away_abbr}</span>
                    </div>
                    <span style={{ color: 'var(--md-on-surface-variant)', padding: '0 4px' }}>at</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {game.home_logo && <img src={game.home_logo} alt="" style={{ width: 24, height: 24 }} />}
                      <span style={{ fontWeight: 500 }}>{game.home_abbr}</span>
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={{ color: 'var(--md-on-surface-variant)', fontSize: '0.75rem' }}>{game.status_detail}</div>
                    <span style={{ fontSize: '1rem' }}>{leagueRegistry.find(l => l.id === game.league_id)?.icon}</span>
                  </div>
                ))
              ) : (
                <div className="feeds-empty">No upcoming games found for your followed teams.</div>
              )}
            </div>
          )}

          {sportsTab === 'standings' && !standingsLoading && (
            <>
              {Object.entries(espnStandings).filter(([lid]) => filterTeam === 'all' || teams.find(t => t.id === filterTeam)?.league_id === lid).map(([lid, rows]) => {
                const info = leagueRegistry.find(l => l.id === lid)
                if (!rows.length) return null
                
                const isSoccer = ['mls', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'uel', 'ligamx', 'nwsl'].includes(lid)
                const isFootball = lid === 'nfl' || lid === 'ncaaf'
                const isBasketball = ['nba', 'wnba', 'ncaab'].includes(lid)
                const isBaseball = lid === 'mlb'
                const isHockey = lid === 'nhl'

                return (
                  <div key={lid} style={{ marginBottom: 24 }}>
                    <div className="feeds-subsection-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.2rem' }}>{info?.icon}</span> {info?.label}
                    </div>
                    <div className="feeds-standings-wrap">
                      <table className="sports-bs-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th style={{ textAlign: 'left' }}>TEAM</th>
                            {isSoccer && <><th title="Matches Played">MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th></>}
                            {isFootball && <><th>W</th><th>L</th><th>PCT</th><th>PF</th><th>PA</th></>}
                            {isBasketball && <><th>W</th><th>L</th><th>PCT</th><th>GB</th></>}
                            {isBaseball && <><th>W</th><th>L</th><th>PCT</th><th>GB</th></>}
                            {isHockey && <><th title="Games Played">GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th></>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => {
                            const isFollowed = teams.some(t => t.id === row.team_id)
                            return (
                              <tr key={row.team_id} className={isFollowed ? 'home-row' : 'away-row'} style={isFollowed ? { borderLeft: '3px solid var(--md-primary)', paddingLeft: 5 } : {}}>
                                <td>{idx + 1}</td>
                                <td style={{ textAlign: 'left', fontWeight: isFollowed ? 700 : 400 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {row.logo && <img src={row.logo} alt="" style={{ width: 18, height: 18 }} />}
                                    {row.team}
                                  </div>
                                </td>
                                {isSoccer && <>
                                  <td>{row.stats.gamesPlayed}</td><td>{row.stats.wins}</td><td>{row.stats.draws}</td><td>{row.stats.losses}</td>
                                  <td className={parseInt(row.stats.goalDifference) >= 0 ? 'gd-pos' : 'gd-neg'}>{row.stats.goalDifference}</td>
                                  <td className="score-col">{row.stats.points}</td>
                                </>}
                                {isFootball && <>
                                  <td>{row.stats.wins}</td><td>{row.stats.losses}</td><td>{row.stats.winPercent}</td>
                                  <td>{row.stats.pointsFor}</td><td>{row.stats.pointsAgainst}</td>
                                </>}
                                {isBasketball && <>
                                  <td>{row.stats.wins}</td><td>{row.stats.losses}</td><td>{row.stats.winPercent}</td><td>{row.stats.gamesBack}</td>
                                </>}
                                {isBaseball && <>
                                  <td>{row.stats.wins}</td><td>{row.stats.losses}</td><td>{row.stats.winPercent}</td><td>{row.stats.gamesBack}</td>
                                </>}
                                {isHockey && <>
                                  <td>{row.stats.gamesPlayed}</td><td>{row.stats.wins}</td><td>{row.stats.losses}</td>
                                  <td>{row.stats.overtimeLosses}</td><td className="score-col">{row.stats.points}</td>
                                </>}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {data && !loading && sportsTab === 'results' && (
            <div className="feeds-sports-grid">
              {filterEvents(data.results).length > 0
                ? filterEvents(data.results).map(e => <MatchCard key={e.id} event={e} onClick={() => setSelectedEvent(e)} />)
                : <div className="feeds-empty">No recent results found.</div>
              }
            </div>
          )}

          {data && !loading && sportsTab === 'fixtures' && (
            <div className="feeds-sports-grid">
              {filterEvents(data.fixtures).length > 0
                ? filterEvents(data.fixtures).map(e => <MatchCard key={e.id} event={e} onClick={() => setSelectedEvent(e)} />)
                : <div className="feeds-empty">No upcoming fixtures found.</div>
              }
            </div>
          )}

          {sportsTab === 'standings' && (
            <>
              {standingLeagues.length === 0 && (
                <div className="feeds-empty">No standings available.</div>
              )}
              {standingLeagues.map(([leagueId, rows]) => rows.length > 0 && (
                <div key={leagueId} style={{ marginBottom: 24 }}>
                  <div className="feeds-subsection-label" style={{ marginBottom: 10 }}>
                    {rows[0]?.league} — {rows[0]?.season}
                  </div>
                  <StandingsTable rows={rows} followedIds={followedTeamIds} />
                </div>
              ))}
            </>
          )}

          {sportsTab === 'headlines' && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <input
                  className="feeds-news-search"
                  placeholder="Search sports headlines…"
                  value={headlineSearch}
                  onChange={e => setHeadlineSearch(e.target.value)}
                />
                <button 
                  className="headlines-settings-toggle"
                  onClick={() => setShowHeadlineSettings(!showHeadlineSettings)}
                >
                  <IconGear /> Settings
                </button>
              </div>

              {showHeadlineSettings && (
                <div className="feeds-settings-panel" style={{ marginBottom: 16 }}>
                  <div className="feeds-settings-row">
                    <span className="feeds-settings-label">Headlines sources</span>
                    {[...new Set(allSportsSources.map(s => s.category))].map(cat => {
                      const meta  = sportsCatMeta[cat] || {}
                      const label = meta.label || cat
                      const color = SOURCE_CAT_COLORS[cat] || 'var(--md-on-surface-variant)'
                      const sourcesInCat = allSportsSources.filter(s => s.category === cat)
                      const selectedCount = sourcesInCat.filter(s => isSportsSourceSelected(s)).length
                      return (
                        <div key={cat}>
                          <div className="feeds-sports-section-title" style={{ marginTop: 14, color }}>
                            {label}
                            {selectedCount > 0 && (
                              <span style={{
                                marginLeft: 8, fontSize: '0.625rem', fontWeight: 500,
                                background: color + '22', color, borderRadius: 10, padding: '1px 7px',
                              }}>
                                {selectedCount} selected
                              </span>
                            )}
                          </div>
                          <div className="feeds-source-category-grid">
                            {sourcesInCat.map(src => (
                              <button
                                key={src.url}
                                className={`feeds-source-cat-btn${isSportsSourceSelected(src) ? ' feeds-source-cat-btn--active' : ''}`}
                                style={isSportsSourceSelected(src) ? { '--cat-color': color, borderColor: color, color } : {}}
                                onClick={() => toggleSportsSource(src)}
                              >
                                {src.name} {isSportsSourceSelected(src) && '✓'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="feeds-settings-row">
                    <span className="feeds-settings-label">Refresh interval</span>
                    <select className="feeds-refresh-select" value={prefs.refresh_sports_min}
                      onChange={e => savePrefs({ refresh_sports_min: Number(e.target.value) })}>
                      {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {headlinesLoading && <div className="feeds-loading">Fetching sports headlines…</div>}
              {headlinesError && <div className="feeds-error">{headlinesError}</div>}
              {!headlinesLoading && headlines.length > 0 && (() => {
                const q = headlineSearch.toLowerCase()
                const shown = headlineSearch
                  ? headlines.filter(a => (a.title + a.summary + a.source).toLowerCase().includes(q))
                  : headlines
                return shown.length > 0
                  ? <div className="feeds-news-list">
                      {shown.map(a => (
                        <a key={a.id || a.url} className="feeds-news-list-item" href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.image_url && <img className="feeds-news-list-thumb" src={a.image_url} alt="" loading="lazy" onError={e => { e.target.style.display = 'none' }} />}
                          <div className="feeds-news-list-text">
                            <div className="feeds-news-list-title">{a.title}</div>
                            <div className="feeds-news-list-meta">
                              <span style={{ color: SOURCE_CAT_COLORS[a.category] || 'var(--primary)' }}>{a.source}</span>
                              <span>{formatDate(a.published_at)}</span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  : <div className="feeds-empty">No headlines match your search.</div>
              })()}
            </>
          )}
        </>
      )}

      {showPicker && (
        <div className="sport-picker-backdrop" onClick={() => setShowPicker(false)}>
          <div className="sport-picker-panel" onClick={e => e.stopPropagation()}>
            <div className="sport-picker-header">
              <span className="sport-picker-title">{selectedLeague ? 'Select Team' : 'Add Teams'}</span>
              <button className="sport-picker-close" onClick={() => setShowPicker(false)}>&times;</button>
            </div>

            <div className="sport-picker-body">
              {leaguesLoading && <div className="feeds-loading">Loading leagues…</div>}

              {!selectedLeague && !leaguesLoading && (
                <>
                  <div className="sport-cat-pills">
                    {pickerCategories.map(cat => (
                      <button
                        key={cat}
                        className={`sport-cat-pill${activeCategory === cat ? ' sport-cat-pill--active' : ''}`}
                        onClick={() => setActiveCategory(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div className="league-grid">
                    {leagues.filter(l => l.category === activeCategory).map(league => (
                      <div 
                        key={league.id} 
                        className={`league-card${league.stub ? ' league-card--stub' : ''}`}
                        onClick={() => !league.stub && setSelectedLeague(league)}
                      >
                        <span className="league-icon">{league.icon}</span>
                        <span className="league-label">{league.label}</span>
                        {league.stub && <span className="league-stub-badge">COMING SOON</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {selectedLeague && (
                <>
                  <div className="team-picker-header">
                    <button className="back-btn" onClick={() => setSelectedLeague(null)}>&larr; Back</button>
                    <span className="league-label">{selectedLeague.icon} {selectedLeague.label}</span>
                  </div>
                  <input 
                    className="team-search-input" 
                    placeholder="Search teams…" 
                    value={teamSearch}
                    onChange={e => setTeamSearch(e.target.value)}
                    autoFocus
                  />
                  {teamsLoading && <div className="feeds-loading">Loading teams…</div>}
                  <div className="team-grid">
                    {filteredTeams.map(team => (
                      <div key={team.id} className="team-card">
                        {team.logo ? (
                          <img src={team.logo} alt="" className="team-card-logo" />
                        ) : (
                          <div className="team-card-logo" style={{ background: 'var(--md-surface-variant)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyCenter: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--md-on-surface-variant)' }}>
                            {team.abbr}
                          </div>
                        )}
                        <span className="team-card-name" title={team.name}>{team.name}</span>
                        {isAdded(team.id) ? (
                          <span className="team-added-mark">✓</span>
                        ) : (
                          <button className="team-add-btn" onClick={() => addTeam(team)}>+ Add</button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MatchCard({ event, onClick }) {
  return (
    <div className={`feeds-match-card${onClick ? ' feeds-match-card--clickable' : ''}`} onClick={onClick}>
      <div className="feeds-match-header">
        <span className="feeds-match-league">{event.league}</span>
        <span className="feeds-match-date">{event.date}</span>
      </div>
      <div className="feeds-match-body">
        <div className="feeds-match-team">
          {event.home_badge
            ? <img className="feeds-match-badge" src={event.home_badge} alt="" />
            : <div style={{ width: 40, height: 40, background: 'var(--bg-panel)', borderRadius: 4 }} />
          }
          <span className="feeds-match-team-name">{event.home_team}</span>
        </div>

        <div className="feeds-match-centre">
          {event.finished ? (
            <div className="feeds-match-score">{event.home_score} – {event.away_score}</div>
          ) : (
            <>
              <div className="feeds-match-vs">VS</div>
              {event.time && <div className="feeds-match-time">{event.time}</div>}
              <Countdown dateStr={event.date} timeStr={event.time} />
            </>
          )}
        </div>

        <div className="feeds-match-team">
          {event.away_badge
            ? <img className="feeds-match-badge" src={event.away_badge} alt="" />
            : <div style={{ width: 40, height: 40, background: 'var(--bg-panel)', borderRadius: 4 }} />
          }
          <span className="feeds-match-team-name">{event.away_team}</span>
        </div>
      </div>
    </div>
  )
}

function MatchStats({ event, onBack }) {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    apiFetch(`/sports/event-stats?event_id=${event.id}`)
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [event.id])

  return (
    <div className="feeds-match-stats-page">
      <div className="feeds-match-stats-header">
        <button className="feeds-back-btn" onClick={onBack}>← Back to results</button>
        <div className="feeds-match-stats-league">{event.league}</div>
      </div>

      <div className="feeds-match-stats-hero">
        <div className="feeds-match-stats-team">
          {event.home_badge && <img src={event.home_badge} alt="" />}
          <div className="feeds-match-stats-team-name">{event.home_team}</div>
        </div>
        <div className="feeds-match-stats-score-wrap">
          <div className="feeds-match-stats-score">
            {event.finished ? `${event.home_score} – ${event.away_score}` : 'vs'}
          </div>
          <div className="feeds-match-stats-date">{event.date}</div>
        </div>
        <div className="feeds-match-stats-team">
          {event.away_badge && <img src={event.away_badge} alt="" />}
          <div className="feeds-match-stats-team-name">{event.away_team}</div>
        </div>
      </div>

      <div className="feeds-match-stats-body">
        <div className="feeds-subsection-label">Game Statistics</div>
        {loading && <div className="feeds-loading">Loading stats…</div>}
        {error && <div className="feeds-error">{error}</div>}
        {!loading && stats.length > 0 && (
          <div className="feeds-stats-list">
            {stats.map((s, i) => (
              <div key={i} className="feeds-stat-row">
                <div className="feeds-stat-label">{s.label}</div>
                <div className="feeds-stat-comparison">
                  <div className="feeds-stat-val feeds-stat-val--home">{s.home}</div>
                  <div className="feeds-stat-bar-bg">
                    <div className="feeds-stat-bar-fill feeds-stat-bar-fill--home" style={{ width: `${(parseFloat(s.home) / (parseFloat(s.home) + parseFloat(s.away) || 1)) * 100}%` }} />
                  </div>
                  <div className="feeds-stat-val feeds-stat-val--away">{s.away}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && !error && stats.length === 0 && (
          <div className="feeds-empty">Detailed stats are not available for this game.</div>
        )}
      </div>
    </div>
  )
}

function StandingsTable({ rows, followedIds }) {
  return (
    <div className="feeds-standings-wrap">
      <table className="feeds-standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GF</th>
            <th>GA</th>
            <th>GD</th>
            <th>Pts</th>
            <th>Form</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isFollowed = followedIds.has(row.team_id)
            const zone = zoneColor(row.description)
            const gdPos = row.goal_diff > 0
            return (
              <tr key={row.rank}
                className={`feeds-standings-row${isFollowed ? ' feeds-standings-row--highlight' : ''}`}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {zone && <div className="feeds-standings-zone" style={{ background: zone, minHeight: 20 }} />}
                    <span className="feeds-standings-pos">{row.rank}</span>
                  </div>
                </td>
                <td>
                  <div className="feeds-standings-team-cell">
                    {row.badge_url && <img className="feeds-standings-badge" src={row.badge_url} alt="" />}
                    <span style={{ fontWeight: isFollowed ? 600 : 400, color: isFollowed ? 'var(--text)' : 'var(--text-dim)' }}>
                      {row.team}
                    </span>
                  </div>
                </td>
                <td>{row.played}</td>
                <td style={{ color: '#00cc44' }}>{row.win}</td>
                <td>{row.draw}</td>
                <td style={{ color: '#ff3322' }}>{row.loss}</td>
                <td>{row.goals_for}</td>
                <td>{row.goals_against}</td>
                <td className={`feeds-standings-gd--${gdPos ? 'pos' : 'neg'}`}>
                  {gdPos ? '+' : ''}{row.goal_diff}
                </td>
                <td className="feeds-standings-pts">{row.points}</td>
                <td><FormGuide form={row.form} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// =============================================================================
// STOCKS TAB
// =============================================================================

function isMarketOpen() {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  const h = et.getHours(), m = et.getMinutes()
  const mins = h * 60 + m
  return mins >= 570 && mins < 960 // 9:30–16:00
}

function Sparkline({ data, up }) {
  if (!data || data.length < 2) return null
  const prices = data.map(d => d.close)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const w = 200, h = 50
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w
    const y = h - ((p - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const color = up ? '#00cc44' : '#ff3322'
  return (
    <svg className="feeds-stock-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <linearGradient id={`sg-${up}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
      <polygon
        points={`0,${h} ${pts} ${w},${h}`}
        fill={`url(#sg-${up})`}
      />
    </svg>
  )
}

function StockCard({ q }) {
  const [expanded, setExpanded] = useState(false)
  const [chart, setChart] = useState(null)
  const [chartLoading, setChartLoading] = useState(false)

  const loadChart = () => {
    if (chart || chartLoading) return
    setChartLoading(true)
    apiFetch(`/stocks/chart?ticker=${q.ticker}`)
      .then(setChart)
      .catch(() => setChart([]))
      .finally(() => setChartLoading(false))
  }

  const toggle = () => {
    setExpanded(e => !e)
    if (!expanded) loadChart()
  }

  return (
    <div className={`feeds-stock-card feeds-stock-card--${q.up ? 'up' : 'down'}`} onClick={toggle}>
      <div className="feeds-stock-card-main">
        <div className="feeds-stock-header">
          <span className="feeds-stock-ticker">{q.ticker}</span>
          <span className="feeds-stock-name">{q.name || ''}</span>
        </div>
        <div className="feeds-stock-price">${parseFloat(q.price).toFixed(2)}</div>
        <div className={`feeds-stock-change feeds-stock-change--${q.up ? 'up' : 'down'}`}>
          {q.up ? '▲' : '▼'} {q.change > 0 ? '+' : ''}{parseFloat(q.change).toFixed(2)}
          <span style={{ opacity: 0.8 }}>({q.change_pct > 0 ? '+' : ''}{parseFloat(q.change_pct).toFixed(2)}%)</span>
        </div>
        <div className="feeds-stock-meta">
          <div className="feeds-stock-meta-item">Open <span className="feeds-stock-meta-val">${q.open}</span></div>
          <div className="feeds-stock-meta-item">High <span className="feeds-stock-meta-val">${q.high}</span></div>
          <div className="feeds-stock-meta-item">Low <span className="feeds-stock-meta-val">${q.low}</span></div>
          <div className="feeds-stock-meta-item">Prev <span className="feeds-stock-meta-val">${q.prev_close}</span></div>
        </div>
      </div>

      {expanded && (
        <div className="feeds-stock-detail" onClick={e => e.stopPropagation()}>
          <div className="feeds-stock-chart-label">30-Day Price</div>
          {chartLoading && <div className="feeds-stock-chart-loading">Loading chart…</div>}
          {chart && chart.length > 0 && <Sparkline data={chart} up={q.up} />}
          {chart && chart.length === 0 && <div className="feeds-stock-chart-loading">Chart data unavailable (API limit)</div>}
          {chart && chart.length > 0 && (
            <div className="feeds-stock-meta" style={{ borderTop: 'none', paddingTop: 0 }}>
              <div className="feeds-stock-meta-item">
                30d High <span className="feeds-stock-meta-val" style={{ color: '#00cc44' }}>
                  ${Math.max(...chart.map(d => d.high)).toFixed(2)}
                </span>
              </div>
              <div className="feeds-stock-meta-item">
                30d Low <span className="feeds-stock-meta-val" style={{ color: '#ff3322' }}>
                  ${Math.min(...chart.map(d => d.low)).toFixed(2)}
                </span>
              </div>
              <div className="feeds-stock-meta-item">
                Volume <span className="feeds-stock-meta-val">
                  {Number(q.volume).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StocksTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [sort, setSort] = useState('change')  // 'change' | 'alpha' | 'price'
  const searchTimer = useRef(null)

  const load = useCallback(() => {
    if (!prefs?.stock_tickers?.length) return
    setLoading(true)
    setError('')
    apiFetch('/stocks')
      .then(setQuotes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [prefs?.stock_tickers])

  useEffect(() => { load() }, [load])

  const doSearch = (q) => {
    clearTimeout(searchTimer.current)
    setSearchQ(q)
    if (q.length < 1) { setSearchResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try { setSearchResults(await apiFetch(`/stocks/search?q=${encodeURIComponent(q)}`)) }
      catch { setSearchResults([]) }
      setSearching(false)
    }, 500)
  }

  const addTicker = (ticker) => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    const current = prefs.stock_tickers || []
    if (current.includes(t)) return
    savePrefs({ stock_tickers: [...current, t] })
    setSearchQ('')
    setSearchResults([])
  }

  const removeTicker = (t) => savePrefs({ stock_tickers: (prefs.stock_tickers || []).filter(x => x !== t) })

  const marketOpen = isMarketOpen()

  const sorted = [...quotes].sort((a, b) => {
    if (sort === 'change') return Math.abs(b.change_pct) - Math.abs(a.change_pct)
    if (sort === 'alpha')  return a.ticker.localeCompare(b.ticker)
    if (sort === 'price')  return b.price - a.price
    return 0
  })

  const topGainer = quotes.length ? quotes.reduce((a, b) => a.change_pct > b.change_pct ? a : b) : null
  const topLoser  = quotes.length ? quotes.reduce((a, b) => a.change_pct < b.change_pct ? a : b) : null

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">Stock Watchlist</span>
        <button className="feeds-gear-btn" onClick={() => setShowSettings(s => !s)}>
          <IconGear /> {showSettings ? 'Close' : 'Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="feeds-settings-panel">
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Search for a stock</span>
            <input className="feeds-settings-input" placeholder="e.g. Apple, Tesla, NVDA…"
              value={searchQ} onChange={e => doSearch(e.target.value)} />
            {searching && <div className="feeds-loading">Searching…</div>}
            {searchResults.length > 0 && (
              <div className="feeds-search-results">
                {searchResults.map(r => (
                  <div key={r.ticker} className="feeds-search-result-item">
                    <div>
                      <div className="feeds-search-result-name">{r.ticker} — {r.name}</div>
                      <div className="feeds-search-result-meta">{r.type} · {r.region} · {r.currency}</div>
                    </div>
                    <button className="feeds-add-btn"
                      onClick={() => addTicker(r.ticker)}
                      disabled={(prefs.stock_tickers || []).includes(r.ticker)}>
                      {(prefs.stock_tickers || []).includes(r.ticker) ? '✓' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(prefs?.stock_tickers || []).length > 0 && (
            <div className="feeds-settings-row">
              <span className="feeds-settings-label">Watchlist</span>
              <div className="feeds-source-chips">
                {prefs.stock_tickers.map(t => (
                  <div key={t} className="feeds-chip">
                    {t}
                    <button className="feeds-chip-remove" onClick={() => removeTicker(t)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select className="feeds-refresh-select" value={prefs.refresh_stocks_min}
              onChange={e => savePrefs({ refresh_stocks_min: Number(e.target.value) })}>
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>Apply & Refresh</button>
          </div>
        </div>
      )}

      {!prefs?.stock_tickers?.length && (
        <div className="feeds-empty">No stocks in watchlist. Open Settings to add stocks.</div>
      )}

      {loading && <div className="feeds-loading">Fetching quotes…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {!loading && quotes.length > 0 && (
        <>
          <div className="feeds-stocks-summary">
            {topGainer && (
              <div className="feeds-stocks-summary-item">
                <span className="feeds-stocks-summary-label">Top Gainer</span>
                <span className="feeds-stocks-summary-val" style={{ color: '#00cc44' }}>
                  {topGainer.ticker} +{parseFloat(topGainer.change_pct).toFixed(2)}%
                </span>
              </div>
            )}
            {topLoser && topLoser.ticker !== topGainer?.ticker && (
              <div className="feeds-stocks-summary-item">
                <span className="feeds-stocks-summary-label">Top Loser</span>
                <span className="feeds-stocks-summary-val" style={{ color: '#ff3322' }}>
                  {topLoser.ticker} {parseFloat(topLoser.change_pct).toFixed(2)}%
                </span>
              </div>
            )}
            <div className="feeds-stocks-summary-item">
              <span className="feeds-stocks-summary-label">Watching</span>
              <span className="feeds-stocks-summary-val" style={{ color: 'var(--text)' }}>{quotes.length} stocks</span>
            </div>
            <div className="feeds-market-status">
              <div className={`feeds-market-dot feeds-market-dot--${marketOpen ? 'open' : 'closed'}`} />
              <span className="feeds-market-label">US Market {marketOpen ? 'Open' : 'Closed'}</span>
            </div>
          </div>

          <div className="feeds-stocks-controls">
            <span className="feeds-sort-label">Sort:</span>
            {[['change', 'By Move'], ['alpha', 'A–Z'], ['price', 'By Price']].map(([val, label]) => (
              <button key={val}
                className={`feeds-sort-btn${sort === val ? ' feeds-sort-btn--active' : ''}`}
                onClick={() => setSort(val)}>{label}</button>
            ))}
          </div>

          <div className="feeds-stocks-grid">
            {sorted.map(q => <StockCard key={q.ticker} q={q} />)}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
            Click any card to expand · 30-day chart loads on demand
          </div>
        </>
      )}
    </>
  )
}

function wmoIcon(code) {
  if (code === 0)                       return '☀️'
  if (code === 1)                       return '🌤️'
  if (code === 2)                       return '⛅'
  if (code === 3)                       return '☁️'
  if (code === 45 || code === 48)       return '🌫️'
  if (code >= 51 && code <= 55)         return '🌦️'
  if (code >= 61 && code <= 65)         return '🌧️'
  if (code >= 71 && code <= 77)         return '🌨️'
  if (code >= 80 && code <= 82)         return '🌧️'
  if (code === 85 || code === 86)       return '🌨️'
  if (code === 95)                      return '⛈️'
  if (code === 96 || code === 99)       return '⛈️'
  return '🌡️'
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch { return iso }
}

function IconNews() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="3" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="5" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="5" y1="13" x2="11" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconWeather() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 19a6 6 0 0 1 14 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="12" y1="1" x2="12" y2="3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="12" y1="12.5" x2="12" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="3.5" y1="8" x2="1" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="23" y1="8" x2="20.5" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function IconSports() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 2.5 C7 5 7 15 10 17.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 2.5 C13 5 13 15 10 17.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconStocks() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <polyline points="2,14 6,9 10,12 14,6 18,8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
      <line x1="2" y1="17" x2="18" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
