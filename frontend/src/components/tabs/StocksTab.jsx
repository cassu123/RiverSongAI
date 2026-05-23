// Audit: Stocks backend uses Finnhub (preferred) or Alpha Vantage as fallback.
// GET /api/feeds/stocks          → array of { ticker, price, change, change_pct, name, up }
// GET /api/feeds/stocks/search?q → array of { ticker, name, type, region, currency }
// Watchlist persisted in /api/feeds/preferences as prefs.stock_tickers (array of strings).
// Rate limiting: 30s cache at provider. Auto-refresh: 30s client interval, cleared on unmount.
// Hard cap: 15 symbols. Add #16 → show inline error.

import React, { useState, useEffect, useCallback, useRef } from 'react'

const MAX_SYMBOLS = 15

function SparkBar({ change }) {
  const up = (change ?? 0) >= 0
  const w = Math.min(Math.abs(change ?? 0) * 4, 48)
  return (
    <svg width={56} height={20} style={{ flexShrink: 0 }}>
      <rect
        x={up ? 28 : 28 - w}
        y={6}
        width={w || 2}
        height={8}
        rx={2}
        fill={up ? 'oklch(71% 0.17 145)' : 'oklch(64% 0.17 22)'}
        opacity={0.7}
      />
      <line x1={28} y1={3} x2={28} y2={17} stroke="var(--md-outline-variant)" strokeWidth={1} />
    </svg>
  )
}

function QuoteRow({ quote, onRemove }) {
  const up = (quote.change ?? 0) >= 0
  const changeColor = up ? 'oklch(71% 0.17 145)' : 'oklch(64% 0.17 22)'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 0',
      borderBottom: '1px solid var(--md-outline-variant)',
    }}>
      {/* Symbol */}
      <div style={{ minWidth: 52 }}>
        <div style={{ fontWeight: 900, fontSize: '0.9rem', letterSpacing: '0.08em', color: 'var(--primary)' }}>
          {quote.ticker}
        </div>
        {quote.name && (
          <div className="rs-card-meta" style={{ fontSize: '0.62rem', marginTop: 1 }}>
            {quote.name.length > 18 ? quote.name.slice(0, 18) + '…' : quote.name}
          </div>
        )}
      </div>

      {/* Spark */}
      <SparkBar change={quote.change} />

      {/* Price */}
      <div style={{ flex: 1, textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1rem' }}>
          {quote.price != null ? `$${Number(quote.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
        </div>
      </div>

      {/* Change */}
      <div style={{ minWidth: 80, textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700, color: changeColor }}>
          {up ? '+' : ''}{quote.change != null ? quote.change.toFixed(2) : '--'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: changeColor, opacity: 0.8 }}>
          {up ? '+' : ''}{quote.change_pct != null ? quote.change_pct.toFixed(2) : '--'}%
        </div>
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(quote.ticker)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          color: 'var(--md-on-surface-variant)',
          opacity: 0.4,
          flexShrink: 0,
        }}
        title={`Remove ${quote.ticker}`}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>close</span>
      </button>
    </div>
  )
}

export default function StocksTab({ token, active }) {
  const [quotes, setQuotes]         = useState([])
  const [tickers, setTickers]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [searchQ, setSearchQ]       = useState('')
  const [searchResults, setResults] = useState([])
  const [searching, setSearching]   = useState(false)
  const [addError, setAddError]     = useState('')
  const intervalRef                 = useRef(null)
  const debounceRef                 = useRef(null)

  const fetchQuotes = useCallback(async () => {
    if (!active) return
    setError(null)
    try {
      const res = await fetch('/api/feeds/stocks', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'Stocks unavailable')
      }
      setQuotes(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  const loadTickers = useCallback(async () => {
    try {
      const res = await fetch('/api/feeds/preferences', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const p = await res.json()
        setTickers(p.stock_tickers || [])
      }
    } catch {}
  }, [token])

  useEffect(() => {
    if (!active) {
      clearInterval(intervalRef.current)
      return
    }
    fetchQuotes()
    loadTickers()
    intervalRef.current = setInterval(fetchQuotes, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [active, fetchQuotes, loadTickers])

  const saveTickers = async (next) => {
    setTickers(next)
    await fetch('/api/feeds/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ stock_tickers: next }),
    })
    await fetchQuotes()
  }

  const removeTicker = (sym) => saveTickers(tickers.filter(t => t !== sym))

  const addTicker = async (sym) => {
    const upper = sym.toUpperCase()
    if (tickers.includes(upper)) { setAddError('Already in watchlist'); return }
    if (tickers.length >= MAX_SYMBOLS) { setAddError(`Maximum ${MAX_SYMBOLS} symbols`); return }
    setAddError('')
    setSearchQ('')
    setResults([])
    await saveTickers([...tickers, upper])
  }

  // Debounced symbol search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!searchQ.trim() || searchQ.length < 1) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feeds/stocks/search?q=${encodeURIComponent(searchQ)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) setResults(await res.json())
      } catch {}
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchQ, token])

  const colHeader = (label, align = 'left') => (
    <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.45, textAlign: align }}>
      {label}
    </div>
  )

  return (
    <div>
      {/* Add ticker row */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <input
            type="text"
            className="rs-input"
            placeholder="Search symbol or company…"
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setAddError('') }}
            style={{ flex: 1, fontSize: '0.85rem' }}
          />
          {searchQ && (
            <button
              className="rs-icon-btn"
              onClick={() => { setSearchQ(''); setResults([]) }}
              style={{ flexShrink: 0 }}
            >
              <span className="material-symbols-rounded">close</span>
            </button>
          )}

          {/* Search dropdown */}
          {(searchResults.length > 0 || searching) && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'var(--md-surface-container-high)',
              border: '1px solid var(--md-outline-variant)',
              borderRadius: 8,
              marginTop: 4,
              zIndex: 50,
              overflow: 'hidden',
            }}>
              {searching && (
                <div className="rs-card-meta" style={{ padding: '10px 16px', fontSize: '0.75rem' }}>
                  Searching…
                </div>
              )}
              {searchResults.slice(0, 5).map(r => (
                <button
                  key={r.ticker}
                  onClick={() => addTicker(r.ticker)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    gap: 12,
                    padding: '10px 16px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    alignItems: 'center',
                    borderTop: '1px solid var(--md-outline-variant)',
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--primary)', minWidth: 52 }}>
                    {r.ticker}
                  </span>
                  <span className="rs-card-meta" style={{ flex: 1, fontSize: '0.75rem' }}>{r.name}</span>
                  <span className="rs-card-meta" style={{ fontSize: '0.62rem', opacity: 0.5 }}>{r.region}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {addError && (
          <div style={{ color: 'oklch(64% 0.17 22)', fontSize: '0.72rem', marginTop: 6, fontWeight: 600 }}>
            {addError}
          </div>
        )}
        <div className="rs-card-meta" style={{ fontSize: '0.62rem', marginTop: 6, opacity: 0.5 }}>
          {tickers.length}/{MAX_SYMBOLS} symbols
        </div>
      </div>

      {/* Column headers */}
      {quotes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 8, borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ minWidth: 52 }}>{colHeader('SYMBOL')}</div>
          <div style={{ minWidth: 56 }}>{colHeader('TREND')}</div>
          <div style={{ flex: 1, textAlign: 'right' }}>{colHeader('PRICE', 'right')}</div>
          <div style={{ minWidth: 80 }}>{colHeader('CHANGE', 'right')}</div>
          <div style={{ width: 28 }} />
        </div>
      )}

      {loading ? (
        <StocksSkeleton />
      ) : error ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>trending_flat</span>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
          <button className="rs-pill" onClick={fetchQuotes}>RETRY</button>
        </div>
      ) : quotes.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>candlestick_chart</span>
          <div className="rs-card-label" style={{ marginBottom: 6 }}>EMPTY WATCHLIST</div>
          <div className="rs-card-meta">Search for a ticker symbol above to start tracking.</div>
        </div>
      ) : (
        <div>
          {quotes.map(q => (
            <QuoteRow key={q.ticker} quote={q} onRemove={removeTicker} />
          ))}
        </div>
      )}
    </div>
  )
}

function StocksSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--md-outline-variant)', alignItems: 'center' }}>
          <div style={{ minWidth: 52, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ height: 10, width: 40, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
            <div style={{ height: 8, width: 32, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
          </div>
          <div style={{ height: 8, width: 56, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ height: 14, width: 64, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.35 }} />
          </div>
          <div style={{ minWidth: 80, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <div style={{ height: 10, width: 48, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
            <div style={{ height: 8, width: 36, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.2 }} />
          </div>
          <div style={{ width: 28 }} />
        </div>
      ))}
    </div>
  )
}
