import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import Sheet, { SheetRow } from '../chrome/Sheet'
import 'leaflet/dist/leaflet.css'

/**
 * FeedsPage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Global Intelligence Station with Photo Clipping and Live Radar.
 * Implements 'Double-Bezel' and 'Cockpit' density.
 */

export default function FeedsPage({ setAction }) {
  const { token, user } = useAuth()
  const userId = user?.id || 'default'

  const [activeTab, setActiveTab] = useState('news')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [news, setNews] = useState([])
  const [weather, setWeather] = useState(null)
  const [sports, setSports] = useState({ results: [], fixtures: [] })
  const [stocks, setStocks] = useState([])
  
  const [prefs, setPrefs] = useState(null)
  const [allSources, setAllSources] = useState([])
  const [catMeta, setCatMeta] = useState({})
  const [pickerOpen, setPickerOpen] = useState(false)
  
  const [radarTs, setRadarTs] = useState(null)

  // -- Fetch Logic --
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
    } catch {}
  }, [token])

  const fetchFeed = useCallback(async (tab) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feeds/${tab}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Sector ${tab} unresponsive.`)
      const data = await res.json()
      if (tab === 'news') setNews(data)
      if (tab === 'weather') setWeather(data)
      if (tab === 'sports') setSports(data)
      if (tab === 'stocks') setStocks(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchPrefs() }, [fetchPrefs])
  useEffect(() => { fetchFeed(activeTab) }, [activeTab, fetchFeed])

  // Radar Sync
  useEffect(() => {
    if (activeTab === 'weather' && prefs?.weather_lat) {
      fetch('https://api.rainviewer.com/public/weather-maps.json')
        .then(r => r.json())
        .then(d => {
          const frames = d?.radar?.past || []
          if (frames.length) setRadarTs(frames[frames.length - 1].path)
        })
        .catch(() => {})
    }
  }, [activeTab, prefs])

  const saveSources = async (sources) => {
    const updated = { ...prefs, news_sources: sources }
    setPrefs(updated)
    await fetch('/api/feeds/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updated)
    })
    fetchFeed('news')
  }

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { key: 'news', icon: 'newspaper', label: 'INTEL' },
            { key: 'weather', icon: 'cloud', label: 'METEO' },
            { key: 'sports', icon: 'sports_kabaddi', label: 'COMBAT' },
            { key: 'stocks', icon: 'trending_up', label: 'MARKETS' }
          ].map(t => (
            <button key={t.key} className={`rs-pill ${activeTab === t.key ? 'is-active' : ''}`} onClick={() => setActiveTab(t.key)}>
              <span className="material-symbols-rounded">{t.icon}</span>
              <span className="rs-speak-actions-label">{t.label}</span>
            </button>
          ))}
          <div style={{ width: 1, height: 24, background: 'var(--md-outline-variant)', margin: '0 4px' }} />
          {activeTab === 'news' && (
            <button className="rs-pill" onClick={() => setPickerOpen(true)}>
              <span className="material-symbols-rounded">tune</span>
              <span className="rs-speak-actions-label">FREQUENCY</span>
            </button>
          )}
          <button className="rs-pill" onClick={() => fetchFeed(activeTab)}>
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
  }, [activeTab, setAction, fetchFeed])

  const renderNews = () => (
    <div className="rs-card-flow">
      {news.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>Intelligence frequency silent.</div>
      ) : (
        news.map((item, i) => (
          <div key={i} className="rs-card is-tappable animate-page-in" style={{ padding: 0, overflow: 'hidden' }} onClick={() => window.open(item.url, '_blank')}>
            <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
               <div style={{ position: 'relative', width: '100%', aspectRatio: '16/10', overflow: 'hidden', background: 'var(--md-surface-container-highest)' }}>
                 {item.image_url ? (
                   <img src={item.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                 ) : (
                   <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.1 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '4rem' }}>satellite_alt</span>
                   </div>
                 )}
                 <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 60%)' }} />
                 <div style={{ position: 'absolute', top: 12, left: 12 }}>
                   <span className="rs-pill" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', fontSize: '0.6rem', border: '1px solid rgba(255,255,255,0.1)' }}>{item.source?.toUpperCase()}</span>
                 </div>
               </div>
               <div style={{ padding: 20 }}>
                 <div className="rs-card-value" style={{ fontSize: '1.15rem', lineHeight: 1.25, fontWeight: 700, marginBottom: 12 }}>{item.title}</div>
                 <div className="rs-card-meta" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: '0.85rem' }}>{item.summary}</div>
                 <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.5 }}>
                    <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>{new Date(item.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>arrow_forward</span>
                 </div>
               </div>
            </div>
          </div>
        ))
      )}
    </div>
  )

  const renderWeather = () => {
    if (!weather) return <div className="rs-card-meta">Meteo sensor array offline.</div>
    const { current = {}, daily = [] } = weather
    return (
      <div className="rs-card-flow">
        <div className="rs-card is-wide is-elev">
           <div className="rs-card-inner">
              <div className="rs-card-head">
                <span className="rs-card-label">ATMOSPHERIC TELEMETRY</span>
                <span className="rs-card-label">{weather.location?.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 64, flexWrap: 'wrap', padding: '12px 0' }}>
                 <div style={{ fontSize: '5.5rem', fontWeight: 900, letterSpacing: '-0.08em', color: 'var(--primary)', lineHeight: 1 }}>{Math.round(current.temp)}°</div>
                 <div style={{ flex: 1 }}>
                    <div className="rs-card-value" style={{ fontSize: '2rem', textTransform: 'uppercase' }}>{current.condition}</div>
                    <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                       <div><div className="rs-card-label">FEELS</div><div className="rs-card-value" style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>{Math.round(current.feels_like)}°</div></div>
                       <div><div className="rs-card-label">WIND</div><div className="rs-card-value" style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>{current.wind_speed} <small style={{ fontSize: '0.6rem' }}>KM/H</small></div></div>
                    </div>
                 </div>
              </div>
           </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, width: '100%' }}>
           <div className="rs-card">
              <div className="rs-card-inner">
                <div className="rs-card-label" style={{ marginBottom: 20 }}>7-DAY PROJECTION</div>
                {daily.slice(1, 8).map((day, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 6 ? '1px solid var(--md-outline-variant)' : 'none' }}>
                    <span style={{ fontWeight: 800, width: 50 }}>{new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                    <span className="rs-card-meta" style={{ flex: 1, textTransform: 'uppercase', fontSize: '0.7rem' }}>{day.condition}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{Math.round(day.temp_max)}° / {Math.round(day.temp_min)}°</span>
                  </div>
                ))}
              </div>
           </div>
           <div className="rs-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="rs-card-label" style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: 20 }}>LIVE RADAR</div>
              <RadarMap lat={prefs?.weather_lat} lon={prefs?.weather_lon} radarTs={radarTs} />
           </div>
        </div>
      </div>
    )
  }

  const renderSports = () => (
    <div className="rs-card-flow">
      {(!sports.results?.length && !sports.fixtures?.length) ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>Combat data streams clear.</div>
      ) : (
        <>
          {sports.results?.map((res, i) => (
            <div key={`res-${i}`} className="rs-card animate-page-in">
               <div className="rs-card-inner">
                  <div className="rs-card-head"><span className="rs-card-label" style={{ color: '#4ade80' }}>FINAL</span><span className="rs-card-label">{res.league}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
                     <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>{res.home_team}</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900, color: res.home_score > res.away_score ? 'var(--primary)' : 'inherit' }}>{res.home_score}</div>
                     </div>
                     <div style={{ opacity: 0.2, fontWeight: 900, fontSize: '1.5rem' }}>:</div>
                     <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 8 }}>{res.away_team}</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900, color: res.away_score > res.home_score ? 'var(--primary)' : 'inherit' }}>{res.away_score}</div>
                     </div>
                  </div>
               </div>
            </div>
          ))}
          {/* ... fixtures similarly ... */}
        </>
      )}
    </div>
  )

  const renderStocks = () => (
    <div className="rs-card-flow">
      {stocks.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 48, textAlign: 'center' }}>Market cycle scanning...</div>
      ) : (
        stocks.map((s, i) => (
          <div key={i} className="rs-card animate-page-in">
             <div className="rs-card-inner">
                <div className="rs-card-head">
                   <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}>{s.symbol}</span>
                   <div className="rs-status-strip" style={{ background: s.change >= 0 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: s.change >= 0 ? '#4ade80' : '#f87171' }}>
                      {s.change >= 0 ? '▲' : '▼'} {Math.abs(s.change_percent)?.toFixed(2)}%
                   </div>
                </div>
                <div className="rs-card-value" style={{ fontSize: '2.4rem', fontWeight: 900, margin: '8px 0', fontFamily: 'var(--font-mono)' }}>${s.price?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                <div className="rs-card-meta" style={{ fontWeight: 700 }}>{s.name}</div>
             </div>
          </div>
        ))
      )}
    </div>
  )

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Global Intelligence</h1>
        <div className="rs-greeting-sub">Sector activity reports and environmental telemetry.</div>
      </div>

      {error ? (
        <div className="rs-card is-wide" style={{ borderColor: 'var(--md-error)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>SECTOR ERROR</div>
            <div className="rs-card-meta">{error}</div>
            <button className="rs-pill" style={{ marginTop: 16 }} onClick={() => fetchFeed(activeTab)}>RE-SYNC BAND</button>
          </div>
        </div>
      ) : loading && news.length === 0 ? (
        <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>INITIALIZING {activeTab.toUpperCase()} STREAM...</div>
      ) : (
        <div className="animate-page-in">
          {activeTab === 'news' && renderNews()}
          {activeTab === 'weather' && renderWeather()}
          {activeTab === 'sports' && renderSports()}
          {activeTab === 'stocks' && renderStocks()}
        </div>
      )}

      {/* Frequency Sheet */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Sector Intelligence">
        <div style={{ padding: '0 16px 24px' }}>
          <p className="rs-card-meta" style={{ marginBottom: 20 }}>Select frequency bands to monitor for global news.</p>
          {Object.entries(catMeta).map(([cat, meta]) => (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div className="rs-card-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>{meta.icon}</span>
                  {meta.label.toUpperCase()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {allSources.filter(s => s.category === cat).map(src => {
                  const active = (prefs?.news_sources || []).some(s => s.url === src.url)
                  return (
                    <button key={src.url} className={`rs-pill ${active ? 'is-active' : ''}`} onClick={() => {
                        const current = prefs?.news_sources || []
                        const next = active ? current.filter(s => s.url !== src.url) : [...current, src]
                        saveSources(next)
                    }}>{src.name.toUpperCase()}</button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

function RadarMap({ lat, lon, radarTs }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const radarLayerRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || !lat || !lon) return
    import('leaflet').then(L => {
      if (instanceRef.current) return 
      const map = L.map(mapRef.current, { center: [lat, lon], zoom: 8, zoomControl: false, attributionControl: false })
      instanceRef.current = map
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map)
    })
    return () => { if (instanceRef.current) { instanceRef.current.remove(); instanceRef.current = null; } }
  }, [lat, lon])

  useEffect(() => {
    if (!instanceRef.current || !radarTs) return
    import('leaflet').then(L => {
      if (radarLayerRef.current) instanceRef.current.removeLayer(radarLayerRef.current)
      radarLayerRef.current = L.tileLayer(`https://tilecache.rainviewer.com${radarTs}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0.6 })
      radarLayerRef.current.addTo(instanceRef.current)
    })
  }, [radarTs])

  return <div ref={mapRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />
}
