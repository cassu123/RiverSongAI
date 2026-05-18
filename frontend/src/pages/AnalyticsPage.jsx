import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

// ─── Platform catalogue ──────────────────────────────────────────────────────

const PLATFORMS = [
  { key: 'tiktok',    label: 'TikTok',    color: '#ff2d55', metrics: ['followers','views','likes','revenue'] },
  { key: 'instagram', label: 'Instagram', color: '#e1306c', metrics: ['followers','impressions','reach','likes'] },
  { key: 'facebook',  label: 'Facebook',  color: '#1877f2', metrics: ['page_likes','reach','engagements','revenue'] },
  { key: 'amazon',    label: 'Amazon',    color: '#ff9900', metrics: ['orders','revenue','units_sold','returns'] },
  { key: 'etsy',      label: 'Etsy',      color: '#f56400', metrics: ['orders','revenue','views','favorites'] },
  { key: 'shopify',   label: 'Shopify',   color: '#96bf48', metrics: ['orders','revenue','sessions','conversion_rate'] },
]

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.key, p]))

const RANGE_OPTIONS = [
  { label: '7D',  days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
]

function authHeaders() {
  const token = localStorage.getItem('rs-auth-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path, opts = {}) {
  const res = await fetch('/api/analytics' + path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

function fmtNum(v, decimals = 0) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + 'K'
  return Number(v).toFixed(decimals)
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isMoneyMetric(key) {
  return key === 'revenue'
}

function fmtMetric(key, val) {
  if (isMoneyMetric(key)) return fmtMoney(val)
  return fmtNum(val)
}

function metricLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── SVG Line Chart ──────────────────────────────────────────────────────────

function LineChart({ data, color, height = 80 }) {
  if (!data || data.length < 2) return (
    <div style={{ fontSize: '0.7rem', opacity: 0.5, fontStyle: 'italic', height, display: 'flex', alignItems: 'center' }}>
      Not enough data
    </div>
  )
  const values = data.map(d => d.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range  = maxVal - minVal || 1
  const w = 300
  const h = height
  const pad = 4
  const stepX = (w - pad * 2) / (data.length - 1)

  const pts = data.map((d, i) => {
    const x = pad + i * stepX
    const y = h - pad - ((d.value - minVal) / range) * (h - pad * 2)
    return [x, y]
  })

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fill = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
    + ` L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`

  const first = data[0].date.slice(5)
  const last  = data[data.length - 1].date.slice(5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={fill} fill={`url(#grad-${color.replace('#','')})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={color} opacity="0.7" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', opacity: 0.4, letterSpacing: '0.05em' }}>
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  )
}

// ─── Platform tile (summary card) ────────────────────────────────────────────

function PlatformTile({ platform, snapshots, connected, onSelect, selected }) {
  const p = PLATFORM_MAP[platform] || { label: platform, color: '#888', metrics: [] }
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const prev   = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const primary = p.metrics[0]
  const primaryVal = latest?.metrics?.[primary]
  const prevVal    = prev?.metrics?.[primary]
  let delta = null
  if (primaryVal != null && prevVal != null && prevVal !== 0) {
    delta = ((primaryVal - prevVal) / Math.abs(prevVal)) * 100
  }

  const revenue = latest?.metrics?.revenue
  const chartData = (snapshots || []).map(s => ({ date: s.date, value: s.metrics?.[primary] ?? 0 }))

  return (
    <div
      className={`rs-card is-tappable ${selected ? 'is-elev' : ''}`}
      style={{ 
        flex: '1 1 240px',
        opacity: connected ? 1 : 0.6,
        borderLeft: selected ? `4px solid ${p.color}` : undefined,
        padding: '16px'
      }}
      onClick={() => onSelect(platform)}
    >
      <div className="rs-card-head" style={{ marginBottom: 12 }}>
        <span className="rs-card-label" style={{ color: p.color }}>{p.label}</span>
        <div className="rs-status-dot" style={{ 
          background: connected ? '#4ade80' : '#6b7280',
          boxShadow: connected ? '0 0 8px #4ade80' : 'none',
          animation: connected ? undefined : 'none',
          width: 6, height: 6
        }} />
      </div>

      {connected && latest ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="rs-card-value" style={{ fontSize: '1.4rem' }}>{fmtMetric(primary, primaryVal)}</span>
            <span className="rs-card-meta" style={{ fontSize: '0.65rem', margin: 0 }}>{metricLabel(primary)}</span>
            {delta != null && (
              <span style={{ 
                fontSize: '0.7rem', 
                marginLeft: 'auto',
                color: delta >= 0 ? '#4ade80' : '#f87171' 
              }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          {revenue != null && primary !== 'revenue' && (
            <div className="rs-card-meta" style={{ marginTop: -8 }}>{fmtMoney(revenue)} revenue</div>
          )}
          <LineChart data={chartData} color={p.color} height={50} />
        </div>
      ) : (
        <div className="rs-card-meta" style={{ fontStyle: 'italic', minHeight: 80, display: 'flex', alignItems: 'center' }}>
          No data yet.
        </div>
      )}
    </div>
  )
}

// ─── Detail panel ────────────────────────────────────────────────────────────

function PlatformDetail({ 
  platform, snapshots, onAddData, onDeleteSnapshot, 
  insights, loading, error, onFetchInsights 
}) {
  const p = PLATFORM_MAP[platform] || { label: platform, color: '#888', metrics: [] }
  const SUPPORTED_FOR_INSIGHTS = ['tiktok', 'instagram', 'amazon', 'etsy', 'facebook']

  if (!snapshots.length) return (
    <div className="rs-card is-wide animate-fade-in" style={{ marginTop: 24 }}>
      <div className="rs-card-head">
        <h2 className="rs-card-label" style={{ color: p.color, fontSize: '1rem' }}>{p.label}</h2>
        <button className="rs-btn-primary" onClick={onAddData}>
          <span className="material-symbols-rounded">add</span>
          DATA
        </button>
      </div>
      <div className="rs-card-meta">No snapshots yet. Add your first data point.</div>
    </div>
  )

  const metrics = p.metrics.length ? p.metrics : Object.keys(snapshots[0]?.metrics || {})

  return (
    <div className="rs-card is-wide animate-fade-in" style={{ marginTop: 24 }}>
      <div className="rs-card-head">
        <h2 className="rs-card-label" style={{ color: p.color, fontSize: '1rem' }}>{p.label}</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {SUPPORTED_FOR_INSIGHTS.includes(platform) && (
            <button 
              className="rs-pill" 
              onClick={onFetchInsights}
              disabled={loading}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>
                {loading ? 'sync' : insights ? 'refresh' : 'auto_awesome'}
              </span>
              {loading ? 'ANALYZING...' : insights ? 'REFRESH' : 'AI INSIGHTS'}
            </button>
          )}
          <button className="rs-btn-primary" onClick={onAddData}>
            <span className="material-symbols-rounded">add</span>
            DATA
          </button>
        </div>
      </div>

      {loading && <div className="rs-card-meta" style={{ fontStyle: 'italic' }}>River is analysing your data...</div>}
      {error && <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: 16 }}>{error}</div>}
      
      {insights && !loading && (
        <div style={{ 
          background: 'rgba(255,255,255,0.05)', 
          padding: 16, 
          borderRadius: 'var(--md-shape-lg)',
          marginBottom: 24,
          border: '1px solid var(--md-outline-variant)'
        }}>
          <div className="rs-card-label" style={{ marginBottom: 10, color: 'var(--primary)' }}>AI INSIGHTS</div>
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{insights}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24, marginBottom: 32 }}>
        {(metrics || []).map(metric => {
          const chartData = (snapshots || [])
            .filter(s => s.metrics?.[metric] != null)
            .map(s => ({ date: s.date, value: s.metrics[metric] }))
          if (!chartData.length) return null
          const latest = chartData[chartData.length - 1]?.value
          return (
            <div key={metric} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="rs-card-label" style={{ fontSize: '0.65rem' }}>{metricLabel(metric)}</span>
                <span className="rs-card-value" style={{ fontSize: '1.1rem' }}>{fmtMetric(metric, latest)}</span>
              </div>
              <LineChart data={chartData} color={p.color} height={80} />
            </div>
          )
        })}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--md-outline-variant)', background: 'rgba(255,255,255,0.02)' }}>
              <th style={{ padding: '12px', textAlign: 'left' }} className="rs-card-label">Date</th>
              {(metrics || []).map(m => <th key={m} style={{ padding: '12px', textAlign: 'left' }} className="rs-card-label">{metricLabel(m)}</th>)}
              <th style={{ padding: '12px' }}></th>
            </tr>
          </thead>
          <tbody>
            {[...(snapshots || [])].reverse().map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--md-outline-variant)' }}>
                <td style={{ padding: '10px 12px' }}>{s.date}</td>
                {(metrics || []).map(m => (
                  <td key={m} style={{ padding: '10px 12px' }}>{fmtMetric(m, s.metrics?.[m])}</td>
                ))}
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--md-on-surface-variant)', cursor: 'pointer', padding: 4 }}
                    onClick={() => onDeleteSnapshot(s.id)}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Add Data Modal ──────────────────────────────────────────────────────────

function AddDataModal({ platform, onClose, onSave }) {
  const p = PLATFORM_MAP[platform] || { label: platform, color: '#888', metrics: [] }
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [vals, setVals] = useState(Object.fromEntries((p.metrics || []).map(m => [m, ''])))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    setSaving(true)
    setErr('')
    const metrics = {}
    for (const [k, v] of Object.entries(vals || {})) {
      const n = parseFloat(v)
      if (v !== '' && !isNaN(n)) metrics[k] = n
    }
    try {
      await onSave({ platform, date, metrics })
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(10px)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rs-card animate-scale-in" style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <div className="rs-card-head">
          <span className="rs-card-label" style={{ color: p.color }}>ADD {p.label} DATA</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--fg)', cursor: 'pointer' }} onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="rs-card-label" style={{ fontSize: '0.6rem' }}>Date</label>
            <input
              type="date"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: '10px', color: 'var(--fg)' }}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          {(p.metrics || []).map(m => (
            <div key={m} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="rs-card-label" style={{ fontSize: '0.6rem' }}>{metricLabel(m)}</label>
              <input
                type="number"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--md-outline-variant)', borderRadius: 8, padding: '10px', color: 'var(--fg)' }}
                placeholder="—"
                value={vals[m]}
                onChange={e => setVals(v => ({ ...v, [m]: e.target.value }))}
              />
            </div>
          ))}
          {err && <div style={{ color: '#f87171', fontSize: '0.8rem' }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
          <button className="rs-pill" onClick={onClose}>CANCEL</button>
          <button className="rs-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING…' : 'SAVE DATA'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

function loadVisible(userId) {
  try {
    const raw = localStorage.getItem(`rs-analytics-platforms:${userId}`)
    if (raw) return new Set(JSON.parse(raw))
  } catch {}
  return new Set(PLATFORMS.map(p => p.key))
}

function saveVisible(userId, set) {
  try { localStorage.setItem(`rs-analytics-platforms:${userId}`, JSON.stringify([...set])) } catch {}
}

export default function AnalyticsPage() {
  const { user } = useAuth()
  const userId = user?.id || 'default'

  const [days,             setDays]             = useState(30)
  const [snapshots,        setSnapshots]        = useState([])
  const [platforms,        setPlatforms]        = useState([])
  const [loading,          setLoading]          = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState(null)
  const [addModalFor,      setAddModalFor]      = useState(null)
  const [err,              setErr]              = useState('')
  const [showSettings,     setShowSettings]     = useState(false)
  const [visiblePlatforms, setVisiblePlatforms] = useState(() => loadVisible(userId))
  const [businessReport, setBusinessReport] = useState(null)
  const [generatingReport, setGeneratingReport] = useState(false)

  const [platformInsights, setPlatformInsights] = useState({})
  const [insightsLoading, setInsightsLoading] = useState({})
  const [insightsError, setInsightsError] = useState({})

  function handleVisibleChange(next) {
    setVisiblePlatforms(next)
    saveVisible(userId, next)
    if (selectedPlatform && !next.has(selectedPlatform)) setSelectedPlatform(null)
  }

  const fetchInsights = useCallback(async (platform) => {
    setInsightsLoading(prev => ({ ...prev, [platform]: true }))
    setInsightsError(prev => ({ ...prev, [platform]: '' }))
    try {
      const res = await fetch(`/api/analytics/${platform}/summary`, {
        headers: authHeaders(),
      })
      if (res.status === 503) {
        throw new Error("AI summary unavailable — Ollama is not running.")
      }
      if (!res.ok) throw new Error("Could not generate summary. Try again.")
      const data = await res.json()
      setPlatformInsights(prev => ({ ...prev, [platform]: data.insights }))
    } catch (e) {
      setInsightsError(prev => ({ ...prev, [platform]: e.message }))
    } finally {
      setInsightsLoading(prev => ({ ...prev, [platform]: false }))
    }
  }, [])
  
  const handleGenerateReport = async () => {
    setGeneratingReport(true)
    try {
      const res = await fetch("/api/analytics/business-report?days=" + days, {
        headers: authHeaders(),
      })
      const data = await res.json()
      setBusinessReport(data.report)
    } catch (e) {
      setErr("Failed to generate report: " + e.message)
    } finally {
      setGeneratingReport(false)
    }
  }
    
  const loadData = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [snaps, plats] = await Promise.all([
        apiFetch(`/snapshots?days=${days}`),
        apiFetch('/platforms'),
      ])
      setSnapshots(snaps)
      setPlatforms(plats)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { loadData() }, [loadData])

  function snapshotsFor(platform) {
    return (snapshots || []).filter(s => s.platform === platform)
  }

  function connectedPlatforms() {
    const withData = new Set((snapshots || []).map(s => s.platform))
    const withConfig = new Set((platforms || []).map(p => p.platform))
    return new Set([...withData, ...withConfig])
  }

  async function handleSaveSnapshot(body) {
    await apiFetch('/snapshots', { method: 'POST', body: JSON.stringify(body) })
    await loadData()
  }

  async function handleDeleteSnapshot(snapId) {
    if (!confirm('Delete this snapshot?')) return
    await apiFetch(`/snapshots/${snapId}`, { method: 'DELETE' })
    await loadData()
  }

  const connected = connectedPlatforms()
  const sortedPlatforms = [...PLATFORMS]
    .filter(p => visiblePlatforms.has(p.key))
    .sort((a, b) => {
      const aHas = snapshotsFor(a.key).length > 0
      const bHas = snapshotsFor(b.key).length > 0
      if (aHas && !bHas) return -1
      if (!aHas && bHas) return 1
      return 0
    })

  const latestSnapshots = (snapshots || []).filter(s => {
    const forPlatform = (snapshots || []).filter(x => x.platform === s.platform)
    return s === forPlatform[forPlatform.length - 1]
  })

  // Summary logic
  let totalRevenue = 0
  let totalOrders  = 0
  let totalFollowers = 0
  const platformsWithData = new Set()
  for (const s of latestSnapshots) {
    platformsWithData.add(s.platform)
    if (s.metrics?.revenue != null) totalRevenue += s.metrics.revenue
    if (s.metrics?.orders  != null) totalOrders  += s.metrics.orders
    if (s.metrics?.followers    != null) totalFollowers = Math.max(totalFollowers, s.metrics.followers)
    if (s.metrics?.subscribers  != null) totalFollowers = Math.max(totalFollowers, s.metrics.subscribers)
    if (s.metrics?.page_likes   != null) totalFollowers = Math.max(totalFollowers, s.metrics.page_likes)
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-status-strip" style={{ marginBottom: 16 }}>
          <span className="rs-status-dot" />
          <span>SYSTEM / ANALYTICS</span>
        </div>
        <h1 className="rs-greeting">Analytics</h1>
        <div className="rs-greeting-sub">Sales growth and audience trends across your platforms.</div>
      </header>

      <div className="rs-card-flow" style={{ marginTop: 24 }}>
        
        {/* Controls Card */}
        <div className="rs-card is-wide" style={{ padding: '12px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {RANGE_OPTIONS.map(o => (
                <button
                  key={o.days}
                  className={days === o.days ? 'rs-pill is-active' : 'rs-pill'}
                  onClick={() => setDays(o.days)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="rs-pill" onClick={loadData} disabled={loading}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>{loading ? 'sync' : 'refresh'}</span>
                {loading ? 'LOADING...' : 'REFRESH'}
              </button>
              <button
                className={showSettings ? 'rs-pill is-active' : 'rs-pill'}
                onClick={() => setShowSettings(s => !s)}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>settings</span>
                PLATFORMS
                {visiblePlatforms.size < PLATFORMS.length && (
                  <span style={{ marginLeft: 6, background: 'var(--primary)', color: '#000', borderRadius: 4, padding: '0 4px', fontSize: '0.6rem', fontWeight: 'bold' }}>
                    {visiblePlatforms.size}/{PLATFORMS.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {showSettings && (
          <div className="rs-card is-wide animate-fade-in" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="rs-card-label" style={{ marginBottom: 12 }}>PLATFORM VISIBILITY</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {PLATFORMS.map(p => {
                const on = visiblePlatforms.has(p.key)
                return (
                  <label key={p.key} className={on ? 'rs-pill is-active' : 'rs-pill'} style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ display: 'none' }}
                      checked={on}
                      onChange={() => {
                        const next = new Set(visiblePlatforms)
                        on ? next.delete(p.key) : next.add(p.key)
                        handleVisibleChange(next)
                      }}
                    />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, marginRight: 8 }} />
                    {p.label}
                  </label>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => handleVisibleChange(new Set(PLATFORMS.map(p => p.key)))}>SELECT ALL</button>
              <button className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => handleVisibleChange(new Set())}>CLEAR ALL</button>
            </div>
          </div>
        )}

        {err && <div className="rs-card is-wide" style={{ color: '#f87171', borderColor: '#f87171' }}>{err}</div>}

        {/* Summary Stats */}
        {snapshots.length > 0 && (
          <>
            <div className="rs-card">
              <span className="rs-card-label">REVENUE</span>
              <div className="rs-card-value">{fmtMoney(totalRevenue)}</div>
              <div className="rs-card-meta">Total across {platformsWithData.size} channels</div>
            </div>
            <div className="rs-card">
              <span className="rs-card-label">ORDERS</span>
              <div className="rs-card-value">{fmtNum(totalOrders)}</div>
              <div className="rs-card-meta">Successfully processed</div>
            </div>
            <div className="rs-card">
              <span className="rs-card-label">AUDIENCE</span>
              <div className="rs-card-value">{fmtNum(totalFollowers)}</div>
              <div className="rs-card-meta">Peak reach</div>
            </div>
          </>
        )}

        {/* AI Business Report Card */}
        <div className="rs-card is-wide is-elev">
          <div className="rs-card-head">
            <span className="rs-card-label" style={{ color: 'var(--primary)' }}>AI BUSINESS STRATEGIST</span>
            <button 
              className="rs-btn-primary" 
              onClick={handleGenerateReport} 
              disabled={generatingReport}
            >
              <span className="material-symbols-rounded">auto_awesome</span>
              {generatingReport ? "ANALYZING..." : "GENERATE AI REPORT"}
            </button>
          </div>
          {businessReport ? (
            <div style={{ 
              whiteSpace: "pre-wrap", 
              fontSize: "0.92rem", 
              lineHeight: 1.6, 
              background: "rgba(255,255,255,0.03)",
              padding: 20,
              borderRadius: 'var(--md-shape-lg)',
              border: '1px solid var(--md-outline-variant)'
            }}>
              {businessReport}
            </div>
          ) : (
            <div className="rs-card-meta">
              Request a natural-language summary of your recent sales, revenue, and product performance across all active platforms.
            </div>
          )}
        </div>

        {/* Platform Grid */}
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {(sortedPlatforms || []).map(p => (
            <PlatformTile
              key={p.key}
              platform={p.key}
              snapshots={snapshotsFor(p.key)}
              connected={connected.has(p.key)}
              selected={selectedPlatform === p.key}
              onSelect={key => {
                setSelectedPlatform(prev => prev === key ? null : key)
                setAddModalFor(null)
              }}
            />
          ))}
        </div>

        {selectedPlatform && (
          <PlatformDetail
            platform={selectedPlatform}
            snapshots={snapshotsFor(selectedPlatform)}
            onAddData={() => setAddModalFor(selectedPlatform)}
            onDeleteSnapshot={handleDeleteSnapshot}
            insights={platformInsights[selectedPlatform]}
            loading={insightsLoading[selectedPlatform]}
            error={insightsError[selectedPlatform]}
            onFetchInsights={() => fetchInsights(selectedPlatform)}
          />
        )}

        {!selectedPlatform && snapshots.length === 0 && !loading && (
          <div className="rs-card is-wide" style={{ textAlign: 'center', padding: 48, borderStyle: 'dashed' }}>
            <div className="rs-card-meta">Click any platform tile above to add your first data snapshot.</div>
          </div>
        )}

      </div>

      {addModalFor && (
        <AddDataModal
          platform={addModalFor}
          onClose={() => setAddModalFor(null)}
          onSave={handleSaveSnapshot}
        />
      )}
    </div>
  )
}
