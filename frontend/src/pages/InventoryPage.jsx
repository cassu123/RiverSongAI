import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './InventoryPage.css'

// ─── constants ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Electronics','Furniture','Appliance','Tool','Clothing',
  'Document','Vehicle','Jewelry','Collectible','Sporting Goods','Other',
]

const STATUS_COLORS = {
  Serviceable:   'var(--secondary)',
  Unserviceable: 'var(--error)',
  Missing:       'var(--warn)',
  'In-Use':      'var(--primary)',
}

const QR_STANDARDS = ['qr','code128','ein']

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}

function fmtMoney(v) {
  if (v == null) return '—'
  return `$${parseFloat(v).toFixed(2)}`
}

// ─── tiny sub-components ────────────────────────────────────────────────────

function Badge({ status }) {
  return (
    <span className="inv-badge" style={{ borderColor: STATUS_COLORS[status], color: STATUS_COLORS[status] }}>
      {status}
    </span>
  )
}

function Field({ label, value }) {
  if (!value) return null
  return (
    <div className="inv-field">
      <span className="inv-field-label">{label}</span>
      <span className="inv-field-value">{value}</span>
    </div>
  )
}

// ─── Home selector card ──────────────────────────────────────────────────────

function HomeCard({ home, isActive, onClick }) {
  return (
    <button className={`inv-home-card ${isActive ? 'inv-home-card--active' : ''}`} onClick={onClick}>
      <div className="inv-home-card-icon"><IconHome /></div>
      <div className="inv-home-card-info">
        <div className="inv-home-card-name">{home.name}</div>
        <div className="inv-home-card-meta">
          {home.item_count} item{home.item_count !== 1 ? 's' : ''} · {home.collaborator_count} collaborator{home.collaborator_count !== 1 ? 's' : ''}
        </div>
      </div>
      {isActive && <span className="inv-home-card-dot" />}
    </button>
  )
}

// ─── Add / Edit Home modal ───────────────────────────────────────────────────

function HomeModal({ existing, onSave, onClose }) {
  const [name,        setName]        = useState(existing?.name        || '')
  const [description, setDescription] = useState(existing?.description || '')
  const [qrStandard,  setQrStandard]  = useState(existing?.qr_standard || 'qr')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try { await onSave({ name: name.trim(), description, qr_standard: qrStandard }) }
    catch (err) { setError(err.message || 'Save failed'); setSaving(false) }
  }

  return (
    <div className="inv-modal-overlay" onClick={onClose}>
      <form className="inv-modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="inv-modal-header">
          <h2 className="inv-modal-title">{existing ? 'EDIT HOME' : 'NEW HOME'}</h2>
          <button type="button" className="inv-modal-close" onClick={onClose}>✕</button>
        </div>

        <label className="inv-form-label">Name *
          <input className="inv-input" value={name} onChange={e => setName(e.target.value)} required />
        </label>

        <label className="inv-form-label">Description
          <textarea className="inv-input inv-textarea" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </label>

        <label className="inv-form-label">Default QR / Label standard
          <select className="inv-select" value={qrStandard} onChange={e => setQrStandard(e.target.value)}>
            <option value="qr">QR Code</option>
            <option value="code128">Code-128 Barcode</option>
            <option value="ein">EIN Text Label Only</option>
          </select>
        </label>

        {error && <div className="inv-form-error">{error}</div>}
        <div className="inv-modal-actions">
          <button type="button" className="inv-btn inv-btn--ghost" onClick={onClose}>CANCEL</button>
          <button type="submit" className="inv-btn" disabled={saving}>{saving ? 'SAVING…' : 'SAVE'}</button>
        </div>
      </form>
    </div>
  )
}

// ─── Add / Edit Item modal ───────────────────────────────────────────────────

const EMPTY_ITEM = {
  name:'', category:'Other', description:'', quantity:1, location:'',
  manufacturer:'', model_number:'', serial_number:'',
  purchase_price:'', purchase_date:'', replacement_cost:'',
  warranty_expiry_date:'', is_insured:false, qr_standard:'',
}

function ItemModal({ existing, homeQrStandard, onSave, onClose }) {
  const [form,   setForm]   = useState(existing ? {
    name:               existing.name               || '',
    category:           existing.category           || 'Other',
    description:        existing.description        || '',
    quantity:           existing.quantity           ?? 1,
    location:           existing.location           || '',
    manufacturer:       existing.manufacturer       || '',
    model_number:       existing.model_number       || '',
    serial_number:      existing.serial_number      || '',
    purchase_price:     existing.purchase_price     ?? '',
    purchase_date:      existing.purchase_date      || '',
    replacement_cost:   existing.replacement_cost   ?? '',
    warranty_expiry_date: existing.warranty_expiry_date || '',
    is_insured:         existing.is_insured         ?? false,
    qr_standard:        existing.qr_standard        || '',
  } : { ...EMPTY_ITEM })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    const payload = { ...form }
    if (!payload.purchase_price)     delete payload.purchase_price
    if (!payload.purchase_date)      delete payload.purchase_date
    if (!payload.replacement_cost)   delete payload.replacement_cost
    if (!payload.warranty_expiry_date) delete payload.warranty_expiry_date
    if (!payload.qr_standard)        delete payload.qr_standard
    try { await onSave(payload) }
    catch (err) { setError(err.message || 'Save failed'); setSaving(false) }
  }

  return (
    <div className="inv-modal-overlay" onClick={onClose}>
      <form className="inv-modal inv-modal--wide" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="inv-modal-header">
          <h2 className="inv-modal-title">{existing ? 'EDIT ITEM' : 'NEW ITEM'}</h2>
          <button type="button" className="inv-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="inv-form-grid">
          {/* Left column */}
          <div className="inv-form-col">
            <div className="inv-form-section-title">IDENTIFICATION</div>
            <label className="inv-form-label">Name *
              <input className="inv-input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </label>
            <label className="inv-form-label">Category
              <select className="inv-select" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="inv-form-label">Description
              <textarea className="inv-input inv-textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
            </label>
            <div className="inv-form-row">
              <label className="inv-form-label">Quantity
                <input className="inv-input" type="number" min={1} value={form.quantity} onChange={e => set('quantity', parseInt(e.target.value)||1)} />
              </label>
              <label className="inv-form-label">Location / Room
                <input className="inv-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Living Room" />
              </label>
            </div>

            <div className="inv-form-section-title" style={{marginTop:14}}>MAKE / MODEL</div>
            <label className="inv-form-label">Manufacturer
              <input className="inv-input" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)} />
            </label>
            <div className="inv-form-row">
              <label className="inv-form-label">Model Number
                <input className="inv-input" value={form.model_number} onChange={e => set('model_number', e.target.value)} />
              </label>
              <label className="inv-form-label">Serial Number
                <input className="inv-input" value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
              </label>
            </div>
          </div>

          {/* Right column */}
          <div className="inv-form-col">
            <div className="inv-form-section-title">FINANCIAL</div>
            <div className="inv-form-row">
              <label className="inv-form-label">Purchase Price
                <input className="inv-input" type="number" step="0.01" min="0" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)} placeholder="0.00" />
              </label>
              <label className="inv-form-label">Purchase Date
                <input className="inv-input" type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
              </label>
            </div>
            <div className="inv-form-row">
              <label className="inv-form-label">Replacement Cost
                <input className="inv-input" type="number" step="0.01" min="0" value={form.replacement_cost} onChange={e => set('replacement_cost', e.target.value)} placeholder="0.00" />
              </label>
              <label className="inv-form-label">Warranty Expires
                <input className="inv-input" type="date" value={form.warranty_expiry_date} onChange={e => set('warranty_expiry_date', e.target.value)} />
              </label>
            </div>

            <label className="inv-form-label inv-form-label--inline" style={{marginTop:6}}>
              <input type="checkbox" checked={form.is_insured} onChange={e => set('is_insured', e.target.checked)} />
              <span>Item is insured</span>
            </label>

            <div className="inv-form-section-title" style={{marginTop:14}}>LABEL / QR</div>
            <label className="inv-form-label">QR / Label format
              <select className="inv-select" value={form.qr_standard} onChange={e => set('qr_standard', e.target.value)}>
                <option value="">Use home default ({homeQrStandard})</option>
                <option value="qr">QR Code</option>
                <option value="code128">Code-128 Barcode</option>
                <option value="ein">EIN Text Label Only</option>
              </select>
            </label>
          </div>
        </div>

        {error && <div className="inv-form-error">{error}</div>}
        <div className="inv-modal-actions">
          <button type="button" className="inv-btn inv-btn--ghost" onClick={onClose}>CANCEL</button>
          <button type="submit" className="inv-btn" disabled={saving}>{saving ? 'SAVING…' : 'SAVE ITEM'}</button>
        </div>
      </form>
    </div>
  )
}

// ─── Item detail panel ───────────────────────────────────────────────────────

function ItemDetail({ item, onEdit, onDelete, onClose }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const qrSrc = item.qr_code_data ? `data:image/png;base64,${item.qr_code_data}` : null

  return (
    <div className="inv-detail">
      <div className="inv-detail-header">
        <div>
          <div className="inv-detail-ein">{item.ein}</div>
          <h2 className="inv-detail-name">{item.name}</h2>
        </div>
        <div className="inv-detail-header-actions">
          <button className="inv-btn inv-btn--sm" onClick={onEdit}>EDIT</button>
          {!confirmDelete
            ? <button className="inv-btn inv-btn--danger inv-btn--sm" onClick={() => setConfirmDelete(true)}>DELETE</button>
            : <>
                <span className="inv-confirm-text">Sure?</span>
                <button className="inv-btn inv-btn--danger inv-btn--sm" onClick={onDelete}>YES, DELETE</button>
                <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => setConfirmDelete(false)}>NO</button>
              </>
          }
          <button className="inv-modal-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="inv-detail-body">
        <div className="inv-detail-col">
          <div className="inv-detail-section">IDENTIFICATION</div>
          <Field label="Category"     value={item.category} />
          <Field label="Location"     value={item.location} />
          <Field label="Quantity"     value={item.quantity} />
          <Field label="Description"  value={item.description} />
          <Badge status={item.asset_status} />
          {item.current_custodian && (
            <div className="inv-field">
              <span className="inv-field-label">Issued To</span>
              <span className="inv-field-value">{item.current_custodian.email}</span>
            </div>
          )}

          <div className="inv-detail-section" style={{marginTop:14}}>MAKE / MODEL</div>
          <Field label="Manufacturer"  value={item.manufacturer} />
          <Field label="Model No."     value={item.model_number} />
          <Field label="Serial No."    value={item.serial_number} />
        </div>

        <div className="inv-detail-col">
          <div className="inv-detail-section">FINANCIAL</div>
          <Field label="Purchase Price"    value={fmtMoney(item.purchase_price)} />
          <Field label="Purchase Date"     value={fmtDate(item.purchase_date)} />
          <Field label="Replacement Cost"  value={fmtMoney(item.replacement_cost)} />
          <Field label="Warranty Expires"  value={fmtDate(item.warranty_expiry_date)} />
          <Field label="Insured"           value={item.is_insured ? 'Yes' : null} />

          <div className="inv-detail-section" style={{marginTop:14}}>LABEL</div>
          <Field label="EIN" value={item.ein} />
          <Field label="QR Standard" value={item.qr_standard} />

          {qrSrc && (
            <div className="inv-qr-block">
              <img src={qrSrc} alt="QR code" className="inv-qr-img" />
              <a
                className="inv-btn inv-btn--ghost inv-btn--sm"
                href={qrSrc}
                download={`${item.ein}.png`}
              >
                ⬇ DOWNLOAD LABEL
              </a>
            </div>
          )}
          {!qrSrc && item.qr_standard === 'ein' && (
            <div className="inv-qr-ein-label">{item.ein}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── EIN scan bar ────────────────────────────────────────────────────────────

function ScanBar({ onResult }) {
  const [ein,      setEin]      = useState('')
  const [scanning, setScanning] = useState(false)
  const [error,    setError]    = useState('')
  const { token } = useAuth()

  const scan = async (e) => {
    e.preventDefault()
    if (!ein.trim()) return
    setScanning(true); setError('')
    try {
      const res = await fetch(`/api/inventory/scan/${encodeURIComponent(ein.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Not found') }
      const item = await res.json()
      onResult(item)
      setEin('')
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  return (
    <form className="inv-scan-bar" onSubmit={scan}>
      <input
        className="inv-input inv-scan-input"
        placeholder="Scan or type EIN…"
        value={ein}
        onChange={e => setEin(e.target.value)}
      />
      <button className="inv-btn" type="submit" disabled={scanning}>
        {scanning ? '…' : <IconScan />}
      </button>
      {error && <span className="inv-scan-error">{error}</span>}
    </form>
  )
}

// ─── Collaborators / Settings panel (coming soon) ───────────────────────────

function CollaboratorsPanel({ home }) {
  const PLANNED_FEATURES = [
    {
      icon: IconMail,
      title: 'EMAIL INVITES',
      desc: "Send a collaborator invite by email. They'll receive a link to join and access this home's inventory.",
    },
    {
      icon: IconEye,
      title: 'VIEWER ROLE',
      desc: 'Viewers can browse items and scan EINs but cannot add, edit, or delete anything.',
    },
    {
      icon: IconEdit,
      title: 'EDITOR ROLE',
      desc: 'Editors can add and update items, upload receipts, and process custody transfers.',
    },
    {
      icon: IconLock,
      title: 'OWNER CONTROLS',
      desc: 'Only the home owner can issue items, generate manifests, invite collaborators, and delete the home.',
    },
  ]

  return (
    <div className="inv-settings-panel">
      <div className="inv-settings-header">
        <div>
          <div className="inv-settings-title">COLLABORATORS & ACCESS</div>
          <div className="inv-settings-sub">Manage who can view and edit <strong>{home?.name || 'this home'}</strong></div>
        </div>
        <span className="coming-soon-tag">COMING SOON</span>
      </div>

      <div className="inv-settings-banner">
        <span className="inv-settings-banner-text">
          Collaborator management and email invites are under development. Once live, you'll be able to invite people by email and assign them viewer or editor access to any of your homes.
        </span>
      </div>

      <div className="feature-card-grid" style={{ marginTop: 20 }}>
        {PLANNED_FEATURES.map(f => (
          <div key={f.title} className="feature-card feature-card--locked">
            <div className="feature-card-header">
              <div className="feature-card-icon"><f.icon /></div>
              <div className="feature-card-title">{f.title}</div>
              <div className="feature-card-badge">SOON</div>
            </div>
            <p className="feature-card-desc">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PAGE_TABS = ['ITEMS', 'SETTINGS']

export default function InventoryPage() {
  const { token } = useAuth()

  const [homes,      setHomes]      = useState([])
  const [activeHome, setActiveHome] = useState(null)
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')

  const [showHomeModal, setShowHomeModal] = useState(false)
  const [editingHome,   setEditingHome]   = useState(null)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem,   setEditingItem]   = useState(null)
  const [detailItem,    setDetailItem]    = useState(null)

  const [filterStatus,   setFilterStatus]   = useState('ALL')
  const [filterCategory, setFilterCategory] = useState('ALL')
  const [activeTab,      setActiveTab]      = useState('ITEMS')

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token])

  // ── Homes ──────────────────────────────────────────────────────────────────

  const fetchHomes = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/homes', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setHomes(data)
        if (!activeHome && data.length > 0) setActiveHome(data[0])
      }
    } catch {}
  }, [authHeaders, activeHome])

  useEffect(() => { fetchHomes() }, [fetchHomes])

  const saveHome = async (body) => {
    const method = editingHome ? 'PATCH' : 'POST'
    const url    = editingHome
      ? `/api/inventory/homes/${editingHome.id}`
      : '/api/inventory/homes'
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
    const home = await res.json()
    setHomes(prev => editingHome
      ? prev.map(h => h.id === home.id ? home : h)
      : [...prev, home]
    )
    if (!editingHome) setActiveHome(home)
    setShowHomeModal(false); setEditingHome(null)
    fetchHomes()
  }

  const deleteHome = async (homeId) => {
    await fetch(`/api/inventory/homes/${homeId}`, { method: 'DELETE', headers: authHeaders() })
    setHomes(prev => prev.filter(h => h.id !== homeId))
    if (activeHome?.id === homeId) { setActiveHome(null); setItems([]) }
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  const fetchItems = useCallback(async (homeId) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inventory/homes/${homeId}/items`, { headers: authHeaders() })
      if (res.ok) setItems(await res.json())
    } catch {}
    finally { setLoading(false) }
  }, [authHeaders])

  useEffect(() => {
    if (activeHome) fetchItems(activeHome.id)
    else setItems([])
  }, [activeHome, fetchItems])

  const saveItem = async (body) => {
    const method = editingItem ? 'PATCH' : 'POST'
    const url    = editingItem
      ? `/api/inventory/items/${editingItem.id}`
      : `/api/inventory/homes/${activeHome.id}/items`
    const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
    const item = await res.json()
    setItems(prev => editingItem
      ? prev.map(i => i.id === item.id ? item : i)
      : [...prev, item]
    )
    if (detailItem?.id === item.id) setDetailItem(item)
    setShowItemModal(false); setEditingItem(null)
    fetchHomes()
  }

  const deleteItem = async (itemId) => {
    await fetch(`/api/inventory/items/${itemId}`, { method: 'DELETE', headers: authHeaders() })
    setItems(prev => prev.filter(i => i.id !== itemId))
    setDetailItem(null)
    fetchHomes()
  }

  // ── Manifest download ──────────────────────────────────────────────────────

  const downloadManifest = async () => {
    const res = await fetch(`/api/inventory/homes/${activeHome.id}/manifest`, { headers: authHeaders() })
    if (!res.ok) { alert('PDF generation failed. Make sure reportlab is installed.'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `inventory_manifest_${activeHome.name.replace(/\s+/g,'_')}.pdf`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filteredItems = items.filter(item => {
    const q = search.toLowerCase()
    if (q && !item.name.toLowerCase().includes(q)
          && !(item.serial_number||'').toLowerCase().includes(q)
          && !(item.model_number||'').toLowerCase().includes(q)
          && !(item.manufacturer||'').toLowerCase().includes(q)
          && !(item.ein||'').toLowerCase().includes(q)
          && !(item.location||'').toLowerCase().includes(q)) return false
    if (filterStatus   !== 'ALL' && item.asset_status !== filterStatus)   return false
    if (filterCategory !== 'ALL' && item.category     !== filterCategory) return false
    return true
  })

  const totalReplacement = items.reduce((sum, i) => sum + (parseFloat(i.replacement_cost)||0) * i.quantity, 0)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrap inv-page">

      {/* Header */}
      <div className="page-breadcrumb">
        <span>◢</span><span>HOME</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>INVENTORY</span>
      </div>
      <div className="inv-page-header">
        <h1 className="page-title" style={{margin:0}}>Inventory</h1>
        <ScanBar onResult={item => { setDetailItem(item); setActiveHome(homes.find(h => h.id === item.home_id) || activeHome) }} />
      </div>

      {/* Homes row */}
      <div className="inv-homes-row">
        <div className="inv-homes-list">
          {homes.map(h => (
            <HomeCard
              key={h.id}
              home={h}
              isActive={activeHome?.id === h.id}
              onClick={() => setActiveHome(h)}
            />
          ))}
          <button className="inv-add-home-btn" onClick={() => { setEditingHome(null); setShowHomeModal(true) }}>
            <span>+</span> NEW HOME
          </button>
        </div>

        {activeHome && (
          <div className="inv-home-actions">
            <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => { setEditingHome(activeHome); setShowHomeModal(true) }}>
              EDIT HOME
            </button>
            <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={downloadManifest}>
              ⬇ INSURANCE PDF
            </button>
            <button className="inv-btn inv-btn--danger-ghost inv-btn--sm" onClick={() => { if (window.confirm(`Delete home "${activeHome.name}" and all its items?`)) deleteHome(activeHome.id) }}>
              DELETE HOME
            </button>
          </div>
        )}
      </div>

      {/* No homes */}
      {homes.length === 0 && (
        <div className="inv-empty-state">
          <IconHome />
          <p>No homes yet. Create one to start tracking your inventory.</p>
        </div>
      )}

      {/* Tab bar */}
      {activeHome && (
        <div className="inv-tab-bar">
          {PAGE_TABS.map(t => (
            <button
              key={t}
              className={`inv-tab ${activeTab === t ? 'inv-tab--active' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Items panel */}
      {activeHome && activeTab === 'ITEMS' && (
        <>
          {/* Toolbar */}
          <div className="inv-items-toolbar">
            <div className="inv-items-toolbar-left">
              <input
                className="inv-input inv-search"
                placeholder="Search items, serial, EIN…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <select className="inv-select inv-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="ALL">All statuses</option>
                <option>Serviceable</option>
                <option>Unserviceable</option>
                <option>Missing</option>
                <option>In-Use</option>
              </select>
              <select className="inv-select inv-filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="ALL">All categories</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="inv-items-toolbar-right">
              <span className="inv-total-cost">
                Replacement value: <strong>{`$${totalReplacement.toFixed(2)}`}</strong>
              </span>
              <button className="inv-btn" onClick={() => { setEditingItem(null); setShowItemModal(true) }}>
                + ADD ITEM
              </button>
            </div>
          </div>

          {/* Item table */}
          {loading ? (
            <div className="inv-loading">LOADING ITEMS…</div>
          ) : filteredItems.length === 0 ? (
            <div className="inv-empty-state inv-empty-state--sm">
              {search || filterStatus !== 'ALL' || filterCategory !== 'ALL'
                ? 'No items match your filters.'
                : 'No items in this home yet. Click + ADD ITEM to get started.'}
            </div>
          ) : (
            <div className="inv-table-wrap card">
              <div className="inv-table-header">
                <span className="inv-col-name">NAME</span>
                <span className="inv-col-cat">CATEGORY</span>
                <span className="inv-col-loc">LOCATION</span>
                <span className="inv-col-sn">SERIAL / MODEL</span>
                <span className="inv-col-price">REPL. COST</span>
                <span className="inv-col-status">STATUS</span>
                <span className="inv-col-ein">EIN</span>
              </div>
              <div className="inv-table-body">
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    className={`inv-table-row ${detailItem?.id === item.id ? 'inv-table-row--active' : ''}`}
                    onClick={() => setDetailItem(detailItem?.id === item.id ? null : item)}
                  >
                    <span className="inv-col-name">
                      <span className="inv-item-name">{item.name}</span>
                      {item.manufacturer && <span className="inv-item-mfr">{item.manufacturer}</span>}
                    </span>
                    <span className="inv-col-cat">{item.category || '—'}</span>
                    <span className="inv-col-loc">{item.location || '—'}</span>
                    <span className="inv-col-sn">
                      {item.serial_number || item.model_number
                        ? <>{item.serial_number && <span>S/N {item.serial_number}</span>}{item.model_number && <span className="inv-item-model">{item.model_number}</span>}</>
                        : '—'}
                    </span>
                    <span className="inv-col-price">{fmtMoney(item.replacement_cost)}</span>
                    <span className="inv-col-status"><Badge status={item.asset_status} /></span>
                    <span className="inv-col-ein inv-ein-pill">{item.ein}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detail panel */}
          {detailItem && (
            <ItemDetail
              item={detailItem}
              onEdit={() => { setEditingItem(detailItem); setShowItemModal(true) }}
              onDelete={() => deleteItem(detailItem.id)}
              onClose={() => setDetailItem(null)}
            />
          )}
        </>
      )}

      {/* Settings / Collaborators tab */}
      {activeHome && activeTab === 'SETTINGS' && (
        <CollaboratorsPanel home={activeHome} />
      )}

      {/* Modals */}
      {showHomeModal && (
        <HomeModal
          existing={editingHome}
          onSave={saveHome}
          onClose={() => { setShowHomeModal(false); setEditingHome(null) }}
        />
      )}
      {showItemModal && activeHome && (
        <ItemModal
          existing={editingItem}
          homeQrStandard={activeHome.default_qr_standard || activeHome.qr_standard || 'qr'}
          onSave={saveItem}
          onClose={() => { setShowItemModal(false); setEditingItem(null) }}
        />
      )}
    </div>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <polyline points="1,9 9,2 17,9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <polyline points="3,8 3,16 7,16 7,11 11,11 11,16 15,16 15,8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <polyline points="1,4 8,9 15,4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}
function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}
function IconEdit() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}
function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconScan() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 5V2h3M12 1h3v3M1 11v3h3M12 15h3v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
