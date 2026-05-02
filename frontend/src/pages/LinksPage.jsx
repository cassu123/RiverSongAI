import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './LinksPage.css'

// ─── Platform catalogue ──────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'social',       label: 'Social & Video' },
  { key: 'ecommerce',    label: 'E-Commerce' },
  { key: 'community',    label: 'Community' },
  { key: 'reading',      label: 'Reading' },
  { key: 'productivity', label: 'Productivity' },
]

const PLATFORMS = [
  // Social & Video
  {
    key: 'tiktok', label: 'TikTok', color: '#ff2d55', category: 'social', authType: 'apikey',
    keyLabel: 'Access Token', secretLabel: 'App Secret',
    hint: 'Create an app at TikTok for Developers to get your credentials.',
  },
  {
    key: 'youtube', label: 'YouTube', color: '#ff0000', category: 'social', authType: 'apikey',
    keyLabel: 'API Key', secretLabel: 'OAuth Client Secret',
    hint: 'Get an API key from Google Cloud Console under YouTube Data API v3.',
  },
  {
    key: 'instagram', label: 'Instagram', color: '#e1306c', category: 'social', authType: 'apikey',
    keyLabel: 'Access Token', secretLabel: 'App Secret',
    hint: 'Via Meta for Developers — create a Meta App with Instagram Basic Display.',
  },
  {
    key: 'twitter', label: 'X / Twitter', color: '#888', category: 'social', authType: 'apikey',
    keyLabel: 'API Key', secretLabel: 'API Secret',
    hint: 'Apply for access at the Twitter Developer Portal and create a project/app.',
  },
  {
    key: 'pinterest', label: 'Pinterest', color: '#e60023', category: 'social', authType: 'apikey',
    keyLabel: 'Access Token', secretLabel: '',
    hint: 'Register an app at Pinterest Developers to get an access token.',
  },
  // E-Commerce
  {
    key: 'amazon', label: 'Amazon', color: '#ff9900', category: 'ecommerce', authType: 'apikey',
    keyLabel: 'Access Key ID', secretLabel: 'Secret Access Key',
    hint: 'Use the Amazon Selling Partner API (SP-API). Register your app in Seller Central.',
  },
  {
    key: 'etsy', label: 'Etsy', color: '#f56400', category: 'ecommerce', authType: 'apikey',
    keyLabel: 'API Key', secretLabel: 'Shared Secret',
    hint: 'Register an app at the Etsy Developer Portal to get your key and secret.',
  },
  {
    key: 'ebay', label: 'eBay', color: '#0064d2', category: 'ecommerce', authType: 'apikey',
    keyLabel: 'App ID (Client ID)', secretLabel: 'Cert ID (Client Secret)',
    hint: 'Create an application in the eBay Developers Program to get your credentials.',
  },
  {
    key: 'shopify', label: 'Shopify', color: '#96bf48', category: 'ecommerce', authType: 'apikey',
    keyLabel: 'Access Token', secretLabel: 'Store Domain (e.g. mystore.myshopify.com)',
    hint: 'Create a Custom App in your Shopify Admin to generate an access token.',
  },
  // Community
  {
    key: 'facebook', label: 'Facebook', color: '#1877f2', category: 'community', authType: 'apikey',
    keyLabel: 'Page Access Token', secretLabel: 'App Secret',
    hint: 'Via Meta for Developers — create a Meta App and generate a long-lived Page Access Token.',
  },
  // Reading (managed on the Reading page)
  {
    key: 'kindle', label: 'Kindle', color: '#ff9900', category: 'reading', authType: 'reading',
    hint: 'Managed on the Reading page.',
  },
  {
    key: 'audible', label: 'Audible', color: '#f5ae0f', category: 'reading', authType: 'reading',
    hint: 'Managed on the Reading page.',
  },
  {
    key: 'google_play_books', label: 'Google Play Books', color: '#4285f4', category: 'reading', authType: 'reading',
    hint: 'Managed on the Reading page (Google OAuth).',
  },
  {
    key: 'libby', label: 'Libby', color: '#00bfa5', category: 'reading', authType: 'reading',
    hint: 'Managed on the Reading page.',
  },
  // Productivity
  {
    key: 'google_workspace', label: 'Google Workspace', color: '#4285f4', category: 'productivity', authType: 'google',
    hint: 'Managed on the Google page.',
  },
]

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.key, p]))

// ─── Auth helpers ────────────────────────────────────────────────────────────

function authHeaders() {
  const token = localStorage.getItem('rs-auth-token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

// ─── Platform card ────────────────────────────────────────────────────────────

function PlatformCard({ platform, stored, readingConnections, onSave, onRemove, onNavigate }) {
  const p = PLATFORM_MAP[platform]
  const [open, setOpen] = useState(false)
  const [keyVal, setKeyVal] = useState(stored?.api_key || '')
  const [secretVal, setSecretVal] = useState('')  // never pre-fill secret from server
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  // Determine connection status
  let connected = false
  if (p.authType === 'apikey') {
    connected = !!(stored?.api_key)
  } else if (p.authType === 'reading') {
    connected = !!(readingConnections?.[p.key])
  } else if (p.authType === 'google') {
    connected = false  // Google shows its own status
  }

  async function handleSave() {
    if (!keyVal.trim()) { setErr('API key is required.'); return }
    setSaving(true); setErr('')
    try {
      await onSave(p.key, keyVal.trim(), secretVal.trim())
      setSaved(true)
      setSecretVal('')
      setTimeout(() => setSaved(false), 2000)
      setOpen(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!confirm(`Disconnect ${p.label}?`)) return
    try { await onRemove(p.key) } catch {}
  }

  return (
    <div className={`lk-card ${open ? 'lk-card--open' : ''}`} style={{ '--card-color': p.color }}>
      <button className="lk-card-header" onClick={() => setOpen(o => !o)}>
        <div className="lk-card-left">
          <span className="lk-card-dot" style={{ background: connected ? p.color : 'var(--border-bright)' }} />
          <span className="lk-card-name">{p.label}</span>
        </div>
        <div className="lk-card-right">
          {connected
            ? <span className="lk-badge lk-badge--connected">CONNECTED</span>
            : <span className="lk-badge lk-badge--none">NOT CONNECTED</span>
          }
          <span className="lk-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="lk-card-body">
          <p className="lk-hint">{p.hint}</p>

          {p.authType === 'apikey' && (
            <>
              <div className="lk-field">
                <label className="lk-label">{p.keyLabel}</label>
                <input
                  className="lk-input"
                  type="password"
                  placeholder={connected ? '••••••••  (leave blank to keep current)' : 'Paste your key here'}
                  value={keyVal}
                  onChange={e => { setKeyVal(e.target.value); setErr('') }}
                  autoComplete="off"
                />
              </div>
              {p.secretLabel && (
                <div className="lk-field">
                  <label className="lk-label">{p.secretLabel}</label>
                  <input
                    className="lk-input"
                    type="password"
                    placeholder={connected ? '••••••••  (leave blank to keep current)' : 'Paste your secret here'}
                    value={secretVal}
                    onChange={e => { setSecretVal(e.target.value); setErr('') }}
                    autoComplete="off"
                  />
                </div>
              )}
              {err && <div className="lk-err">{err}</div>}
              <div className="lk-actions">
                {connected && (
                  <button className="btn btn--danger lk-btn-sm" onClick={handleRemove}>
                    Disconnect
                  </button>
                )}
                <button className="btn btn--primary lk-btn-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : connected ? 'Update Key' : 'Connect'}
                </button>
              </div>
            </>
          )}

          {(p.authType === 'reading') && (
            <div className="lk-external">
              {connected
                ? <span className="lk-connected-note">✓ Connected — manage on the Reading page</span>
                : <span className="lk-not-connected-note">Not connected</span>
              }
              <button className="btn lk-btn-sm" onClick={() => onNavigate('reading')}>
                Go to Reading →
              </button>
            </div>
          )}

          {p.authType === 'google' && (
            <div className="lk-external">
              <span className="lk-not-connected-note">Manage on the Google page</span>
              <button className="btn lk-btn-sm" onClick={() => onNavigate('google')}>
                Go to Google →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({ category, stored, readingConnections, onSave, onRemove, onNavigate }) {
  const cat = CATEGORIES.find(c => c.key === category)
  const platforms = PLATFORMS.filter(p => p.category === category)
  const connectedCount = platforms.filter(p => {
    if (p.authType === 'apikey') return !!(stored[p.key]?.api_key)
    if (p.authType === 'reading') return !!(readingConnections?.[p.key])
    return false
  }).length

  return (
    <div className="lk-category">
      <div className="lk-category-header">
        <span className="lk-category-title">{cat?.label}</span>
        {connectedCount > 0 && (
          <span className="lk-category-count">{connectedCount} connected</span>
        )}
      </div>
      <div className="lk-card-list">
        {platforms.map(p => (
          <PlatformCard
            key={p.key}
            platform={p.key}
            stored={stored[p.key]}
            readingConnections={readingConnections}
            onSave={onSave}
            onRemove={onRemove}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LinksPage({ onNavigate }) {
  const { user } = useAuth()

  const [stored,             setStored]             = useState({})   // platform key → platform row
  const [readingConnections, setReadingConnections] = useState({})
  const [loading,            setLoading]            = useState(true)
  const [err,                setErr]                = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [platforms, reading] = await Promise.all([
        apiFetch('/api/analytics/platforms'),
        apiFetch('/api/reading/connections').catch(() => ({})),
      ])
      const map = {}
      for (const p of platforms) map[p.platform] = p
      setStored(map)
      setReadingConnections(reading)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function handleSave(platform, apiKey, apiSecret) {
    await apiFetch(`/api/analytics/platforms/${platform}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true, api_key: apiKey, api_secret: apiSecret, notes: '' }),
    })
    await loadData()
  }

  async function handleRemove(platform) {
    await apiFetch(`/api/analytics/platforms/${platform}`, { method: 'DELETE' })
    await loadData()
  }

  const totalConnected = PLATFORMS.filter(p => {
    if (p.authType === 'apikey') return !!(stored[p.key]?.api_key)
    if (p.authType === 'reading') return !!(readingConnections?.[p.key])
    return false
  }).length

  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>OPERATOR</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>LINKED ACCOUNTS</span>
      </div>
      <h1 className="page-title">Linked Accounts</h1>
      <p className="page-subtitle">
        Connect your platforms in one place. API keys are stored securely and used to pull data into Analytics.
      </p>

      {loading ? (
        <div className="lk-loading">Loading…</div>
      ) : (
        <>
          {err && <div className="lk-error">{err}</div>}

          <div className="lk-summary">
            <span className="lk-summary-count">{totalConnected}</span>
            <span className="lk-summary-label"> of {PLATFORMS.filter(p => p.authType === 'apikey').length} platforms connected</span>
          </div>

          <div className="lk-categories">
            {CATEGORIES.map(cat => (
              <CategorySection
                key={cat.key}
                category={cat.key}
                stored={stored}
                readingConnections={readingConnections}
                onSave={handleSave}
                onRemove={handleRemove}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
