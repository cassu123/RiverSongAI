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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', overflow: 'visible' }}>
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke={color} strokeWidth="2" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', opacity: 0.8, letterSpacing: '0.05em', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
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
        padding: '24px'
      }}
      onClick={() => onSelect(platform)}
    >
      <div className="rs-card-head" style={{ marginBottom: 20 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span className="rs-card-value" style={{ fontSize: '2.2rem', letterSpacing: '-0.05em' }}>{fmtMetric(primary, primaryVal)}</span>
            <span className="rs-card-meta" style={{ fontSize: '0.7rem', fontWeight: 900, margin: 0, textTransform: 'uppercase' }}>{metricLabel(primary)}</span>
            {delta != null && (
              <span style={{ 
                fontSize: '0.75rem', 
                marginLeft: 'auto',
                fontWeight: 900,
                color: delta >= 0 ? 'var(--rs-status-nominal, #4ade80)' : '#f87171' 
              }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
          {revenue != null && primary !== 'revenue' && (
            <div className="rs-card-meta" style={{ marginTop: -8, fontWeight: 900 }}>{fmtMoney(revenue)} REVENUE</div>
          )}
          <LineChart data={chartData} color="var(--primary)" height={60} />
        </div>
      ) : (
        <div className="rs-card-meta" style={{ minHeight: 100, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
          <div style={{ fontStyle: 'italic', fontSize: '0.9rem' }}>STATUS: PENDING_DATA_LINK</div>
          {platform === 'shopify' && (
            <button 
              className="rs-btn-primary" 
              style={{ width: '100%', fontSize: '0.8rem' }}
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
    <div className="rs-card is-wide animate-fade-in" style={{ padding: 40, border: '1px solid var(--md-outline-variant)', marginTop: 40 }}>
      <div className="rs-card-head" style={{ marginBottom: 40, borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 16 }}>
        <div>
          <span className="rs-card-label" style={{}}>{p.label} / DETAILED_ANALYSIS</span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 950, textTransform: 'uppercase', margin: '4px 0 0' }}>{p.label}</h2>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {SUPPORTED_FOR_INSIGHTS.includes(platform) && (
            <button 
              className="rs-pill" 
              onClick={onFetchInsights}
              disabled={loading}
              style={{ border: '1px solid var(--md-outline-variant)', fontWeight: 900 }}
            >
              {loading ? 'ANALYZING...' : insights ? 'REFRESH INSIGHTS' : 'AI STRATEGIC REVIEW'}
            </button>
          )}
          <button className="rs-btn-primary" onClick={onAddData} style={{ padding: '10px 24px' }}>
            ADD DATA
          </button>
        </div>
      </div>

      {loading && <div className="rs-card-meta" style={{ fontStyle: 'italic', fontSize: '1rem', marginBottom: 24 }}>River is analysing your data...</div>}
      {error && <div style={{ color: '#f87171', fontSize: '0.9rem', marginBottom: 24, fontWeight: 700 }}>{error}</div>}

      {insights && !loading && (
        <div style={{ 
          background: 'var(--md-surface-container)', 
          padding: 24, 
          borderRadius: 4,
          marginBottom: 40,
          border: '1px solid var(--md-outline-variant)'
        }}>
          <div className="rs-card-label" style={{ marginBottom: 12, color: 'var(--md-on-surface)' }}>AI STRATEGIC INSIGHTS</div>
          <div style={{ fontSize: '1rem', lineHeight: 1.8, whiteSpace: 'pre-wrap', fontWeight: 500 }}>{insights}</div>
        </div>
      )}

      {!snapshots.length ? (
        <div className="rs-card-meta" style={{ fontSize: '1.1rem' }}>NO DATA RECORDED. PROCEED WITH INITIAL SNAPSHOT.</div>
      ) : (
        <>
          {/* Metric Charts Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 40, marginBottom: 48 }}>
            {metrics.map(metric => {
              const chartData = [...snapshots]
                .sort((a,b) => a.date.localeCompare(b.date))
                .filter(s => s.metrics?.[metric] != null)
                .map(s => ({ date: s.date, value: s.metrics[metric] }))
              if (!chartData.length) return null
              const latest = chartData[chartData.length - 1]?.value
              return (
                <div key={metric} style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24, border: '1px solid var(--md-outline-variant)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 8 }}>
                    <span className="rs-card-label" style={{ border: 'none', padding: 0 }}>{metricLabel(metric)}</span>
                    <span className="rs-card-value" style={{ fontSize: '1.8rem' }}>{fmtMetric(metric, latest)}</span>
                  </div>
                  <LineChart data={chartData} color="var(--primary)" height={100} />
                </div>
              )
            })}
          </div>

          <div className="rs-table-wrap" style={{ overflowX: 'auto', border: '1px solid var(--md-outline-variant)', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--md-outline-variant)', background: 'var(--md-surface-container-high)' }}>
                  <th style={{ padding: '16px', textAlign: 'left', fontWeight: 900 }}>DATE</th>
                  {(metrics || []).map(m => <th key={m} style={{ padding: '16px', textAlign: 'left', fontWeight: 900 }}>{metricLabel(m).toUpperCase()}</th>)}
                  <th style={{ padding: '16px' }}></th>
                </tr>
              </thead>
              <tbody>
                {[...(snapshots || [])].reverse().map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono)' }}>{s.date}</td>
                    {(metrics || []).map(m => (
                      <td key={m} style={{ padding: '12px 16px', fontWeight: 600 }}>{fmtMetric(m, s.metrics?.[m])}</td>
                    ))}
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)', cursor: 'pointer', padding: 4 }}
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
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.9)',
      backdropFilter: 'blur(4px)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rs-card animate-scale-in" style={{ width: '100%', maxWidth: 450, padding: 40 }}>
        <div className="rs-card-head" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 16 }}>
          <span className="rs-card-label" style={{}}>MANUAL_DATA_ENTRY / {p.label}</span>
          <button style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)', cursor: 'pointer' }} onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>SNAPSHOT_DATE</label>
            <input
              type="date"
              style={{ padding: '12px', border: '1px solid var(--md-outline-variant)', fontWeight: 700, fontSize: '1rem' }}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(p.metrics || []).map(m => (
              <div key={m} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>{metricLabel(m).toUpperCase()}</label>
                <input
                  type="number"
                  placeholder="0.00"
                  style={{ padding: '12px', border: '1px solid var(--md-outline-variant)', fontWeight: 700, fontSize: '1rem' }}
                  value={vals[m]}
                  onChange={e => setVals({ ...vals, [m]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {err && <div style={{ color: '#f87171', fontWeight: 700, fontSize: '0.8rem' }}>{err}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 40 }}>
          <button className="rs-pill" onClick={onClose} style={{ border: 'none', textDecoration: 'underline', fontWeight: 900 }}>CANCEL</button>
          <button className="rs-btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '12px 32px' }}>
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
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', padding: '12px 24px',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 10, fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
          letterSpacing: '0.1em', zIndex: 2000, boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}>
          {shopifyToast}
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
        <header style={{ paddingTop: 48, paddingBottom: 32, borderBottom: '2px solid var(--md-outline-variant)', marginBottom: 40 }}>
          <div className="rs-status-strip" style={{ marginBottom: 16, border: 'none', padding: 0, background: 'none' }}>
            <span className="rs-status-dot" style={{}} />
            <span style={{ color: 'var(--md-on-surface)', fontWeight: 900 }}>SYSTEM // ANALYTICS / COMMAND</span>
          </div>
          <h1 className="rs-page-title" style={{ fontSize: '4rem', marginBottom: 8 }}>Analytics</h1>
          <div style={{ fontSize: '1.1rem', fontWeight: 500, opacity: 0.7, maxWidth: '60ch' }}>
            Commercial performance, audience growth, and multi-channel telemetry.
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* Controls Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              {RANGE_OPTIONS.map(o => (
                <button
                  key={o.days}
                  className={days === o.days ? 'rs-pill is-active' : 'rs-pill'}
                  onClick={() => setDays(o.days)}
                  style={{ border: 'none', padding: '6px 0', marginRight: 16, fontWeight: 900, textDecoration: days === o.days ? 'underline' : 'none' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="rs-pill" onClick={loadData} disabled={loading} style={{ border: 'none', fontWeight: 900 }}>
                {loading ? 'SYNCING...' : 'REFRESH'}
              </button>
              <button
                className={showSettings ? 'rs-pill is-active' : 'rs-pill'}
                onClick={() => setShowSettings(s => !s)}
                style={{ border: 'none', fontWeight: 900 }}
              >
                PLATFORMS
              </button>
            </div>
          </div>
        </div>

        {showSettings && (
          <div className="rs-card is-wide animate-fade-in" style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)', padding: 32 }}>
            <div className="rs-card-label" style={{ marginBottom: 20, color: 'var(--md-on-surface)', fontSize: '0.8rem' }}>PLATFORM_VISIBILITY_CONFIG</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
              {PLATFORMS.map(p => {
                const on = visiblePlatforms.has(p.key)
                return (
                  <label key={p.key} className={on ? 'rs-pill is-active' : 'rs-pill'} style={{ cursor: 'pointer', border: '1px solid var(--md-outline-variant)', padding: '8px 16px' }}>
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
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, marginRight: 12, border: '1px solid var(--md-outline-variant)' }} />
                    <span style={{ fontWeight: 900 }}>{p.label.toUpperCase()}</span>
                  </label>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <button className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'var(--md-on-surface)' }} onClick={() => handleVisibleChange(new Set(PLATFORMS.map(p => p.key)))}>SELECT_ALL</button>
              <button className="rs-card-label" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'var(--md-on-surface)' }} onClick={() => handleVisibleChange(new Set())}>CLEAR_ALL</button>
            </div>
          </div>
        )}

        {err && <div className="rs-card is-wide" style={{ color: '#f87171', borderColor: '#f87171' }}>{err}</div>}

        {/* Summary Stats */}
        {snapshots.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 32, padding: '32px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
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
        <div className="rs-card is-wide is-elev" style={{ border: '1px solid var(--md-outline-variant)', padding: 40 }}>
          <div className="rs-card-head" style={{ border: 'none' }}>
            <span className="rs-card-label" style={{ fontSize: '0.8rem' }}>AI STRATEGIC DEBRIEF</span>
            <button 
              className="rs-btn-primary" 
              onClick={handleGenerateReport} 
              disabled={generatingReport}
              style={{ padding: '10px 24px' }}
            >
              {generatingReport ? "DECRYPTING..." : "EXECUTE ANALYSIS"}
            </button>
          </div>
          {businessReport ? (
            <div style={{ 
              whiteSpace: "pre-wrap", 
              fontSize: "1.1rem", 
              lineHeight: 1.8, 
              background: "var(--md-surface-container)",
              padding: 32,
              border: '1px solid var(--md-outline-variant)',
              marginTop: 24,
              fontFamily: 'var(--font-mono)'
            }}>
              {businessReport}
            </div>
          ) : (
            <div className="rs-card-meta" style={{ fontSize: '1rem', marginTop: 16 }}>
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
              onConnect={() => setShowShopifyModal(true)}
            />
          ))}
        </div>

        {showShopifyModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.9)',
            backdropFilter: 'blur(4px)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
          }} onClick={e => e.target === e.currentTarget && setShowShopifyModal(false)}>
            <div className="rs-card animate-scale-in" style={{ width: '100%', maxWidth: 450, padding: 40 }}>
              <div className="rs-card-head" style={{ borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 16 }}>
                <span className="rs-card-label" style={{}}>EXTERNAL_LINK / SHOPIFY</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--md-on-surface)', cursor: 'pointer' }} onClick={() => setShowShopifyModal(false)}>
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>

              {shopifyStatus.connected ? (
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--rs-status-nominal, #4ade80)' }} />
                    <span className="rs-card-meta" style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--md-on-surface)' }}>
                      CONNECTED: {shopifyStatus.shop?.toUpperCase()}
                    </span>
                  </div>
                  <div className="rs-card-meta" style={{ fontSize: '1rem' }}>Your store is currently linked. River is syncing orders and inventory telemetry in the background.</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 16 }}>
                    <button className="rs-pill" style={{ color: '#f87171', fontWeight: 900, textDecoration: 'underline' }} onClick={() => { setShowShopifyModal(false); handleDisconnectShopify() }}>DISCONNECT</button>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button className="rs-pill" onClick={() => setShowShopifyModal(false)}>CLOSE</button>
                      <button className="rs-btn-primary" onClick={() => setShopifyStatus(s => ({ ...s, connected: false }))}>RECONNECT</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 24 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="rs-card-label" style={{ border: 'none', padding: 0 }}>SHOP_DOMAIN</label>
                    <input
                      type="text"
                      style={{ padding: '12px', border: '1px solid var(--md-outline-variant)', fontWeight: 700, fontSize: '1rem' }}
                      placeholder="your-shop.myshopify.com"
                      value={shopifyDomain}
                      onChange={e => setShopifyDomain(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleConnectShopify()}
                    />
                  </div>
                  <div className="rs-card-meta" style={{ marginTop: 16, fontSize: '0.9rem' }}>
                    Enter your Shopify store domain to initialize the OAuth handshake. This will enable real-time sales analytics and inventory syncing.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 40 }}>
                    <button className="rs-pill" onClick={() => setShowShopifyModal(false)} style={{ border: 'none', textDecoration: 'underline', fontWeight: 900 }}>CANCEL</button>
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
