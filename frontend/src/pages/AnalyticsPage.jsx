import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@context/AuthContext'

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
    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--rs-fs-nano)', fontStyle: 'italic', height, display: 'flex', alignItems: 'center' }}>
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
    <div className="rs-flex rs-flex-col rs-gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />
        ))}
      </svg>
      <div className="rs-flex rs-justify-between rs-type-nano rs-mono rs-fw-900" style={{ opacity: 0.8, letterSpacing: '0.05em' }}>
        <span>{first.toUpperCase()}</span>
        <span>{last.toUpperCase()}</span>
      </div>
    </div>
  )
}

// ─── Platform tile (summary card) ────────────────────────────────────────────

function PlatformTile({ platform, snapshots, connected, onSelect, selected, onConnect }) {
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
        flex: '1 1 280px',
        opacity: connected ? 1 : 0.6,
        borderLeft: selected ? `8px solid ${p.color}` : `1px solid #111`,
        padding: 'var(--rs-space-5)'
      }}
      onClick={() => onSelect(platform)}
    >
      <div className="rs-card-head rs-mb-5">
        <span className="rs-card-label" style={{ color: 'var(--md-on-surface)', borderBottomColor: p.color }}>{p.label} / TELEMETRY</span>
        <div className="rs-status-dot" style={{ 
          background: connected ? 'var(--primary)' : 'var(--md-outline-variant)',
          boxShadow: 'none',
          animation: connected ? undefined : 'none',
          width: 8, height: 8,
          border: '1px solid var(--md-outline-variant)'
        }} />
      </div>

      {connected && latest ? (
        <div className="rs-flex rs-flex-col rs-gap-4">
          <div className="rs-flex rs-gap-3" style={{ alignItems: 'baseline' }}>
            <span className="rs-card-value" style={{ fontSize: '2.2rem', letterSpacing: '-0.05em' }}>{fmtMetric(primary, primaryVal)}</span>
            <span className="rs-card-meta rs-m-0 rs-type-nano rs-fw-900" style={{ textTransform: 'uppercase' }}>{metricLabel(primary)}</span>
            {delta != null && (
              <span className="rs-type-micro rs-fw-900" style={{
                marginLeft: 'auto',
                color: delta >= 0 ? 'var(--rs-status-nominal, #4ade80)' : 'var(--rs-status-critical)',
              }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          {revenue != null && primary !== 'revenue' && (
            <div className="rs-card-meta rs-fw-900" style={{ marginTop: -8 }}>{fmtMoney(revenue)} REVENUE</div>
          )}
          <LineChart data={chartData} color="var(--primary)" height={60} />
        </div>
      ) : (
        <div className="rs-card-meta rs-flex rs-flex-col rs-justify-center rs-gap-4" style={{ minHeight: 100 }}>
          <div className="rs-type-small" style={{ fontStyle: 'italic' }}>STATUS: PENDING_DATA_LINK</div>
          {platform === 'shopify' && (
            <button 
              className="rs-btn-primary rs-w-full rs-type-tiny" 
             
              onClick={(e) => { e.stopPropagation(); onConnect(); }}
            >
              INITIALIZE CONNECTION
            </button>
          )}
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
  const SUPPORTED_FOR_INSIGHTS = ['tiktok', 'instagram', 'amazon', 'etsy', 'facebook', 'shopify']
  const metrics = p.metrics.length ? p.metrics : Object.keys(snapshots[0]?.metrics || {})

  return (
    <div className="rs-card is-wide animate-fade-in rs-p-7 rs-mt-7" style={{ border: '1px solid var(--md-outline-variant)' }}>
      <div className="rs-card-head rs-mb-7" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-4)' }}>
        <div>
          <span className="rs-card-label">{p.label} / DETAILED_ANALYSIS</span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 950, textTransform: 'uppercase', margin: 'var(--rs-space-1) 0 0' }}>{p.label}</h2>
        </div>
        <div className="rs-flex rs-gap-3">
          {SUPPORTED_FOR_INSIGHTS.includes(platform) && (
            <button 
              className="rs-pill rs-fw-900" 
              onClick={onFetchInsights}
              disabled={loading}
              style={{ border: '1px solid var(--md-outline-variant)' }}
            >
              {loading ? 'ANALYZING...' : insights ? 'REFRESH INSIGHTS' : 'AI STRATEGIC REVIEW'}
            </button>
          )}
          <button className="rs-btn-primary" onClick={onAddData} style={{ padding: 'var(--rs-space-3) var(--rs-space-5)' }}>
            ADD DATA
          </button>
        </div>
      </div>

      {loading && <div className="rs-card-meta rs-mb-5 rs-type-body" style={{ fontStyle: 'italic' }}>River is analysing your data...</div>}
      {error && <div className="rs-mb-5 rs-type-small rs-c-critical rs-fw-700">{error}</div>}

      {insights && !loading && (
        <div className="rs-p-5 rs-mb-7" style={{
          background: 'var(--md-surface-container)',
          borderRadius: 'var(--md-shape-xs)',
          border: '1px solid var(--md-outline-variant)',
        }}>
          <div className="rs-card-label rs-mb-3" style={{ color: 'var(--md-on-surface)' }}>AI STRATEGIC INSIGHTS</div>
          <div className="rs-type-body rs-fw-500" style={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{insights}</div>
        </div>
      )}

      {!snapshots.length ? (
        <div className="rs-card-meta rs-type-body">NO DATA RECORDED. PROCEED WITH INITIAL SNAPSHOT.</div>
      ) : (
        <>
          {/* Metric Charts Grid */}
          <div className="rs-gap-7 rs-mb-7" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            {metrics.map(metric => {
              const chartData = [...snapshots]
                .sort((a,b) => a.date.localeCompare(b.date))
                .filter(s => s.metrics?.[metric] != null)
                .map(s => ({ date: s.date, value: s.metrics[metric] }))
              if (!chartData.length) return null
              const latest = chartData[chartData.length - 1]?.value
              return (
                <div key={metric} className="rs-flex rs-flex-col rs-gap-5 rs-p-5" style={{ border: '1px solid var(--md-outline-variant)' }}>
                  <div className="rs-flex rs-justify-between" style={{ alignItems: 'baseline', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-2)' }}>
                    <span className="rs-card-label" style={{ border: 'none', padding: 0 }}>{metricLabel(metric)}</span>
                    <span className="rs-card-value" style={{ fontSize: '1.8rem' }}>{fmtMetric(metric, latest)}</span>
                  </div>
                  <LineChart data={chartData} color="var(--primary)" height={100} />
                </div>
              )
            })}
          </div>

          <div className="rs-table-wrap" style={{ overflowX: 'auto', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-xs)' }}>
            <table className="rs-w-full rs-type-small" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--md-outline-variant)', background: 'var(--md-surface-container-high)' }}>
                  <th className="rs-text-left rs-fw-900" style={{ padding: 'var(--rs-space-4)' }}>DATE</th>
                  {(metrics || []).map(m => <th key={m} className="rs-text-left rs-fw-900" style={{ padding: 'var(--rs-space-4)' }}>{metricLabel(m).toUpperCase()}</th>)}
                  <th style={{ padding: 'var(--rs-space-4)' }}></th>
                </tr>
              </thead>
              <tbody>
                {[...(snapshots || [])].reverse().map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td className="rs-mono" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)' }}>{s.date}</td>
                    {(metrics || []).map(m => (
                      <td key={m} className="rs-fw-600" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)' }}>{fmtMetric(m, s.metrics?.[m])}</td>
                    ))}
                    <td className="rs-text-right" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)' }}>
                      <button
                        className="rs-p-1 rs-pointer" style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)' }}
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
        </>
      )}
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
    <div className="rs-flex rs-items-center rs-justify-center rs-p-5" style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(255,255,255,0.9)',
      backdropFilter: 'blur(4px)',
      zIndex: 2000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rs-card animate-scale-in rs-w-full rs-p-7" style={{ maxWidth: 450 }}>
        <div className="rs-card-head" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-4)' }}>
          <span className="rs-card-label">MANUAL_DATA_ENTRY / {p.label}</span>
          <button className="rs-pointer" style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)' }} onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="rs-flex rs-flex-col rs-gap-5 rs-mt-6">
          <div className="rs-flex rs-flex-col rs-gap-2">
            <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>SNAPSHOT_DATE</label>
            <input
              type="date"
              className="rs-type-body rs-fw-700" style={{ padding: 'var(--rs-space-3)', border: '1px solid var(--md-outline-variant)' }}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(p.metrics || []).map(m => (
              <div key={m} className="rs-flex rs-flex-col rs-gap-2">
                <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>{metricLabel(m).toUpperCase()}</label>
                <input
                  type="number"
                  placeholder="0.00"
                  className="rs-type-body rs-fw-700" style={{ padding: 'var(--rs-space-3)', border: '1px solid var(--md-outline-variant)' }}
                  value={vals[m]}
                  onChange={e => setVals({ ...vals, [m]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {err && <div className="rs-type-tiny rs-c-critical rs-fw-700">{err}</div>}
        </div>

        <div className="rs-flex rs-gap-4 rs-mt-7 rs-justify-end">
          <button className="rs-pill rs-fw-900" onClick={onClose} style={{ border: 'none', textDecoration: 'underline' }}>CANCEL</button>
          <button className="rs-btn-primary" onClick={handleSave} disabled={saving} style={{ padding: 'var(--rs-space-3) var(--rs-space-6)' }}>
            {saving ? 'RECORDING…' : 'COMMIT DATA'}
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

  // Shopify connection state
  const [showShopifyModal, setShowShopifyModal] = useState(false)
  const [shopifyDomain, setShopifyDomain] = useState('')
  const [shopifyConnecting, setShopifyConnecting] = useState(false)
  const [shopifyStatus, setShopifyStatus] = useState({ connected: false, shop: null, loading: true })
  const [shopifyToast, setShopifyToast] = useState('')

  const fetchShopifyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify/status', { headers: authHeaders() })
      const data = await res.json()
      setShopifyStatus({ ...data, loading: false })
    } catch {
      setShopifyStatus({ connected: false, loading: false })
    }
  }, [])

  const handleDisconnectShopify = async () => {
    if (!confirm('Disconnect your Shopify store?')) return
    try {
      await fetch('/api/shopify/auth', { method: 'DELETE', headers: authHeaders() })
      setShopifyStatus({ connected: false, shop: null, loading: false })
      setShopifyToast('Shopify disconnected.')
      setTimeout(() => setShopifyToast(''), 3000)
    } catch {
      setErr('Failed to disconnect Shopify.')
    }
  }

  const handleConnectShopify = async () => {
    if (!shopifyDomain) return
    setShopifyConnecting(true)
    try {
      let domain = shopifyDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
      if (!domain.includes('.')) domain += '.myshopify.com'
      const res = await fetch(`/api/shopify/auth/url?shop=${domain}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('Could not get Shopify auth URL')
      const data = await res.json()
      window.location.href = data.auth_url
    } catch (e) {
      setErr('Shopify Error: ' + e.message)
      setShopifyConnecting(false)
    }
  }

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

  useEffect(() => {
    fetchShopifyStatus()
    // Handle post-OAuth redirect params
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'shopify') {
      setShopifyToast('Shopify store connected successfully!')
      setTimeout(() => setShopifyToast(''), 4000)
      window.history.replaceState({}, '', '/analytics')
      fetchShopifyStatus()
    } else if (params.get('error')) {
      setErr('Shopify connection failed: ' + params.get('error'))
      window.history.replaceState({}, '', '/analytics')
    }
  }, [fetchShopifyStatus])

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
  if (shopifyStatus.connected) connected.add('shopify')
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
    <div className="animate-fade-in" style={{ paddingBottom: 64 }}>
      {shopifyToast && (
        <div className="rs-mono rs-type-tiny" style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--md-surface-container-high)',
          color: 'var(--md-on-surface)',
          padding: 'var(--rs-space-3) var(--rs-space-5)',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 'var(--md-shape-sm)',
          letterSpacing: '0.1em',
          zIndex: 2000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {shopifyToast}
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 var(--rs-space-5)' }}>
        <header className="rs-mb-7" style={{ paddingTop: 'var(--rs-space-7)', paddingBottom: 'var(--rs-space-6)', borderBottom: '2px solid var(--md-outline-variant)' }}>
          <div className="rs-status-strip rs-mb-4" style={{ border: 'none', padding: 0, background: 'none' }}>
            <span className="rs-status-dot" />
            <span className="rs-fw-900" style={{ color: 'var(--md-on-surface)' }}>SYSTEM // ANALYTICS / COMMAND</span>
          </div>
          <h1 className="rs-page-title rs-mb-2" style={{ fontSize: '4rem' }}>Analytics</h1>
          <div className="rs-muted rs-type-body rs-fw-500" style={{ maxWidth: '60ch' }}>
            Commercial performance, audience growth, and multi-channel telemetry.
          </div>
        </header>

        <div className="rs-flex rs-flex-col rs-gap-6">

          {/* Controls Bar */}
          <div className="rs-flex rs-items-center rs-justify-between rs-flex-wrap rs-gap-4" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-4)' }}>
            <div className="rs-flex rs-gap-3">
              {RANGE_OPTIONS.map(o => (
                <button
                  key={o.days}
                  className={`${days === o.days ? 'rs-pill is-active' : 'rs-pill'} rs-fw-900`}
                  onClick={() => setDays(o.days)}
                  style={{ border: 'none', padding: 'var(--rs-space-2) 0', marginRight: 'var(--rs-space-4)', textDecoration: days === o.days ? 'underline' : 'none' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="rs-flex rs-gap-3">
              <button className="rs-pill rs-fw-900" onClick={loadData} disabled={loading} style={{ border: 'none' }}>
                {loading ? 'SYNCING...' : 'REFRESH'}
              </button>
              <button
                className={`${showSettings ? 'rs-pill is-active' : 'rs-pill'} rs-fw-900`}
                onClick={() => setShowSettings(s => !s)}
                style={{ border: 'none' }}
              >
                PLATFORMS
              </button>
            </div>
          </div>
        </div>

        {showSettings && (
          <div className="rs-card is-wide animate-fade-in rs-p-6" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)' }}>
            <div className="rs-card-label rs-mb-5 rs-type-tiny" style={{ color: 'var(--md-on-surface)' }}>PLATFORM_VISIBILITY_CONFIG</div>
            <div className="rs-flex rs-flex-wrap rs-gap-3 rs-mb-5">
              {PLATFORMS.map(p => {
                const on = visiblePlatforms.has(p.key)
                return (
                  <label key={p.key} className={`${on ? 'rs-pill is-active' : 'rs-pill'} rs-pointer`} style={{ border: '1px solid var(--md-outline-variant)', padding: 'var(--rs-space-2) var(--rs-space-4)' }}>
                    <input
                      type="checkbox"
                      className="rs-hidden"
                      checked={on}
                      onChange={() => {
                        const next = new Set(visiblePlatforms)
                        on ? next.delete(p.key) : next.add(p.key)
                        handleVisibleChange(next)
                      }}
                    />
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, marginRight: 'var(--rs-space-3)', border: '1px solid var(--md-outline-variant)' }} />
                    <span className="rs-fw-900">{p.label.toUpperCase()}</span>
                  </label>
                )
              })}
            </div>
            <div className="rs-flex rs-gap-5">
              <button className="rs-card-label rs-pointer" style={{ background: 'none', border: 'none', textDecoration: 'underline', color: 'var(--md-on-surface)' }} onClick={() => handleVisibleChange(new Set(PLATFORMS.map(p => p.key)))}>SELECT_ALL</button>
              <button className="rs-card-label rs-pointer" style={{ background: 'none', border: 'none', textDecoration: 'underline', color: 'var(--md-on-surface)' }} onClick={() => handleVisibleChange(new Set())}>CLEAR_ALL</button>
            </div>
          </div>
        )}

        {err && <div className="rs-card is-wide rs-c-critical" style={{ borderColor: 'var(--rs-status-critical)' }}>{err}</div>}

        {/* Summary Stats */}
        {snapshots.length > 0 && (
          <div className="rs-gap-6" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', padding: 'var(--rs-space-6) 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
            <div>
              <span className="rs-card-label">REVENUE / AGGREGATE</span>
              <div className="rs-card-value" style={{ fontSize: '3rem' }}>{fmtMoney(totalRevenue)}</div>
              <div className="rs-card-meta">Total across {platformsWithData.size} channels</div>
            </div>
            <div>
              <span className="rs-card-label">ORDERS / VOLUME</span>
              <div className="rs-card-value" style={{ fontSize: '3rem' }}>{fmtNum(totalOrders)}</div>
              <div className="rs-card-meta">Successfully processed</div>
            </div>
            <div>
              <span className="rs-card-label">REACH / PEAK</span>
              <div className="rs-card-value" style={{ fontSize: '3rem' }}>{fmtNum(totalFollowers)}</div>
              <div className="rs-card-meta">Maximum audience scale</div>
            </div>
          </div>
        )}

        {/* AI Business Report Card */}
        <div className="rs-card is-wide is-elev rs-p-7" style={{ border: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-card-head" style={{ border: 'none' }}>
            <span className="rs-card-label rs-type-tiny">AI STRATEGIC DEBRIEF</span>
            <button 
              className="rs-btn-primary" 
              onClick={handleGenerateReport} 
              disabled={generatingReport}
              style={{ padding: 'var(--rs-space-3) var(--rs-space-5)' }}
            >
              {generatingReport ? "DECRYPTING..." : "EXECUTE ANALYSIS"}
            </button>
          </div>
          {businessReport ? (
            <div className="rs-p-6 rs-mt-5 rs-mono" style={{
              whiteSpace: "pre-wrap",
              fontSize: "1.1rem",
              lineHeight: 1.8,
              background: "var(--md-surface-container)",
              border: '1px solid var(--md-outline-variant)',
            }}>
              {businessReport}
            </div>
          ) : (
            <div className="rs-card-meta rs-mt-4 rs-type-body">
              Request a natural-language summary of your recent sales, revenue, and product performance across all active platforms.
            </div>
          )}
        </div>

        {/* Platform Grid */}
        <div className="rs-w-full rs-gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
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
              onConnect={() => setShowShopifyModal(true)}
            />
          ))}
        </div>

        {showShopifyModal && (
          <div className="rs-flex rs-items-center rs-justify-center rs-p-5" style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(4px)',
            zIndex: 2000,
          }} onClick={e => e.target === e.currentTarget && setShowShopifyModal(false)}>
            <div className="rs-card animate-scale-in rs-w-full rs-p-7" style={{ maxWidth: 450 }}>
              <div className="rs-card-head" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 'var(--rs-space-4)' }}>
                <span className="rs-card-label">EXTERNAL_LINK / SHOPIFY</span>
                <button className="rs-pointer" style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)' }} onClick={() => setShowShopifyModal(false)}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>

              {shopifyStatus.connected ? (
                <div className="rs-mt-5 rs-flex rs-flex-col rs-gap-5">
                  <div className="rs-flex rs-items-center rs-gap-3">
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--rs-status-nominal, #4ade80)' }} />
                    <span className="rs-card-meta rs-m-0 rs-type-body rs-fw-900" style={{ color: 'var(--md-on-surface)' }}>
                      CONNECTED: {shopifyStatus.shop?.toUpperCase()}
                    </span>
                  </div>
                  <div className="rs-card-meta rs-type-body">Your store is currently linked. River is syncing orders and inventory telemetry in the background.</div>
                  <div className="rs-flex rs-justify-between rs-gap-4 rs-mt-4">
                    <button className="rs-pill rs-c-critical rs-fw-900" style={{ textDecoration: 'underline' }} onClick={() => { setShowShopifyModal(false); handleDisconnectShopify() }}>DISCONNECT</button>
                    <div className="rs-flex rs-gap-3">
                      <button className="rs-pill" onClick={() => setShowShopifyModal(false)}>CLOSE</button>
                      <button className="rs-btn-primary" onClick={() => setShopifyStatus(s => ({ ...s, connected: false }))}>RECONNECT</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rs-mt-5">
                  <div className="rs-flex rs-flex-col rs-gap-2">
                    <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>SHOP_DOMAIN</label>
                    <input
                      type="text"
                      className="rs-type-body rs-fw-700" style={{ padding: 'var(--rs-space-3)', border: '1px solid var(--md-outline-variant)' }}
                      placeholder="your-shop.myshopify.com"
                      value={shopifyDomain}
                      onChange={e => setShopifyDomain(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleConnectShopify()}
                    />
                  </div>
                  <div className="rs-card-meta rs-mt-4 rs-type-small">
                    Enter your Shopify store domain to initialize the OAuth handshake. This will enable real-time sales analytics and inventory syncing.
                  </div>
                  <div className="rs-flex rs-gap-4 rs-mt-7 rs-justify-end">
                    <button className="rs-pill rs-fw-900" onClick={() => setShowShopifyModal(false)} style={{ border: 'none', textDecoration: 'underline' }}>CANCEL</button>
                    <button className="rs-btn-primary" onClick={handleConnectShopify} disabled={shopifyConnecting || !shopifyDomain.trim()}>
                      {shopifyConnecting ? 'LINKING…' : 'INITIALIZE LINK'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
          <div className="rs-card is-wide rs-text-center rs-p-7" style={{ borderStyle: 'dashed' }}>
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
