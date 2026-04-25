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

function NewsTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [allSources, setAllSources] = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/news/sources').then(setAllSources).catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!prefs?.news_sources?.length) return
    setLoading(true)
    setError('')
    apiFetch('/news')
      .then(setArticles)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [prefs?.news_sources])

  useEffect(() => { load() }, [load])

  const categories = [...new Set(allSources.map(s => s.category))]

  const toggleSource = (src) => {
    const current = prefs.news_sources || []
    const exists = current.find(s => s.url === src.url)
    const updated = exists ? current.filter(s => s.url !== src.url) : [...current, src]
    savePrefs({ news_sources: updated })
  }

  const isSelected = (src) => (prefs?.news_sources || []).some(s => s.url === src.url)

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">Latest Headlines</span>
        <button className="feeds-gear-btn" onClick={() => setShowSettings(s => !s)}>
          <IconGear /> {showSettings ? 'Close' : 'Settings'}
        </button>
      </div>

      {showSettings && (
        <div className="feeds-settings-panel">
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Select news sources</span>
            {categories.map(cat => (
              <div key={cat}>
                <div className="feeds-sports-section-title" style={{ marginTop: 12 }}>{cat}</div>
                <div className="feeds-source-category-grid">
                  {allSources.filter(s => s.category === cat).map(src => (
                    <button
                      key={src.url}
                      className={`feeds-source-cat-btn${isSelected(src) ? ' feeds-source-cat-btn--active' : ''}`}
                      onClick={() => toggleSource(src)}
                    >
                      {src.name}
                      {isSelected(src) && <span>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select
              className="feeds-refresh-select"
              value={prefs.refresh_news_min}
              onChange={e => savePrefs({ refresh_news_min: Number(e.target.value) })}
            >
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>
              Apply & Refresh
            </button>
          </div>
        </div>
      )}

      {!prefs?.news_sources?.length && (
        <div className="feeds-empty">
          No sources selected. Open Settings to pick your news sources.
        </div>
      )}

      {loading && <div className="feeds-loading">Fetching headlines…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {!loading && articles.length > 0 && (
        <div className="feeds-news-grid">
          {articles.map((a, i) => (
            <a key={i} className="feeds-news-card" href={a.url} target="_blank" rel="noopener noreferrer">
              <span className="feeds-news-source">{a.source}</span>
              <span className="feeds-news-title">{a.title}</span>
              {a.summary && <span className="feeds-news-summary">{a.summary}</span>}
              {a.published_at && (
                <span className="feeds-news-date">{formatDate(a.published_at)}</span>
              )}
            </a>
          ))}
        </div>
      )}
    </>
  )
}

// =============================================================================
// WEATHER TAB
// =============================================================================

function WeatherTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [weather, setWeather] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [locating, setLocating] = useState(false)
  const [radarTs, setRadarTs] = useState(null)

  const load = useCallback(() => {
    if (prefs?.weather_lat == null) return
    setLoading(true)
    setError('')
    apiFetch('/weather')
      .then(setWeather)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [prefs?.weather_lat, prefs?.weather_lon, prefs?.weather_unit])

  useEffect(() => { load() }, [load])

  // Fetch latest RainViewer radar timestamp
  useEffect(() => {
    if (prefs?.weather_lat == null) return
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(d => {
        const frames = d?.radar?.past || []
        if (frames.length) setRadarTs(frames[frames.length - 1].path)
      })
      .catch(() => {})
  }, [prefs?.weather_lat])

  const getLocation = () => {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        savePrefs({ weather_lat: pos.coords.latitude, weather_lon: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setError('Location permission denied.')
        setLocating(false)
      }
    )
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <>
      <div className="feeds-section-header">
        <span className="feeds-section-title">Current Weather</span>
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
            <select
              className="feeds-refresh-select"
              value={prefs.weather_unit}
              onChange={e => savePrefs({ weather_unit: e.target.value })}
            >
              <option value="celsius">Celsius (°C)</option>
              <option value="fahrenheit">Fahrenheit (°F)</option>
            </select>
          </div>
          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select
              className="feeds-refresh-select"
              value={prefs.refresh_weather_min}
              onChange={e => savePrefs({ refresh_weather_min: Number(e.target.value) })}
            >
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>
              Apply & Refresh
            </button>
          </div>
        </div>
      )}

      {prefs?.weather_lat == null && (
        <div className="feeds-empty">
          No location set. Open Settings and click "Use My Location".
        </div>
      )}

      {loading && <div className="feeds-loading">Fetching weather…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {weather && !loading && (
        <>
          {/* Current conditions */}
          <div className="feeds-weather-current">
            <div>
              <div className="feeds-weather-temp">
                {Math.round(weather.current.temperature)}{weather.unit}
              </div>
              <div className="feeds-weather-condition">{weather.current.condition}</div>
            </div>
            <div className="feeds-weather-meta">
              <div className="feeds-weather-meta-item">
                Feels like {Math.round(weather.current.feels_like)}{weather.unit}
              </div>
              <div className="feeds-weather-meta-item">
                Humidity {weather.current.humidity}%
              </div>
              <div className="feeds-weather-meta-item">
                Wind {weather.current.wind_speed} {weather.current.wind_unit}
              </div>
              {weather.current.precipitation > 0 && (
                <div className="feeds-weather-meta-item">
                  Precipitation {weather.current.precipitation} mm
                </div>
              )}
            </div>
          </div>

          {/* Hourly strip */}
          {weather.hourly?.length > 0 && (
            <>
              <div className="feeds-subsection-label">Next 24 Hours</div>
              <div className="feeds-hourly-strip">
                {weather.hourly.map((h, i) => {
                  const t = new Date(h.time)
                  const label = i === 0 ? 'Now' : t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={h.time} className={`feeds-hourly-item${i === 0 ? ' feeds-hourly-item--now' : ''}`}>
                      <div className="feeds-hourly-time">{label}</div>
                      <div className="feeds-hourly-temp">{Math.round(h.temperature)}{weather.unit}</div>
                      <div className="feeds-hourly-cond">{h.condition}</div>
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
              return (
                <div key={day.date} className="feeds-weather-day">
                  <div className="feeds-weather-day-name">{name}</div>
                  <div className="feeds-weather-day-high">{Math.round(day.temp_max)}{weather.unit}</div>
                  <div className="feeds-weather-day-low">{Math.round(day.temp_min)}{weather.unit}</div>
                  <div className="feeds-weather-day-cond">{day.condition}</div>
                </div>
              )
            })}
          </div>

          {/* Radar */}
          <div className="feeds-subsection-label">Live Radar</div>
          <RadarMap lat={prefs.weather_lat} lon={prefs.weather_lon} radarTs={radarTs} />
        </>
      )}
    </>
  )
}

function RadarMap({ lat, lon, radarTs }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const radarLayerRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current) return
    // Dynamically import leaflet to avoid SSR/init issues
    import('leaflet').then(L => {
      if (instanceRef.current) return // already initialised

      const map = L.map(mapRef.current, {
        center: [lat, lon],
        zoom: 7,
        zoomControl: true,
      })
      instanceRef.current = map

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map)
    })

    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove()
        instanceRef.current = null
        radarLayerRef.current = null
      }
    }
  }, []) // only on mount

  // Update radar layer when timestamp arrives
  useEffect(() => {
    if (!instanceRef.current || !radarTs) return
    import('leaflet').then(L => {
      if (radarLayerRef.current) {
        instanceRef.current.removeLayer(radarLayerRef.current)
      }
      radarLayerRef.current = L.tileLayer(
        `https://tilecache.rainviewer.com${radarTs}/256/{z}/{x}/{y}/2/1_1.png`,
        { opacity: 0.7, attribution: '&copy; RainViewer' }
      ).addTo(instanceRef.current)
    })
  }, [radarTs])

  return <div className="feeds-radar-wrap" ref={mapRef} />
}

// =============================================================================
// SPORTS TAB
// =============================================================================

function SportsTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)

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

  const searchTeams = (q) => {
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setSearchResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await apiFetch(`/sports/search?q=${encodeURIComponent(q)}`)
        setSearchResults(res)
      } catch { setSearchResults([]) }
      setSearching(false)
    }, 400)
  }

  const addTeam = (team) => {
    const current = prefs.sport_teams || []
    if (current.find(t => t.id === team.id)) return
    savePrefs({ sport_teams: [...current, team] })
  }

  const removeTeam = (id) => {
    savePrefs({ sport_teams: (prefs.sport_teams || []).filter(t => t.id !== id) })
  }

  const isAdded = (id) => (prefs?.sport_teams || []).some(t => t.id === id)

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
            <span className="feeds-settings-label">Add teams</span>
            <input
              className="feeds-settings-input"
              placeholder="Search for a team…"
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); searchTeams(e.target.value) }}
            />
            {searching && <div className="feeds-loading">Searching…</div>}
            {searchResults.length > 0 && (
              <div className="feeds-search-results">
                {searchResults.map(team => (
                  <div key={team.id} className="feeds-search-result-item">
                    <div>
                      <div className="feeds-search-result-name">{team.name}</div>
                      <div className="feeds-search-result-meta">{team.sport} · {team.league}</div>
                    </div>
                    <button
                      className="feeds-add-btn"
                      onClick={() => addTeam(team)}
                      disabled={isAdded(team.id)}
                    >
                      {isAdded(team.id) ? 'Added' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(prefs?.sport_teams || []).length > 0 && (
            <div className="feeds-settings-row">
              <span className="feeds-settings-label">Following</span>
              <div className="feeds-source-chips">
                {prefs.sport_teams.map(t => (
                  <div key={t.id} className="feeds-chip">
                    {t.badge_url && <img src={t.badge_url} alt="" style={{ width: 16, height: 16, objectFit: 'contain' }} />}
                    {t.name}
                    <button className="feeds-chip-remove" onClick={() => removeTeam(t.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="feeds-settings-row">
            <span className="feeds-settings-label">Refresh interval</span>
            <select
              className="feeds-refresh-select"
              value={prefs.refresh_sports_min}
              onChange={e => savePrefs({ refresh_sports_min: Number(e.target.value) })}
            >
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>
              Apply & Refresh
            </button>
          </div>
        </div>
      )}

      {!prefs?.sport_teams?.length && (
        <div className="feeds-empty">
          No teams followed. Open Settings and search for your teams.
        </div>
      )}

      {loading && <div className="feeds-loading">Fetching results…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {data && !loading && (
        <>
          {data.results.length > 0 && (
            <div>
              <div className="feeds-sports-section-title">Recent Results</div>
              <div className="feeds-sports-grid">
                {data.results.map(e => <SportEventCard key={e.id} event={e} />)}
              </div>
            </div>
          )}
          {data.fixtures.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="feeds-sports-section-title">Upcoming Fixtures</div>
              <div className="feeds-sports-grid">
                {data.fixtures.map(e => <SportEventCard key={e.id} event={e} />)}
              </div>
            </div>
          )}
          {data.results.length === 0 && data.fixtures.length === 0 && (
            <div className="feeds-empty">No recent results or upcoming fixtures found.</div>
          )}
        </>
      )}
    </>
  )
}

function SportEventCard({ event }) {
  return (
    <div className="feeds-sports-card">
      <div className="feeds-sports-teams">
        <div className="feeds-sports-team">
          {event.home_badge && <img className="feeds-sports-badge" src={event.home_badge} alt="" />}
          <span className="feeds-sports-team-name">{event.home_team}</span>
        </div>

        <div className={`feeds-sports-score${!event.finished ? ' feeds-sports-score--upcoming' : ''}`}>
          {event.finished
            ? `${event.home_score} – ${event.away_score}`
            : event.time || 'vs'
          }
        </div>

        <div className="feeds-sports-team feeds-sports-team--away">
          {event.away_badge && <img className="feeds-sports-badge" src={event.away_badge} alt="" />}
          <span className="feeds-sports-team-name">{event.away_team}</span>
        </div>
      </div>

      <div className="feeds-sports-meta">
        <div>{event.date}</div>
        <div>{event.league}</div>
      </div>
    </div>
  )
}

// =============================================================================
// STOCKS TAB
// =============================================================================

function StocksTab({ prefs, savePrefs }) {
  const [showSettings, setShowSettings] = useState(false)
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tickerInput, setTickerInput] = useState('')

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

  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase()
    if (!t) return
    const current = prefs.stock_tickers || []
    if (current.includes(t)) return
    savePrefs({ stock_tickers: [...current, t] })
    setTickerInput('')
  }

  const removeTicker = (t) => {
    savePrefs({ stock_tickers: (prefs.stock_tickers || []).filter(x => x !== t) })
  }

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
            <span className="feeds-settings-label">Add ticker symbol</span>
            <div className="feeds-location-row">
              <input
                className="feeds-settings-input"
                placeholder="e.g. AAPL, TSLA, NVDA"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTicker()}
                style={{ flex: 1 }}
              />
              <button className="btn--primary" onClick={addTicker}>Add</button>
            </div>
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
            <select
              className="feeds-refresh-select"
              value={prefs.refresh_stocks_min}
              onChange={e => savePrefs({ refresh_stocks_min: Number(e.target.value) })}
            >
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="feeds-settings-actions">
            <button className="btn--primary" onClick={() => { load(); setShowSettings(false) }}>
              Apply & Refresh
            </button>
          </div>
        </div>
      )}

      {!prefs?.stock_tickers?.length && (
        <div className="feeds-empty">
          No tickers in watchlist. Open Settings to add stock symbols.
        </div>
      )}

      {loading && <div className="feeds-loading">Fetching quotes…</div>}
      {error && <div className="feeds-error">{error}</div>}

      {!loading && quotes.length > 0 && (
        <div className="feeds-stocks-grid">
          {quotes.map(q => (
            <div key={q.ticker} className="feeds-stock-card">
              <div className="feeds-stock-ticker">{q.ticker}</div>
              <div className="feeds-stock-price">${q.price.toFixed(2)}</div>
              <div className={`feeds-stock-change feeds-stock-change--${q.up ? 'up' : 'down'}`}>
                {q.up ? '▲' : '▼'} {q.change > 0 ? '+' : ''}{q.change.toFixed(2)} ({q.change_pct > 0 ? '+' : ''}{q.change_pct.toFixed(2)}%)
              </div>
              <div className="feeds-stock-meta">
                <div className="feeds-stock-meta-item">Open: ${q.open}</div>
                <div className="feeds-stock-meta-item">High: ${q.high} · Low: ${q.low}</div>
                <div className="feeds-stock-meta-item">Prev close: ${q.prev_close}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
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
