import React, { useState, useEffect, useCallback } from 'react'

export default function PulseWidget({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/pulse/latest', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch pulse')
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60000) // update UI every minute (server updates every 5)
    return () => clearInterval(id)
  }, [fetchData])

  if (loading && !data) return <div className="pulse-loading">SYNCING PULSE...</div>
  if (error && !data) return <div className="pulse-error">{error}</div>
  if (!data) return null

  const { news, markets, flights, ts } = data

  const fmtTs = (epoch) => {
    if (!epoch) return '--:--'
    return new Date(epoch * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="pulse-container">
      {/* News Row */}
      <div className="pulse-row">
        <div className="pulse-icon"><span className="material-symbols-rounded">public</span></div>
        <div className="pulse-content">
          <div className="pulse-label">NEWS • {fmtTs(ts.news)}</div>
          <div className="pulse-text pulse-news-headline">{news.headline || 'No headlines today.'}</div>
          <div className="pulse-sub">{news.source}</div>
        </div>
      </div>

      {/* Markets Row */}
      <div className="pulse-row">
        <div className="pulse-icon"><span className="material-symbols-rounded">show_chart</span></div>
        <div className="pulse-content">
          <div className="pulse-label">MARKETS • {fmtTs(ts.markets)}</div>
          <div className="pulse-market-data">
            <span className="pulse-symbol">{markets.symbol}</span>
            <span className="pulse-price">{markets.price ? `$${markets.price.toLocaleString()}` : '--.--'}</span>
            {markets.change !== undefined && (
              <span className={`pulse-change ${markets.change >= 0 ? 'up' : 'down'}`}>
                {markets.change >= 0 ? '▲' : '▼'} {Math.abs(markets.change_percent).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Flights Row */}
      <div className="pulse-row">
        <div className="pulse-icon"><span className="material-symbols-rounded">flight</span></div>
        <div className="pulse-content">
          <div className="pulse-label">OVERHEAD • {fmtTs(ts.flights)}</div>
          <div className="pulse-text">
            {flights.flights?.length > 0 
              ? `${flights.flights.length} active aircraft in sector.`
              : 'Clear skies overhead.'
            }
          </div>
        </div>
      </div>
    </div>
  )
}
