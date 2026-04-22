import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import InventoryVault from '../components/InventoryVault.jsx'
import QuickPOS from '../components/QuickPOS.jsx'
import './CommercePage.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TABS = [
  { key: 'inventory', label: 'INVENTORY VAULT' },
  { key: 'pos',       label: 'QUICK POS' },
  { key: 'settings',  label: 'SETTINGS' },
]

async function apiFetch(path, token, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'API error')
  }
  return res.status === 204 ? null : res.json()
}

// ---------------------------------------------------------------------------
// Workspace Settings panel
// ---------------------------------------------------------------------------

function WorkspaceSettings({ workspace, token, onUpdated }) {
  const [form, setForm] = useState({
    name:     workspace.name,
    currency: workspace.currency || 'USD',
    tax_rate: workspace.tax_rate != null ? (Number(workspace.tax_rate) * 100).toFixed(2) : '0.00',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState('')
  const [error, setError]   = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true); setMsg(''); setError('')
    try {
      const payload = {
        name:     form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
        tax_rate: Number(form.tax_rate) / 100,
      }
      const updated = await apiFetch(`/api/commerce/workspaces/${workspace.id}`, token, {
        method: 'PATCH', body: JSON.stringify(payload),
      })
      setMsg('Settings saved.')
      onUpdated(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cp-settings-panel">
      <div className="cp-settings-section">
        <div className="cp-settings-title">WORKSPACE</div>
        {msg   && <div className="cp-flash cp-flash--ok">{msg}</div>}
        {error && <div className="cp-flash cp-flash--err">{error}</div>}

        <div className="cp-field">
          <label className="cp-label">WORKSPACE NAME</label>
          <input className="cp-input" value={form.name} onChange={set('name')} />
        </div>
        <div className="cp-form-row">
          <div className="cp-field">
            <label className="cp-label">CURRENCY (ISO CODE)</label>
            <input className="cp-input" value={form.currency} onChange={set('currency')} maxLength={3} placeholder="USD" />
          </div>
          <div className="cp-field">
            <label className="cp-label">TAX RATE (%)</label>
            <input className="cp-input" type="number" min="0" step="0.01" value={form.tax_rate} onChange={set('tax_rate')} placeholder="0.00" />
          </div>
        </div>
        <div className="cp-settings-footer">
          <button className="cp-btn cp-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'SAVING...' : '>> SAVE SETTINGS'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create-workspace inline form
// ---------------------------------------------------------------------------

function CreateWorkspaceForm({ token, onCreate }) {
  const [name, setName]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setBusy(true); setError('')
    try {
      const ws = await apiFetch('/api/commerce/workspaces', token, {
        method: 'POST', body: JSON.stringify({ name: name.trim(), currency: 'USD', tax_rate: 0 }),
      })
      onCreate(ws)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="cp-create-ws">
      <div className="cp-create-ws-title">CREATE YOUR FIRST WORKSPACE</div>
      <p className="cp-create-ws-sub">A workspace represents a business, store, or brand. You can add more later.</p>
      {error && <div className="cp-flash cp-flash--err">{error}</div>}
      <div className="cp-form-row">
        <input
          className="cp-input"
          placeholder="e.g. My Boutique"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button className="cp-btn cp-btn--primary" onClick={handleCreate} disabled={busy}>
          {busy ? 'CREATING...' : '>> CREATE'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CommercePage() {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState('inventory')
  const [workspace, setWorkspace] = useState(null)
  const [wsLoading, setWsLoading] = useState(true)
  const [wsError, setWsError]     = useState('')

  const fetchWorkspace = useCallback(async () => {
    if (!token) return
    try {
      const list = await apiFetch('/api/commerce/workspaces', token)
      if (list.length > 0) setWorkspace(list[0])
    } catch (e) {
      setWsError(e.message)
    } finally {
      setWsLoading(false)
    }
  }, [token])

  useEffect(() => { fetchWorkspace() }, [fetchWorkspace])

  if (wsLoading) {
    return (
      <div className="page-wrap">
        <div className="page-breadcrumb"><span>◢</span><span>TOOLS</span><span className="page-breadcrumb-sep">/</span><span>COMMERCE</span></div>
        <h1 className="page-title">Commerce</h1>
        <div className="cp-state">Loading workspace...</div>
      </div>
    )
  }

  if (wsError) {
    return (
      <div className="page-wrap">
        <div className="page-breadcrumb"><span>◢</span><span>TOOLS</span><span className="page-breadcrumb-sep">/</span><span>COMMERCE</span></div>
        <h1 className="page-title">Commerce</h1>
        <div className="cp-state cp-state--error">Error: {wsError}</div>
      </div>
    )
  }

  return (
    <div className="commerce-page page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>TOOLS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>COMMERCE</span>
      </div>
      <h1 className="page-title">Commerce</h1>
      <p className="page-subtitle">
        Commercial inventory, stock control, and point-of-sale terminal.
        {workspace && <span className="cp-ws-badge">{workspace.name}</span>}
      </p>

      {!workspace ? (
        <CreateWorkspaceForm token={token} onCreate={(ws) => setWorkspace(ws)} />
      ) : (
        <>
          <div className="commerce-tabs">
            {TABS.map(tab => (
              <button
                key={tab.key}
                className={`commerce-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="commerce-tab-content">
            {activeTab === 'inventory' && (
              <InventoryVault workspaceId={workspace.id} token={token} />
            )}
            {activeTab === 'pos' && (
              <QuickPOS workspaceId={workspace.id} token={token} />
            )}
            {activeTab === 'settings' && (
              <WorkspaceSettings
                workspace={workspace}
                token={token}
                onUpdated={(updated) => setWorkspace(updated)}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
