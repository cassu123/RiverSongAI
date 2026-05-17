import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * FeedsPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Ambient news, markets, and aviation telemetry.
 */

export default function FeedsPage({ setAction }) {
  const { token } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveRoot] = useState('news') // PERS/HSE pattern equivalent

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/pulse/latest', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setData(await res.json())
    } catch {} finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    setAction(
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`rs-pill ${activeTab === 'news' ? 'is-active' : ''}`} onClick={() => setActiveRoot('news')}>NEWS</button>
        <button className={`rs-pill ${activeTab === 'markets' ? 'is-active' : ''}`} onClick={() => setActiveRoot('markets')}>MARKETS</button>
        <button className={`rs-pill ${activeTab === 'aviation' ? 'is-active' : ''}`} onClick={() => setActiveRoot('aviation')}>AVIATION</button>
        <button className="rs-pill" onClick={() => { setLoading(true); fetchData(); }} title="Resync Pulse">
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>sync</span>
        </button>
      </div>
    )
  }, [activeTab, setAction, fetchData])

  if (loading && !data) return <div className="rs-card-meta" style={{ padding: 48 }}>SYNCHRONIZING PULSE...</div>

  const { news = {}, markets = {}, flights = {} } = data || {}

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Ambient Pulse</h1>
        <div className="rs-greeting-sub">Global telemetry and sector activity reports.</div>
      </div>

      <div className="rs-card-flow">

        {activeTab === 'news' && (
          <div className="rs-card is-wide">
            <div className="rs-card-head">
              <span className="rs-card-label">INTEL FEED</span>
              <span className="rs-card-label" style={{ opacity: 0.5 }}>{news.source || 'GLOBAL'}</span>
            </div>
            <div className="rs-card-value" style={{ fontSize: '1.4rem', lineHeight: 1.3 }}>{news.headline || 'No headlines available.'}</div>
            <div className="rs-card-meta" style={{ marginTop: 16 }}>{news.summary}</div>
            {news.url && (
              <a href={news.url} target="_blank" rel="noreferrer" className="rs-btn-primary" style={{ marginTop: 24, textDecoration: 'none' }}>
                OPEN SOURCE
              </a>
            )}
          </div>
        )}

        {activeTab === 'markets' && (
          <div className="rs-card is-wide">
             <div className="rs-card-head">
               <span className="rs-card-label">ECONOMICS</span>
               <span className="rs-card-label" style={{ color: markets.change >= 0 ? '#4ade80' : '#f87171' }}>
                 {markets.change >= 0 ? '+' : ''}{markets.change_percent?.toFixed(2)}%
               </span>
             </div>
             <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
               <div className="rs-card-value" style={{ fontSize: '2rem', fontFamily: 'var(--font-mono)' }}>{markets.symbol}</div>
               <div className="rs-card-value" style={{ fontSize: '1.5rem', opacity: 0.8 }}>${markets.price?.toLocaleString()}</div>
             </div>
             <div className="rs-card-meta">Real-time ticker tracking enabled.</div>
          </div>
        )}

        {activeTab === 'aviation' && (
          <>
            <div className="rs-card is-wide">
              <div className="rs-card-head">
                <span className="rs-card-label">SECTOR SURVEILLANCE</span>
                <span className="rs-card-label">{flights.flights?.length || 0} TRACKED</span>
              </div>
              <div className="rs-card-value">Aviation Telemetry</div>
              <div className="rs-card-meta">Scanning for transponders in local airspace.</div>
            </div>
            {flights.flights?.map((f, i) => (
              <div key={i} className="rs-card">
                <div className="rs-card-head">
                  <span className="rs-card-label">{f.callsign || 'UNKNOWN'}</span>
                  <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>{f.altitude?.toLocaleString()} FT</span>
                </div>
                <div className="rs-card-value" style={{ fontSize: '1rem' }}>{f.origin} → {f.destination}</div>
                <div className="rs-card-meta">{f.aircraft_type || 'Civilian Aircraft'}</div>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  )
}
