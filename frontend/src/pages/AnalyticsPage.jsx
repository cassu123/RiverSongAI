import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './AnalyticsPage.css'

// ─── Platform catalogue ──────────────────────────────────────────────────────

const PLATFORMS = [
  { key: 'tiktok',    label: 'TikTok',    color: '#ff2d55', metrics: ['followers','views','likes','revenue'] },
  { key: 'instagram', label: 'Instagram', color: '#e1306c', metrics: ['followers','impressions','reach','likes'] },
  { key: 'facebook',  label: 'Facebook',  color: '#1877f2', metrics: ['page_likes','reach','engagements','revenue'] },
  { key: 'amazon',    label: 'Amazon',    color: '#ff9900', metrics: ['orders','revenue','units_sold','returns'] },
  { key: 'etsy',      label: 'Etsy',      color: '#f56400', metrics: ['orders','revenue','views','favorites'] },
  { key: 'youtube',   label: 'YouTube',   color: '#ff0000', metrics: ['subscribers','views','watch_hours','revenue'] },
  { key: 'ebay',      label: 'eBay',      color: '#0064d2', metrics: ['orders','revenue','listing_views','watchers'] },
  { key: 'shopify',   label: 'Shopify',   color: '#96bf48', metrics: ['orders','revenue','sessions','conversion_rate'] },
  { key: 'pinterest', label: 'Pinterest', color: '#e60023', metrics: ['followers','impressions','saves','clicks'] },
  { key: 'twitter',   label: 'X / Twitter', color: '#aaa',  metrics: ['followers','impressions','likes','retweets'] },
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
    <div className="an-chart-empty">Not enough data</div>
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
    <div className="an-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="an-chart-svg">
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
      <div className="an-chart-axis">
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
  const chartData = snapshots.map(s => ({ date: s.date, value: s.metrics?.[primary] ?? 0 }))

  return (
    <div
      className={`an-tile ${selected ? 'an-tile--selected' : ''} ${!connected ? 'an-tile--inactive' : ''}`}
      style={{ '--tile-color': p.color }}
      onClick={() => onSelect(platform)}
    >
      <div className="an-tile-header">
        <span className="an-tile-name">{p.label}</span>
        {connected
          ? <span className="an-tile-dot an-tile-dot--on" title="Connected" />
          : <span className="an-tile-dot an-tile-dot--off" title="No data" />
        }
      </div>

      {connected && latest ? (
        <>
          <div className="an-tile-primary">
            <span className="an-tile-val">{fmtMetric(primary, primaryVal)}</span>
            <span className="an-tile-metric-label">{metricLabel(primary)}</span>
            {delta != null && (
              <span className={`an-tile-delta ${delta >= 0 ? 'an-tile-delta--up' : 'an-tile-delta--down'}`}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          {revenue != null && primary !== 'revenue' && (
            <div className="an-tile-revenue">{fmtMoney(revenue)} revenue</div>
          )}
          <LineChart data={chartData} color={p.color} height={60} />
        </>
      ) : (
        <div className="an-tile-empty">No data yet — add a snapshot to get started.</div>
      )}
    </div>
  )
}

// ─── Detail panel ────────────────────────────────────────────────────────────

function PlatformDetail({ platform, snapshots, onAddData, onDeleteSnapshot }) {
  const p = PLATFORM_MAP[platform] || { label: platform, color: '#888', metrics: [] }
  if (!snapshots.length) return (
    <div className="an-detail">
      <div className="an-detail-header">
        <h2 className="an-detail-title" style={{ color: p.color }}>{p.label}</h2>
        <button className="btn" onClick={onAddData}>+ Add Data</button>
      </div>
      <div className="an-detail-empty">No snapshots yet. Add your first data point.</div>
    </div>
  )

  const metrics = p.metrics.length ? p.metrics : Object.keys(snapshots[0]?.metrics || {})

  return (
    <div className="an-detail">
      <div className="an-detail-header">
        <h2 className="an-detail-title" style={{ color: p.color }}>{p.label}</h2>
        <button className="btn" onClick={onAddData}>+ Add Data</button>
      </div>

      <div className="an-detail-charts">
        {metrics.map(metric => {
          const chartData = snapshots
            .filter(s => s.metrics?.[metric] != null)
            .map(s => ({ date: s.date, value: s.metrics[metric] }))
          if (!chartData.length) return null
          const latest = chartData[chartData.length - 1]?.value
          return (
            <div key={metric} className="an-metric-block">
              <div className="an-metric-header">
                <span className="an-metric-name">{metricLabel(metric)}</span>
                <span className="an-metric-latest">{fmtMetric(metric, latest)}</span>
              </div>
              <LineChart data={chartData} color={p.color} height={90} />
            </div>
          )
        })}
      </div>

      <div className="an-detail-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Date</th>
              {metrics.map(m => <th key={m}>{metricLabel(m)}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...snapshots].reverse().map(s => (
              <tr key={s.id}>
                <td>{s.date}</td>
                {metrics.map(m => (
                  <td key={m}>{fmtMetric(m, s.metrics?.[m])}</td>
                ))}
                <td>
                  <button
                    className="an-del-btn"
                    onClick={() => onDeleteSnapshot(s.id)}
                    title="Delete"
                  >✕</button>
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
  const [vals, setVals] = useState(Object.fromEntries(p.metrics.map(m => [m, ''])))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    setSaving(true)
    setErr('')
    const metrics = {}
    for (const [k, v] of Object.entries(vals)) {
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
    <div className="an-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="an-modal-box">
        <div className="an-modal-header">
          <span className="an-modal-title">Add {p.label} Data</span>
          <button className="an-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="an-modal-body">
          <div className="an-modal-row">
            <label className="an-modal-label">Date</label>
            <input
              type="date"
              className="an-modal-input"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          {p.metrics.map(m => (
            <div key={m} className="an-modal-row">
              <label className="an-modal-label">{metricLabel(m)}</label>
              <input
                type="number"
                className="an-modal-input"
                placeholder="—"
                value={vals[m]}
                onChange={e => setVals(v => ({ ...v, [m]: e.target.value }))}
              />
            </div>
          ))}
          {err && <div className="an-modal-err">{err}</div>}
        </div>
        <div className="an-modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Summary bar ─────────────────────────────────────────────────────────────

function SummaryBar({ snapshots }) {
  let totalRevenue = 0
  let totalOrders  = 0
  let totalFollowers = 0
  const platformsWithData = new Set()

  for (const s of snapshots) {
    platformsWithData.add(s.platform)
    if (s.metrics?.revenue != null) totalRevenue += s.metrics.revenue
    if (s.metrics?.orders  != null) totalOrders  += s.metrics.orders
    if (s.metrics?.followers    != null) totalFollowers = Math.max(totalFollowers, s.metrics.followers)
    if (s.metrics?.subscribers  != null) totalFollowers = Math.max(totalFollowers, s.metrics.subscribers)
    if (s.metrics?.page_likes   != null) totalFollowers = Math.max(totalFollowers, s.metrics.page_likes)
  }

  const stats = [
    { label: 'Platforms Tracked', value: platformsWithData.size },
    { label: 'Total Revenue',     value: fmtMoney(totalRevenue || null) },
    { label: 'Total Orders',      value: fmtNum(totalOrders || null) },
    { label: 'Max Audience',      value: fmtNum(totalFollowers || null) },
  ]

  return (
    <div className="an-summary-bar">
      {stats.map(s => (
        <div key={s.label} className="an-summary-stat">
          <span className="an-summary-val">{s.value || '—'}</span>
          <span className="an-summary-label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Platform settings panel ────────────────────────────────────────────────

function PlatformSettings({ visible, onChange }) {
  return (
    <div className="an-settings-panel">
      <div className="an-settings-heading">Platforms</div>
      <p className="an-settings-hint">Choose which platforms appear on your dashboard.</p>
      <div className="an-settings-grid">
        {PLATFORMS.map(p => {
          const on = visible.has(p.key)
          return (
            <label key={p.key} className={`an-settings-chip ${on ? 'an-settings-chip--on' : ''}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const next = new Set(visible)
                  on ? next.delete(p.key) : next.add(p.key)
                  onChange(next)
                }}
              />
              <span className="an-settings-dot" style={{ background: p.color }} />
              {p.label}
            </label>
          )
        })}
      </div>
      <div className="an-settings-actions">
        <button className="an-settings-link" onClick={() => onChange(new Set(PLATFORMS.map(p => p.key)))}>
          Select all
        </button>
        <button className="an-settings-link" onClick={() => onChange(new Set())}>
          Clear all
        </button>
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

  function handleVisibleChange(next) {
    setVisiblePlatforms(next)
    saveVisible(userId, next)
    // deselect if current selection is now hidden
    if (selectedPlatform && !next.has(selectedPlatform)) setSelectedPlatform(null)
  }

  
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
    return snapshots.filter(s => s.platform === platform)
  }

  function connectedPlatforms() {
    const withData = new Set(snapshots.map(s => s.platform))
    const withConfig = new Set(platforms.map(p => p.platform))
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

  // Filter to only user-selected platforms, sorted: data first
  const sortedPlatforms = [...PLATFORMS]
    .filter(p => visiblePlatforms.has(p.key))
    .sort((a, b) => {
      const aHas = snapshotsFor(a.key).length > 0
      const bHas = snapshotsFor(b.key).length > 0
      if (aHas && !bHas) return -1
      if (!aHas && bHas) return 1
      return 0
    })

  const latestSnapshots = snapshots.filter(s => {
    const forPlatform = snapshots.filter(x => x.platform === s.platform)
    return s === forPlatform[forPlatform.length - 1]
  })

  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>SYSTEM</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>ANALYTICS</span>
      </div>
      <h1 className="page-title">Analytics</h1>
      <p className="page-subtitle">
        Sales growth and audience trends across your platforms.
      </p>

      <div className="an-controls">
        <div className="an-range-btns">
          {RANGE_OPTIONS.map(o => (
            <button
              key={o.days}
              className={`an-range-btn ${days === o.days ? 'an-range-btn--active' : ''}`}
              onClick={() => setDays(o.days)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={loadData} disabled={loading}>
          {loading ? 'Loading…' : '↺ Refresh'}
        </button>
        <button
          className={`an-settings-toggle ${showSettings ? 'an-settings-toggle--active' : ''}`}
          onClick={() => setShowSettings(s => !s)}
          title="Platform settings"
        >
          ⚙ Platforms
          {visiblePlatforms.size < PLATFORMS.length && (
            <span className="an-settings-badge">{visiblePlatforms.size}/{PLATFORMS.length}</span>
          )}
        </button>
      </div>

      {showSettings && (
        <PlatformSettings visible={visiblePlatforms} onChange={handleVisibleChange} />
      )}

      {err && <div className="an-error">{err}</div>}

      {snapshots.length > 0 && <SummaryBar snapshots={latestSnapshots} />}
      
      {/* AI Business Report Section */}
      <div className="card analytics-report-card" style={{ marginBottom: 24, padding: 20, border: "1px solid var(--md-outline-variant)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: "0.85rem", letterSpacing: "0.05em", color: "var(--md-primary)" }}>
            AI BUSINESS STRATEGIST
          </div>
          <button 
            className="btn btn--cta" 
            onClick={handleGenerateReport} 
            disabled={generatingReport}
          >
            {generatingReport ? "ANALYZING..." : "GENERATE AI REPORT"}
          </button>
        </div>
        {businessReport ? (
          <div style={{ 
            whiteSpace: "pre-wrap", 
            fontSize: "0.85rem", 
            lineHeight: 1.6, 
            color: "var(--md-on-surface)",
            background: "var(--md-surface-container-highest)",
            padding: 16,
            borderRadius: 8
          }}>
            {businessReport}
          </div>
        ) : (
          <div style={{ fontSize: "0.75rem", color: "var(--md-outline)" }}>
            Click the button to generate a natural-language summary of your recent sales, revenue, and product performance.
          </div>
        )}
      </div>
    

      <div className="an-platform-grid">
        {sortedPlatforms.map(p => (
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
        />
      )}

      {!selectedPlatform && snapshots.length === 0 && !loading && (
        <div className="an-getting-started">
          <p>Click any platform tile above to add your first data snapshot.</p>
        </div>
      )}

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
