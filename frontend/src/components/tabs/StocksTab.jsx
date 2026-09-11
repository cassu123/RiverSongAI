// Backend:
//   GET /api/feeds/stocks          → [{ticker, price, change, change_pct, up}]
//   GET /api/feeds/stocks/search?q → [{ticker, name, type, region}]
//   GET /api/feeds/stocks/chart?ticker=X → [{date, open, high, low, close, volume}]
//   GET /api/feeds/stocks/news/{ticker}  → [{headline, summary, url, source, published_at}]
// Settings: PATCH /api/settings/page { markets: { watchlist, show_charts, show_news } }

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { InlineSettingsSection, SettingsRow, Toggle } from '../TabSettingsPanel.jsx'

const MAX_SYMBOLS = 15

// ── Simple SVG line chart (no external deps) ──────────────────────────
function LineChart({ data }) {
  if (!data?.length) return null
  const W = 400, H = 72
  const closes = data.map(d => d.close)
  const min = Math.min(...closes), max = Math.max(...closes)
  const range = max - min || 0.01
  const pts = closes.map((c, i) => {
    const x = (i / Math.max(closes.length - 1, 1)) * W
    const y = H - ((c - min) / range) * (H - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  const color = up ? 'oklch(71% 0.17 145)' : 'oklch(64% 0.17 22)'
  const last = closes[closes.length - 1]
  return (
    <div className="rs-mb-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="rs-w-full" style={{ height: H }} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <div className="rs-flex rs-justify-between">
        <span className="rs-card-meta" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>
          {data[0]?.date} → {data[data.length - 1]?.date}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-micro)', fontWeight: 700, color }}>
          ${last?.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

// ── News list ──────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

function NewsList({ items }) {
  if (!items.length) return (
    <div className="rs-card-meta" style={{ color: 'var(--text-muted)', padding: '12px 0', fontSize: 'var(--rs-fs-micro)' }}>No recent news.</div>
  )
  return (
    <div className="rs-flex rs-flex-col" style={{ gap: 0 }}>
      {items.map((n, i) => (
        <a
          key={i}
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block', padding: '10px 0',
            borderBottom: i < items.length - 1 ? '1px solid var(--md-outline-variant)' : 'none',
            textDecoration: 'none', color: 'inherit',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 'var(--rs-fs-tiny)', lineHeight: 1.35, marginBottom: 3 }}>{n.headline}</div>
          <div className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-nano)' }}>
            {n.source} · {relTime(n.published_at)}
          </div>
        </a>
      ))}
    </div>
  )
}

// ── SparkBar (unchanged) ───────────────────────────────────────────────
function SparkBar({ change }) {
  const up = (change ?? 0) >= 0
  const w = Math.min(Math.abs(change ?? 0) * 4, 48)
  return (
    <svg width={56} height={20} style={{ flexShrink: 0 }}>
      <rect x={up ? 28 : 28 - w} y={6} width={w || 2} height={8} rx={2}
        fill={up ? 'oklch(71% 0.17 145)' : 'oklch(64% 0.17 22)'} opacity={0.7} />
      <line x1={28} y1={3} x2={28} y2={17} stroke="var(--md-outline-variant)" strokeWidth={1} />
    </svg>
  )
}

// ── Quote row ──────────────────────────────────────────────────────────
function QuoteRow({ quote, selected, onSelect, onRemove }) {
  const up = (quote.change ?? 0) >= 0
  const changeColor = up ? 'oklch(71% 0.17 145)' : 'oklch(64% 0.17 22)'
  return (
    <div
      onClick={() => onSelect(quote.ticker)}
      className="rs-flex rs-items-center rs-gap-3" style={{
        padding: '12px 0',
        borderBottom: '1px solid var(--md-outline-variant)',
        cursor: 'pointer',
        background: selected ? 'rgba(var(--primary-rgb,100,100,255),0.06)' : 'transparent',
        borderRadius: selected ? 4 : 0,
      }}
    >
      <div style={{ minWidth: 52 }}>
        <div style={{ fontWeight: 900, fontSize: 'var(--rs-fs-small)', letterSpacing: '0.08em', color: 'var(--primary)' }}>
          {quote.ticker}
        </div>
        {quote.name && (
          <div className="rs-card-meta" style={{ fontSize: 'var(--rs-fs-nano)', marginTop: 1 }}>
            {quote.name.length > 18 ? quote.name.slice(0, 18) + '…' : quote.name}
          </div>
        )}
      </div>
      <SparkBar change={quote.change} />
      <div className="rs-grow" style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 'var(--rs-fs-body)' }}>
          {quote.price != null ? `$${Number(quote.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
        </div>
      </div>
      <div style={{ minWidth: 80, textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-tiny)', fontWeight: 700, color: changeColor }}>
          {up ? '+' : ''}{quote.change != null ? quote.change.toFixed(2) : '--'}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--rs-fs-nano)', color: changeColor, opacity: 0.8 }}>
          {up ? '+' : ''}{quote.change_pct != null ? quote.change_pct.toFixed(2) : '--'}%
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onRemove(quote.ticker) }}
        className="rs-p-1" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-on-surface-variant)', opacity: 0.4, flexShrink: 0 }}
        title={`Remove ${quote.ticker}`}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>close</span>
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────
export default function StocksTab({ token, active }) {
  const [quotes, setQuotes]         = useState([])
  const [settings, setSettings]     = useState(null)  // settings_json.markets
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [searchQ, setSearchQ]       = useState('')
  const [searchResults, setResults] = useState([])
  const [searching, setSearching]   = useState(false)
  const [addError, setAddError]     = useState('')
  const [selectedTicker, setTicker] = useState(null)
  const [chart, setChart]           = useState(null)
  const [chartLoading, setChartL]   = useState(false)
  const [news, setNews]             = useState([])
  const [newsLoading, setNewsL]     = useState(false)
  const intervalRef                 = useRef(null)
  const debounceRef                 = useRef(null)
  const authHeaders = { Authorization: `Bearer ${token}` }

  const patchMarkets = useCallback(async (patch) => {
    const next = { ...(settings || {}), ...patch }
    setSettings(next)
    await fetch('/api/settings/page', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markets: next }),
    }).catch(() => {})
    return next
  }, [settings, token])

  const fetchQuotes = useCallback(async () => {
    if (!active) return
    setError(null)
    try {
      const res = await fetch('/api/feeds/stocks', { headers: authHeaders })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || 'Stocks unavailable')
      }
      const data = await res.json()
      setQuotes(data)
      if (!selectedTicker && data.length) setTicker(data[0].ticker)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active, selectedTicker])

  // Load settings on mount
  useEffect(() => {
    if (!active) return
    fetch('/api/settings/page', { headers: authHeaders })
      .then(r => r.ok ? r.json() : {})
      .then(page => {
        setSettings(page?.markets || {})
      })
      .catch(() => setSettings({}))
  }, [token, active])

  useEffect(() => {
    if (!active || settings === null) return
    clearInterval(intervalRef.current)
    fetchQuotes()
    intervalRef.current = setInterval(fetchQuotes, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [active, settings, fetchQuotes])

  // Fetch chart when selected ticker changes and show_charts is on
  useEffect(() => {
    if (!selectedTicker || !settings?.show_charts) { setChart(null); return }
    setChartL(true)
    fetch(`/api/feeds/stocks/chart?ticker=${encodeURIComponent(selectedTicker)}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(d => setChart(d))
      .catch(() => setChart(null))
      .finally(() => setChartL(false))
  }, [selectedTicker, settings?.show_charts, token])

  // Fetch news when selected ticker changes and show_news is on
  useEffect(() => {
    if (!selectedTicker || !settings?.show_news) { setNews([]); return }
    setNewsL(true)
    fetch(`/api/feeds/stocks/news/${encodeURIComponent(selectedTicker)}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : [])
      .then(d => setNews(Array.isArray(d) ? d : []))
      .catch(() => setNews([]))
      .finally(() => setNewsL(false))
  }, [selectedTicker, settings?.show_news, token])

  const saveWatchlist = async (next) => {
    await patchMarkets({ watchlist: next })
    await fetchQuotes()
  }

  const removeTicker = (sym) => {
    const watchlist = settings?.watchlist || quotes.map(q => q.ticker)
    saveWatchlist(watchlist.filter(t => t !== sym))
  }

  const addTicker = async (sym) => {
    const upper = sym.toUpperCase()
    const watchlist = settings?.watchlist || quotes.map(q => q.ticker)
    if (watchlist.includes(upper)) { setAddError('Already in watchlist'); return }
    if (watchlist.length >= MAX_SYMBOLS) { setAddError(`Maximum ${MAX_SYMBOLS} symbols`); return }
    setAddError('')
    setSearchQ('')
    setResults([])
    await saveWatchlist([...watchlist, upper])
  }

  // Debounced symbol search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!searchQ.trim()) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feeds/stocks/search?q=${encodeURIComponent(searchQ)}`, { headers: authHeaders })
        if (res.ok) setResults(await res.json())
      } catch {}
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchQ, token])

  const watchlist = settings?.watchlist || []
  const colHeader = (label, align = 'left') => (
    <div className="rs-card-label" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)', textAlign: align }}>{label}</div>
  )

  return (
    <div>
      <InlineSettingsSection
        title="MARKETS SETTINGS"
        icon="tune"
        subtitle={`${watchlist.length}/${MAX_SYMBOLS} symbols`}
      >
        <SettingsRow label="CHART">
          <Toggle
            checked={!!settings?.show_charts}
            onChange={v => patchMarkets({ show_charts: v })}
            label="Show 30-day price chart"
          />
        </SettingsRow>
        <SettingsRow label="NEWS">
          <Toggle
            checked={!!settings?.show_news}
            onChange={v => patchMarkets({ show_news: v })}
            label="Show company news"
          />
        </SettingsRow>
      </InlineSettingsSection>

      {/* Search row */}
      <div className="rs-mb-5">
        <div style={{ position: 'relative' }}>
          <input
            type="text" className="rs-input rs-w-full"
            placeholder="Search symbol or company…"
            value={searchQ}
            onChange={e => { setSearchQ(e.target.value); setAddError('') }}
            style={{ fontSize: 'var(--rs-fs-tiny)', boxSizing: 'border-box' }}
          />
          {searchQ && (
            <button className="rs-icon-btn" onClick={() => { setSearchQ(''); setResults([]) }}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
              <span className="material-symbols-rounded">close</span>
            </button>
          )}
          {(searchResults.length > 0 || searching) && (
            <div className="rs-mt-1" style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'var(--md-surface-container-high)',
              border: '1px solid var(--md-outline-variant)',
              borderRadius: 8,
              zIndex: 50,
              overflow: 'hidden',
            }}>
              {searching && <div className="rs-card-meta" style={{ padding: '10px 16px', fontSize: 'var(--rs-fs-micro)' }}>Searching…</div>}
              {searchResults.slice(0, 5).map(r => (
                <button key={r.ticker} onClick={() => addTicker(r.ticker)} className="rs-flex rs-w-full rs-gap-3 rs-items-center" style={{
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderTop: '1px solid var(--md-outline-variant)',
                }}>
                  <span style={{ fontWeight: 800, fontSize: 'var(--rs-fs-tiny)', color: 'var(--primary)', minWidth: 52 }}>{r.ticker}</span>
                  <span className="rs-card-meta rs-grow" style={{ fontSize: 'var(--rs-fs-micro)' }}>{r.name}</span>
                  <span className="rs-card-meta" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>{r.region}</span>
                </button>
              ))}
            </div>
          )}
          {addError && <div className="rs-mt-2" style={{ color: 'oklch(64% 0.17 22)', fontSize: 'var(--rs-fs-micro)', fontWeight: 600 }}>{addError}</div>}
        </div>
      </div>

      {/* Column headers */}
      {quotes.length > 0 && (
        <div className="rs-flex rs-items-center rs-gap-3" style={{ paddingBottom: 8, borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ minWidth: 52 }}>{colHeader('SYMBOL')}</div>
          <div style={{ minWidth: 56 }}>{colHeader('TREND')}</div>
          <div className="rs-grow" style={{ textAlign: 'right' }}>{colHeader('PRICE', 'right')}</div>
          <div style={{ minWidth: 80 }}>{colHeader('CHANGE', 'right')}</div>
          <div style={{ width: 28 }} />
        </div>
      )}

      {loading ? <StocksSkeleton /> : error ? (
        <div className="rs-text-center" style={{ padding: '24px 0' }}>
          <span className="material-symbols-rounded rs-mb-2" style={{ fontSize: '2rem', opacity: 0.2, display: 'block' }}>trending_flat</span>
          <div className="rs-card-meta rs-mb-3">{error}</div>
          <button className="rs-pill" onClick={fetchQuotes}>RETRY</button>
        </div>
      ) : quotes.length === 0 ? (
        <div className="rs-text-center" style={{ padding: '24px 0' }}>
          <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block' }}>candlestick_chart</span>
          <div className="rs-card-label rs-mb-2">EMPTY WATCHLIST</div>
          <div className="rs-card-meta">Search for a ticker symbol above to start tracking.</div>
        </div>
      ) : (
        <div>
          {quotes.map(q => (
            <QuoteRow
              key={q.ticker} quote={q}
              selected={q.ticker === selectedTicker}
              onSelect={setTicker}
              onRemove={removeTicker}
            />
          ))}
        </div>
      )}

      {/* Chart pane */}
      {settings?.show_charts && selectedTicker && (
        <div className="rs-mt-5">
          <div className="rs-card-label rs-mb-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>
            {selectedTicker} · 30-DAY CHART
          </div>
          {chartLoading ? (
            <div style={{ height: 72, background: 'var(--md-outline-variant)', borderRadius: 8, opacity: 0.2 }} />
          ) : chart?.length ? (
            <LineChart data={chart} />
          ) : (
            <div className="rs-card-meta" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-micro)' }}>Chart data unavailable (API limit may be reached).</div>
          )}
        </div>
      )}

      {/* News pane */}
      {settings?.show_news && selectedTicker && (
        <div className="rs-mt-5">
          <div className="rs-card-label rs-mb-3" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)' }}>
            {selectedTicker} · RECENT NEWS
          </div>
          {newsLoading ? (
            <div className="rs-card-meta" style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-micro)' }}>Loading…</div>
          ) : (
            <NewsList items={news} />
          )}
        </div>
      )}
    </div>
  )
}

function StocksSkeleton() {
  return (
    <div className="rs-flex rs-flex-col">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rs-flex rs-gap-3 rs-items-center" style={{ padding: '12px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-flex rs-flex-col rs-gap-1" style={{ minWidth: 52 }}>
            <div style={{ height: 10, width: 40, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
            <div style={{ height: 8, width: 32, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.25 }} />
          </div>
          <div style={{ height: 8, width: 56, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          <div className="rs-grow rs-flex" style={{ justifyContent: 'flex-end' }}>
            <div style={{ height: 14, width: 64, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.35 }} />
          </div>
          <div className="rs-flex rs-flex-col rs-gap-1" style={{ minWidth: 80, alignItems: 'flex-end' }}>
            <div style={{ height: 10, width: 48, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
            <div style={{ height: 8, width: 36, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.2 }} />
          </div>
          <div style={{ width: 28 }} />
        </div>
      ))}
    </div>
  )
}
