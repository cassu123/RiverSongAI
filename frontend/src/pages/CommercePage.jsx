import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import InventoryVault from '../components/InventoryVault.jsx'
import './CommercePage.css'

async function apiFetch(path, token, opts = {}) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error(`Blocked absolute URL in apiFetch: ${path}`)
  }
  const res = await fetch(path, {
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
        <div className="page-breadcrumb"><span>◢</span><span>TOOLS</span><span className="page-breadcrumb-sep">/</span><span>INVENTORY</span></div>
        <h1 className="page-title">Inventory</h1>
        <div className="cp-state">Loading...</div>
      </div>
    )
  }

  if (wsError) {
    return (
      <div className="page-wrap">
        <div className="page-breadcrumb"><span>◢</span><span>TOOLS</span><span className="page-breadcrumb-sep">/</span><span>INVENTORY</span></div>
        <h1 className="page-title">Inventory</h1>
        <div className="cp-state cp-state--error">Error: {wsError}</div>
      </div>
    )
  }

  return (
    <div className="commerce-page page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>TOOLS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>INVENTORY</span>
      </div>
      <h1 className="page-title">Inventory</h1>
      <p className="page-subtitle">
        Track products, stock levels, and images.
        {workspace && <span className="cp-ws-badge">{workspace.name}</span>}
      </p>

      {!workspace ? (
        <CreateWorkspaceForm token={token} onCreate={(ws) => setWorkspace(ws)} />
      ) : (
        <InventoryVault workspaceId={workspace.id} token={token} />
      )}
    </div>
  )
}
