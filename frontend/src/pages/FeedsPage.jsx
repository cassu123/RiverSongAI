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
        // API now returns { sources: [...], categories: {...} }
        // Keep backward compat with old array shape
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

  // Countdown timer
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

      // Fire browser notifications for new Extreme/Severe alerts
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
    } catch (_) { /* silently ignore alert failures */ }
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

  // Auto-poll alerts every 5 minutes independently of the weather refresh
  useEffect(() => {
    if (prefs?.weather_lat == null) return
    alertPollRef.current = setInterval(loadAlerts, 5 * 60 * 1000)
    return () => clearInterval(alertPollRef.current)
  }, [loadAlerts])

  // Fetch RainViewer radar frames
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
      {/* Extreme/Severe alert banner — shown at very top */}
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
          {/* Refresh countdown */}
          {secondsLeft > 0 && (
            <div className="feeds-refresh-bar">
              <div className="feeds-refresh-progress">
                <div className="feeds-refresh-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span>Refresh in {minsLeft}:{String(secsLeft).padStart(2, '0')}</span>
              <button className="feeds-refresh-now-btn" onClick={load}>Refresh now</button>
            </div>
          )}

          {/* Current conditions */}
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

          {/* Active alerts — right below current conditions */}
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

          {/* Hourly strip */}
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

          {/* 7-day forecast */}
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

          {/* Air quality */}
          {weather.air_quality?.aqi != null && (
            <>
              <div className="feeds-subsection-label">Air Quality</div>
              <AirQualityPanel aq={weather.air_quality} />
            </>
          )}

          {/* Radar */}
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

  // Init map once
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

  // Pre-load all radar layers when frames arrive
  useEffect(() => {
    if (!frames.length || !instanceRef.current || !LRef.current) return
    const L = LRef.current
    const map = instanceRef.current
    // Remove old layers
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

  // Show only active frame
  useEffect(() => {
    layersRef.current.forEach((l, i) => {
      l.setOpacity(i === frameIdx ? 0.65 : 0)
    })
  }, [frameIdx])

  // Animation loop
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
  const [showSettings, setShowSettings] = useState(false)
  const [sportsTab, setSportsTab] = useState('results')
  const [filterTeam, setFilterTeam] = useState('all')
  const [data, setData] = useState(null)
  const [standings, setStandings] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)
  const [headlines, setHeadlines] = useState([])
  const [headlinesLoading, setHeadlinesLoading] = useState(false)
  const [headlinesError, setHeadlinesError] = useState('')
  const [headlineSearch, setHeadlineSearch] = useState('')
  const [allSportsSources, setAllSportsSources] = useState([])
  const [sportsCatMeta, setSportsCatMeta] = useState({})

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

  // Load standings for all unique leagues of followed teams
  useEffect(() => {
    if (!prefs?.sport_teams?.length) return
    const leagueIds = [...new Set(prefs.sport_teams.map(t => t.league_id).filter(Boolean))]
    leagueIds.forEach(id => {
      apiFetch(`/sports/standings?league_id=${id}`)
        .then(rows => setStandings(prev => ({ ...prev, [id]: rows })))
        .catch(() => {})
    })
  }, [prefs?.sport_teams])

  // Load available sports RSS sources
  useEffect(() => {
    apiFetch('/sports/news/sources')
      .then(data => {
        setAllSportsSources(Array.isArray(data) ? data : (data.sources || []))
        setSportsCatMeta(Array.isArray(data) ? {} : (data.categories || {}))
      })
      .catch(() => {})
  }, [])

  // Reload sports headlines whenever selected sources change
  const loadHeadlines = useCallback(() => {
    setHeadlinesLoading(true)
    setHeadlinesError('')
    apiFetch('/sports/news')
      .then(setHeadlines)
      .catch(e => setHeadlinesError(e.message))
      .finally(() => setHeadlinesLoading(false))
  }, [prefs?.sports_news_sources]) // eslint-disable-line

  useEffect(() => { loadHeadlines() }, [loadHeadlines])

  const doSearch = (q) => {
    clearTimeout(searchTimer.current)
    setSearchQ(q)
    if (q.length < 2) { setSearchResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try { setSearchResults(await apiFetch(`/sports/search?q=${encodeURIComponent(q)}`)) }
      catch { setSearchResults([]) }
      setSearching(false)
    }, 400)
  }

  const addTeam = (team) => {
    const current = prefs.sport_teams || []
    if (current.find(t => t.id === team.id)) return
    savePrefs({ sport_teams: [...current, team] })
  }
  const removeTeam = (id) => savePrefs({ sport_teams: (prefs.sport_teams || []).filter(t => t.id !== id) })
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

  // Standings to show: leagues of filtered team, or all
  const standingLeagues = filterTeam === 'all'
    ? Object.entries(standings)
    : Object.entries(standings).filter(([id]) => {
        const team = teams.find(t => t.id === filterTeam)
        return team?.league_id === id
      })

  const followedTeamIds = new Set(teams.map(t => t.id))

  if (selectedEvent) {
    return <MatchStats event={selectedEvent} onBack={() => setSelectedEvent(null)} />
  }

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">Your Teams</span>
        <button className="feeds-gear-btn" onClick={() => setShowSettings(s => !s)}>
          <IconGear /> {showSettings ? 'Close' : 'Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="feeds-settings-panel">
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Search & add teams</span>
            <input className="feeds-settings-input" placeholder="Search for a team…"
              value={searchQ} onChange={e => doSearch(e.target.value)} />
            {searching && <div className="feeds-loading">Searching…</div>}
            {searchResults.length > 0 && (
              <div className="feeds-search-results">
                {searchResults.map(team => (
                  <div key={team.id} className="feeds-search-result-item">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {team.badge_url && <img src={team.badge_url} alt="" style={{ width: 28, height: 28, objectFit: 'contain' }} />}
                      <div>
                        <div className="feeds-search-result-name">{team.name}</div>
                        <div className="feeds-search-result-meta">{team.sport} · {team.league} · {team.country}</div>
                      </div>
                    </div>
                    <button className="feeds-add-btn" onClick={() => addTeam(team)} disabled={isAdded(team.id)}>
                      {isAdded(team.id) ? '✓ Added' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {teams.length > 0 && (
            <div className="feeds-settings-row">
              <span className="feeds-settings-label">Following ({teams.length})</span>
              <div className="feeds-source-chips">
                {teams.map(t => (
                  <div key={t.id} className="feeds-chip">
                    {t.badge_url && <img src={t.badge_url} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} />}
                    {t.name}
                    <button className="feeds-chip-remove" onClick={() => removeTeam(t.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {allSportsSources.length > 0 && (
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
              {(prefs?.sports_news_sources?.length ?? 0) === 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 8 }}>
                  No sources selected — all sports headlines are shown by default.
                </div>
              )}
            </div>
          )}

          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select className="feeds-refresh-select" value={prefs.refresh_sports_min}
              onChange={e => savePrefs({ refresh_sports_min: Number(e.target.value) })}>
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); loadHeadlines(); setShowSettings(false) }}>Apply & Refresh</button>
          </div>
        </div>
      )}

      {!teams.length && (
        <div className="feeds-empty">No teams followed. Open Settings and search for your teams.</div>
      )}

      {teams.length > 0 && (
        <>
          {/* Team filter chips */}
          <div className="feeds-team-filter">
            <button className={`feeds-team-chip${filterTeam === 'all' ? ' feeds-team-chip--active' : ''}`}
              onClick={() => setFilterTeam('all')}>All teams</button>
            {teams.map(t => (
              <button key={t.id}
                className={`feeds-team-chip${filterTeam === t.id ? ' feeds-team-chip--active' : ''}`}
                onClick={() => setFilterTeam(t.id)}>
                {t.badge_url && <img className="feeds-team-chip-badge" src={t.badge_url} alt="" />}
                {t.name}
              </button>
            ))}
          </div>

          {/* Sub-tabs */}
          <div className="feeds-sports-tab-bar">
            {['results', 'fixtures', 'standings', 'headlines'].map(tab => (
              <button key={tab}
                className={`feeds-sports-tab${sportsTab === tab ? ' feeds-sports-tab--active' : ''}`}
                onClick={() => setSportsTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {loading && <div className="feeds-loading">Fetching data…</div>}
          {error && <div className="feeds-error">{error}</div>}

          {data && !loading && sportsTab === 'results' && (
            <>
              {filterEvents(data.results).length > 0
                ? <div className="feeds-sports-grid">
                    {filterEvents(data.results).map(e => <MatchCard key={e.id} event={e} onClick={() => setSelectedEvent(e)} />)}
                  </div>
                : <div className="feeds-empty">No recent results found.</div>
              }
            </>
          )}

          {data && !loading && sportsTab === 'fixtures' && (
            <>
              {filterEvents(data.fixtures).length > 0
                ? <div className="feeds-sports-grid">
                    {filterEvents(data.fixtures).map(e => <MatchCard key={e.id} event={e} onClick={() => setSelectedEvent(e)} />)}
                  </div>
                : <div className="feeds-empty">No upcoming fixtures found.</div>
              }
            </>
          )}

          {sportsTab === 'standings' && (
            <>
              {standingLeagues.length === 0 && (
                <div className="feeds-empty">No standings available. Make sure your followed teams have a league assigned.</div>
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
              <input
                className="feeds-news-search"
                style={{ marginBottom: 12 }}
                placeholder="Search sports headlines…"
                value={headlineSearch}
                onChange={e => setHeadlineSearch(e.target.value)}
              />
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
                        <a
                          key={a.id || a.url}
                          className="feeds-news-list-item"
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
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
              {!headlinesLoading && !headlinesError && headlines.length === 0 && (
                <div className="feeds-empty">No sports headlines found.</div>
              )}
            </>
          )}
        </>
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
          {/* Summary bar */}
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

          {/* Sort controls */}
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

// =============================================================================
// WMO weather code → emoji icon
// =============================================================================

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

// =============================================================================
// Helpers
// =============================================================================

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch { return iso }
}

// =============================================================================
// Icons
// =============================================================================

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
