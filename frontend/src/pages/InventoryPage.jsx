import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/BarcodeScanner'
import './InventoryPage.css'

function safeFetch(path, opts = {}) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error(`Blocked absolute URL: ${path}`)
  }
  return fetch(path, opts)
}

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
  const [analyzing, setAnalyzing] = useState(false)

  const { token } = useAuth()

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleAnalyzePhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/vision/inventory-item', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      })
      if (!res.ok) throw new Error(res.status === 503 ? 'Vision model not enabled.' : 'Analysis failed.')
      const data = await res.json()

      if (data.name) set('name', data.name)
      if (data.category && CATEGORIES.includes(data.category)) set('category', data.category)
      if (data.description) set('description', data.description)
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

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
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="inv-input" style={{ flex: 1 }} value={form.name} onChange={e => set('name', e.target.value)} required />
                <label className="inv-btn inv-btn--ghost inv-btn--sm" style={{ flexShrink: 0, cursor: analyzing ? 'default' : 'pointer', height: 38, opacity: analyzing ? 0.7 : 1 }}>
                  {analyzing ? '…' : <IconScan />} {analyzing ? 'Analyzing...' : 'Analyze Photo'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAnalyzePhoto} disabled={analyzing} />
                </label>
              </div>
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

function ItemDetail({ item, onEdit, onDelete, onClose, token }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [attachments,   setAttachments]   = useState([])
  const [uploading,     setUploading]     = useState(false)
  const fileInputRef = React.useRef()
  const qrSrc = item.qr_code_data ? `data:image/png;base64,${item.qr_code_data}` : null

  const authH = () => ({ Authorization: `Bearer ${token}` })

  const fetchAttachments = useCallback(async () => {
    try {
      const res = await safeFetch(`/api/inventory/items/${item.id}/attachments`, { headers: authH() })
      if (res.ok) setAttachments(await res.json())
    } catch {}
  }, [item.id, token])

  useEffect(() => { fetchAttachments() }, [fetchAttachments])

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const fd = new FormData(); fd.append('file', file)
      await safeFetch(`/api/inventory/items/${item.id}/attachments`, {
        method: 'POST', headers: authH(), body: fd,
      })
    }
    setUploading(false)
    fetchAttachments()
    e.target.value = ''
  }

  const handleDeleteAttachment = async (attachmentId) => {
    await safeFetch(`/api/inventory/attachments/${attachmentId}`, { method: 'DELETE', headers: authH() })
    setAttachments(prev => prev.filter(a => a.id !== attachmentId))
  }

  const fmtSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

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

      {/* Attachments */}
      <div className="inv-attachments">
        <div className="inv-detail-section" style={{marginTop:14}}>ATTACHMENTS</div>
        <div className="inv-attachments-list">
          {attachments.length === 0 && <span className="inv-attachments-empty">No files attached.</span>}
          {attachments.map(a => (
            <div key={a.id} className="inv-attachment-row">
              <span className="inv-attachment-name" title={a.original_filename}>{a.original_filename}</span>
              <span className="inv-attachment-size">{fmtSize(a.file_size)}</span>
              <a
                className="inv-btn inv-btn--ghost inv-btn--sm"
                href={`/api/inventory/attachments/${a.id}/download`}
                target="_blank" rel="noreferrer"
              >⬇</a>
              <button
                className="inv-btn inv-btn--danger inv-btn--sm"
                onClick={() => handleDeleteAttachment(a.id)}
              >✕</button>
            </div>
          ))}
        </div>
        <label className="inv-btn inv-btn--ghost inv-btn--sm" style={{cursor:'pointer', marginTop:8}}>
          {uploading ? 'UPLOADING…' : '+ ADD FILES'}
          <input ref={fileInputRef} type="file" multiple style={{display:'none'}} onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
    </div>
  )
}

// ─── EIN scan bar ────────────────────────────────────────────────────────────

function ScanBar({ onResult }) {
  const [ein,        setEin]      = useState('')
  const [scanning,   setScanning] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [error,      setError]    = useState('')
  const { token } = useAuth()

  const scan = async (e) => {
    if (e) e.preventDefault()
    if (!ein.trim()) return
    setScanning(true); setError('')
    try {
      const res = await safeFetch(`/api/inventory/scan/${encodeURIComponent(ein.trim())}`, {
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

  // Effect to auto-trigger scan when ein is populated from camera
  useEffect(() => {
    if (ein.trim() && !scanning) {
      scan()
    }
  }, [ein]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {showCamera && (
        <BarcodeScanner
          onDetected={(val) => {
            setEin(val)
            setShowCamera(false)
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
      <form className="inv-scan-bar" onSubmit={scan}>
        <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
          <input
            className="inv-input inv-scan-input"
            placeholder="Scan or type EIN…"
            value={ein}
            onChange={e => setEin(e.target.value)}
            style={{ paddingRight: 44 }}
          />
          <button
            type="button"
            className="inv-btn-cam"
            onClick={() => setShowCamera(true)}
            title="Scan with camera"
            style={{
              position: 'absolute',
              right: 2,
              top: 2,
              bottom: 2,
              width: 40,
              background: 'transparent',
              border: 'none',
              color: 'var(--md-outline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>photo_camera</span>
          </button>
        </div>
        <button className="inv-btn" type="submit" disabled={scanning}>
          {scanning ? '…' : <IconScan />}
        </button>
        {error && <span className="inv-scan-error">{error}</span>}
      </form>
    </>
  )
}

// ─── Manual walk-through mode ────────────────────────────────────────────────

function ManualWalkthrough({ audit, token, onUpdate }) {
  const authH = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])
  const outstanding = audit.missing || []
  const [idx, setIdx] = useState(0)
  const [msg, setMsg] = useState(null)

  if (outstanding.length === 0) return (
    <div className="audit-walk-done">All items accounted for!</div>
  )

  const current = outstanding[idx]

  const confirm = async () => {
    const res = await safeFetch(`/api/inventory/audits/${audit.id}/scan`, {
      method: 'POST', headers: authH(), body: JSON.stringify({ ein: current.ein }),
    })
    const data = await res.json()
    if (!res.ok) { setMsg({ text: data.detail || 'Error', ok: false }); return }
    setMsg({ text: `✓ ${current.name} confirmed`, ok: true })
    onUpdate(data)
    setTimeout(() => { setMsg(null); setIdx(i => Math.min(i, (data.missing?.length || 1) - 1)) }, 800)
  }

  const skip = () => {
    setIdx(i => (i + 1) % outstanding.length)
    setMsg(null)
  }

  return (
    <div className="audit-walk-wrap">
      <div className="audit-walk-counter">{idx + 1} of {outstanding.length} outstanding</div>
      <div className="audit-walk-card">
        <div className="audit-walk-ein">{current.ein}</div>
        <div className="audit-walk-name">{current.name}</div>
        {current.location && <div className="audit-walk-loc">📍 {current.location}</div>}
      </div>
      {msg && <div className={`audit-scan-msg ${msg.ok ? 'audit-scan-msg--ok' : 'audit-scan-msg--err'}`}>{msg.text}</div>}
      <div className="audit-walk-actions">
        <button className="inv-btn" onClick={confirm}>✓ FOUND IT</button>
        <button className="inv-btn inv-btn--ghost" onClick={skip}>SKIP →</button>
      </div>
    </div>
  )
}

// ─── Audit tab ───────────────────────────────────────────────────────────────

function AuditTab({ home, token, items }) {
  const [audit,      setAudit]      = useState(null)   // active audit state
  const [loading,    setLoading]    = useState(true)
  const [scanInput,  setScanInput]  = useState('')
  const [scanMsg,    setScanMsg]    = useState(null)   // { text, ok }
  const [showResume, setShowResume] = useState(false)  // resume popup
  const [showComplete, setShowComplete] = useState(false)
  const [notes,      setNotes]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const [walkMode,   setWalkMode]   = useState(false)  // manual walk-through
  const scanRef = useRef()

  const authH = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token])

  // Load active audit on mount / home change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/inventory/homes/${home.id}/audit/active`, { headers: authH() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        if (data) { setAudit(data); setShowResume(true) }
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [home.id])

  const startAudit = async (walk = false) => {
    const res = await safeFetch(`/api/inventory/homes/${home.id}/audit/start`, { method: 'POST', headers: authH() })
    const data = await res.json()
    if (!res.ok) { alert(data.detail || 'Failed to start audit'); return }
    setAudit(data)
    setShowResume(false)
    if (walk) {
      setWalkMode(true)
    } else {
      setTimeout(() => scanRef.current?.focus(), 100)
    }
  }

  const handleScan = async (e) => {
    e.preventDefault()
    const ein = scanInput.trim()
    if (!ein || !audit) return
    setScanInput('')
    const res  = await safeFetch(`/api/inventory/audits/${audit.id}/scan`, {
      method: 'POST', headers: authH(), body: JSON.stringify({ ein }),
    })
    const data = await res.json()
    if (!res.ok) {
      setScanMsg({ text: data.detail || 'EIN not found in this home', ok: false })
    } else {
      const justScanned = data.scanned?.find(s => s.ein === ein)
      setScanMsg({ text: justScanned ? `✓ ${justScanned.name}` : '✓ Scanned', ok: true })
      setAudit(data)
    }
    setTimeout(() => setScanMsg(null), 2500)
    scanRef.current?.focus()
  }

  const handleComplete = async () => {
    setSaving(true)
    const res  = await safeFetch(`/api/inventory/audits/${audit.id}/complete`, {
      method: 'POST', headers: authH(), body: JSON.stringify({ notes }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { alert(data.detail || 'Failed to complete audit'); return }
    setAudit(null)
    setShowComplete(false)
    setNotes('')
  }

  const pct = audit ? Math.round((audit.scanned_count / Math.max(audit.total_items, 1)) * 100) : 0

  if (loading) return <div className="inv-loading">LOADING AUDIT STATUS…</div>

  // ── Resume popup ──
  if (showResume && audit) return (
    <div className="audit-resume-overlay">
      <div className="audit-resume-card">
        <div className="audit-resume-title">INSPECTION IN PROGRESS</div>
        <div className="audit-resume-sub">
          {audit.scanned_count} of {audit.total_items} items scanned ({pct}%)
        </div>
        <div className="audit-resume-actions">
          <button className="inv-btn" onClick={() => { setShowResume(false); setTimeout(() => scanRef.current?.focus(), 100) }}>
            CONTINUE INSPECTION
          </button>
          <button className="inv-btn inv-btn--ghost" onClick={() => { setShowResume(false); setAudit(null) }}>
            DISMISS
          </button>
        </div>
      </div>
    </div>
  )

  // ── No active audit ──
  if (!audit) return (
    <div className="audit-start-wrap">
      <div className="audit-start-card">
        <div className="audit-start-icon"><IconScan /></div>
        <div className="audit-start-title">PHYSICAL INSPECTION</div>
        <div className="audit-start-sub">
          Scan every item in <strong>{home.name}</strong> to verify what's present.
          The system tracks what's been scanned and what's still outstanding.
        </div>
        <div className="audit-start-actions">
          <button className="inv-btn" onClick={() => startAudit(false)}>SCAN BY EIN</button>
          <button className="inv-btn inv-btn--ghost" onClick={() => startAudit(true)}>MANUAL WALK-THROUGH</button>
        </div>
      </div>
    </div>
  )

  // ── Active audit ──
  return (
    <div className="audit-wrap">

      {/* Progress bar */}
      <div className="audit-progress-row">
        <div className="audit-progress-bar-wrap">
          <div className="audit-progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <span className="audit-progress-label">{audit.scanned_count} / {audit.total_items} — {pct}%</span>
        <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => setWalkMode(w => !w)}>
          {walkMode ? 'SCAN MODE' : 'WALK-THROUGH'}
        </button>
        <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => setShowComplete(true)}>SAVE &amp; COMPLETE</button>
      </div>

      {/* Walk-through or scan mode */}
      {walkMode ? (
        <ManualWalkthrough audit={audit} token={token} onUpdate={setAudit} />
      ) : (
        <>
          <form className="audit-scan-form" onSubmit={handleScan}>
            <div className="audit-scan-box">
              <IconScan />
              <input
                ref={scanRef}
                className="inv-input audit-scan-input"
                placeholder="Scan EIN or type and press Enter…"
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                autoFocus
              />
            </div>
            {scanMsg && (
              <div className={`audit-scan-msg ${scanMsg.ok ? 'audit-scan-msg--ok' : 'audit-scan-msg--err'}`}>
                {scanMsg.text}
              </div>
            )}
          </form>

          <div className="audit-lists">
            <div className="audit-list-col">
              <div className="audit-list-header audit-list-header--scanned">
                SCANNED <span className="audit-list-count">{audit.scanned_count}</span>
              </div>
              <div className="audit-list-body">
                {audit.scanned?.length === 0 && <div className="audit-list-empty">Nothing scanned yet.</div>}
                {[...(audit.scanned || [])].reverse().map(i => (
                  <div key={i.id} className="audit-list-row audit-list-row--scanned">
                    <span className="audit-list-ein">{i.ein}</span>
                    <span className="audit-list-name">{i.name}</span>
                    {i.location && <span className="audit-list-loc">{i.location}</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="audit-list-col">
              <div className="audit-list-header audit-list-header--missing">
                OUTSTANDING <span className="audit-list-count">{audit.missing?.length ?? 0}</span>
              </div>
              <div className="audit-list-body">
                {audit.missing?.length === 0 && <div className="audit-list-empty">All items accounted for!</div>}
                {(audit.missing || []).map(i => (
                  <div key={i.id} className="audit-list-row audit-list-row--missing">
                    <span className="audit-list-ein">{i.ein}</span>
                    <span className="audit-list-name">{i.name}</span>
                    {i.location && <span className="audit-list-loc">{i.location}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Complete modal */}
      {showComplete && (
        <div className="inv-modal-overlay" onClick={() => setShowComplete(false)}>
          <div className="inv-modal" onClick={e => e.stopPropagation()}>
            <div className="inv-modal-header">
              <h2 className="inv-modal-title">COMPLETE INSPECTION</h2>
              <button className="inv-modal-close" onClick={() => setShowComplete(false)}>✕</button>
            </div>
            <div className="audit-complete-summary">
              <div className="audit-complete-stat">
                <span className="audit-complete-num">{pct}%</span>
                <span className="audit-complete-lbl">SCANNED</span>
              </div>
              <div className="audit-complete-stat">
                <span className="audit-complete-num" style={{color:'var(--secondary)'}}>{audit.scanned_count}</span>
                <span className="audit-complete-lbl">FOUND</span>
              </div>
              <div className="audit-complete-stat">
                <span className="audit-complete-num" style={{color: audit.missing?.length ? 'var(--warn)' : 'var(--secondary)'}}>
                  {audit.missing?.length ?? 0}
                </span>
                <span className="audit-complete-lbl">MISSING</span>
              </div>
            </div>
            {audit.missing?.length > 0 && (
              <div className="audit-complete-missing-list">
                <div className="inv-form-section-title">MISSING ITEMS</div>
                {audit.missing.map(i => (
                  <div key={i.id} className="audit-list-row audit-list-row--missing">
                    <span className="audit-list-ein">{i.ein}</span>
                    <span className="audit-list-name">{i.name}</span>
                  </div>
                ))}
              </div>
            )}
            <label className="inv-form-label">Notes (optional, 500 chars max)
              <textarea
                className="inv-input inv-textarea"
                rows={3}
                maxLength={500}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Pre-move scan — master bedroom complete"
              />
              <span style={{fontSize:'0.65rem',color:'var(--text-dim)',textAlign:'right'}}>{notes.length}/500</span>
            </label>
            <div className="inv-modal-actions">
              <button className="inv-btn inv-btn--ghost" onClick={() => setShowComplete(false)}>CANCEL</button>
              <button className="inv-btn" onClick={handleComplete} disabled={saving}>
                {saving ? 'SAVING…' : 'SAVE & COMPLETE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({ home, token, userTimezone }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  const authH = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/inventory/homes/${home.id}/audit/history`, { headers: authH() })
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) { setHistory(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [home.id])

  const fmtTs = (iso, tz) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('en-US', {
        timeZone: tz || userTimezone || 'UTC',
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    } catch { return iso }
  }

  if (loading) return <div className="inv-loading">LOADING HISTORY…</div>

  if (history.length === 0) return (
    <div className="inv-empty-state inv-empty-state--sm">
      No completed inspections yet for {home.name}.
    </div>
  )

  return (
    <div className="audit-history">
      {history.map(a => {
        const pct  = Math.round((a.scanned_count / Math.max(a.total_items, 1)) * 100)
        const open = expanded === a.id
        return (
          <div key={a.id} className={`audit-hist-card ${open ? 'audit-hist-card--open' : ''}`}>
            <button className="audit-hist-header" onClick={() => setExpanded(open ? null : a.id)}>
              <div className="audit-hist-header-left">
                <span className="audit-hist-date">{fmtTs(a.completed_at, a.user_timezone)}</span>
                <span className="audit-hist-tz">{a.user_timezone}</span>
              </div>
              <div className="audit-hist-header-right">
                <span className="audit-hist-pct" style={{color: pct === 100 ? 'var(--secondary)' : 'var(--warn)'}}>
                  {pct}%
                </span>
                <span className="audit-hist-counts">
                  {a.scanned_count}/{a.total_items} found · {a.missing?.length ?? 0} missing
                </span>
                <span className="audit-hist-chevron">{open ? '▲' : '▼'}</span>
              </div>
            </button>

            {open && (
              <div className="audit-hist-body">
                {a.notes && (
                  <div className="audit-hist-notes">
                    <span className="audit-hist-notes-label">NOTES</span>
                    <span className="audit-hist-notes-text">{a.notes}</span>
                  </div>
                )}
                <div className="audit-lists audit-lists--compact">
                  <div className="audit-list-col">
                    <div className="audit-list-header audit-list-header--scanned">FOUND <span className="audit-list-count">{a.scanned_count}</span></div>
                    <div className="audit-list-body">
                      {a.scanned?.map(i => (
                        <div key={i.id} className="audit-list-row audit-list-row--scanned">
                          <span className="audit-list-ein">{i.ein}</span>
                          <span className="audit-list-name">{i.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="audit-list-col">
                    <div className="audit-list-header audit-list-header--missing">MISSING <span className="audit-list-count">{a.missing?.length ?? 0}</span></div>
                    <div className="audit-list-body">
                      {a.missing?.length === 0 && <div className="audit-list-empty">All accounted for.</div>}
                      {a.missing?.map(i => (
                        <div key={i.id} className="audit-list-row audit-list-row--missing">
                          <span className="audit-list-ein">{i.ein}</span>
                          <span className="audit-list-name">{i.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
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

// ─── Print Tab ───────────────────────────────────────────────────────────────

const LABEL_PRESETS = [
  { key: '12mm', label: '12mm Tape', w: 55, h: 12, tier: 0 },
  { key: '18mm', label: '18mm Tape', w: 65, h: 18, tier: 1 },
  { key: '24mm', label: '24mm Tape', w: 75, h: 24, tier: 2 },
  { key: '36mm', label: '36mm Tape', w: 90, h: 36, tier: 3 },
  { key: 'full', label: 'Full Page', w: null, h: null, tier: 4 },
]

function LabelCard({ item, preset, showQR, showSerial, showMfr, showLoc }) {
  const raw = item.qr_code_data || ''
  const qrSrc = raw
    ? (raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`)
    : null

  if (preset.tier === 4) {
    return (
      <div className="inv-label inv-label--full">
        <div className="inv-label-full-body">
          <div className="inv-label-full-ein">{item.ein}</div>
          <div className="inv-label-full-name">{item.name}</div>
          {showMfr && (item.manufacturer || item.model_number) && (
            <div className="inv-label-full-field">
              {[item.manufacturer, item.model_number].filter(Boolean).join(' · ')}
            </div>
          )}
          {showSerial && item.serial_number && (
            <div className="inv-label-full-field">S/N: {item.serial_number}</div>
          )}
          {showLoc && item.location && (
            <div className="inv-label-full-field">{item.location}</div>
          )}
        </div>
        {showQR && qrSrc && <img src={qrSrc} alt="label" className="inv-label-full-qr" />}
      </div>
    )
  }

  const tapeStyle = { width: `${preset.w}mm`, height: `${preset.h}mm` }
  const qrSize   = `${preset.h - 2}mm`

  return (
    <div className={`inv-label inv-label--tape inv-label--${preset.key}`} style={tapeStyle}>
      {showQR && preset.tier >= 2 && qrSrc && (
        <img src={qrSrc} alt="label" className="inv-label-tape-qr" style={{ height: qrSize, width: qrSize }} />
      )}
      <div className="inv-label-tape-text">
        <div className={`inv-label-tape-ein${preset.tier === 0 ? ' inv-label-tape-ein--solo' : ''}`}>{item.ein}</div>
        {preset.tier >= 1 && <div className="inv-label-tape-name">{item.name}</div>}
        {preset.tier >= 2 && showSerial && item.serial_number && (
          <div className="inv-label-tape-sub">S/N: {item.serial_number}</div>
        )}
        {preset.tier >= 2 && showMfr && item.manufacturer && (
          <div className="inv-label-tape-sub">{item.manufacturer}</div>
        )}
        {preset.tier >= 2 && showLoc && item.location && (
          <div className="inv-label-tape-sub">{item.location}</div>
        )}
      </div>
    </div>
  )
}

function PrintTab({ items }) {
  const [selected,   setSelected]   = useState(() => new Set(items.map(i => i.id)))
  const [presetKey,  setPresetKey]  = useState('24mm')
  const [copies,     setCopies]     = useState(1)
  const [showQR,     setShowQR]     = useState(true)
  const [showSerial, setShowSerial] = useState(true)
  const [showMfr,    setShowMfr]    = useState(true)
  const [showLoc,    setShowLoc]    = useState(false)

  const preset        = LABEL_PRESETS.find(p => p.key === presetKey) || LABEL_PRESETS[2]
  const selectedItems = items.filter(i => selected.has(i.id))
  const totalLabels   = selectedItems.length * copies

  const toggleItem = (id) => setSelected(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const handlePrint = () => {
    const old = document.getElementById('inv-dyn-print-style')
    if (old) old.remove()
    const s = document.createElement('style')
    s.id = 'inv-dyn-print-style'
    s.textContent = preset.tier < 4
      ? `@page { size: ${preset.w}mm ${preset.h}mm; margin: 0.5mm; }`
      : `@page { size: letter; margin: 0.4in; }`
    document.head.appendChild(s)
    window.print()
    setTimeout(() => document.getElementById('inv-dyn-print-style')?.remove(), 2000)
  }

  const fieldRows = [
    { label: 'QR / Barcode',    val: showQR,     set: setShowQR,     enabled: preset.tier >= 2 },
    { label: 'Serial Number',   val: showSerial, set: setShowSerial, enabled: preset.tier >= 2 },
    { label: 'Manufacturer',    val: showMfr,    set: setShowMfr,    enabled: preset.tier >= 2 },
    { label: 'Location / Room', val: showLoc,    set: setShowLoc,    enabled: preset.tier >= 2 },
  ]

  return (
    <div className="inv-print-tab">
      {/* Hidden print output — visible only during window.print() */}
      <div id="inv-print-root">
        <div className={`inv-label-sheet inv-label-sheet--${preset.key}`}>
          {selectedItems.flatMap((item) =>
            Array.from({ length: copies }, (_, ci) => (
              <LabelCard
                key={`${item.id}-${ci}`}
                item={item}
                preset={preset}
                showQR={showQR}
                showSerial={showSerial}
                showMfr={showMfr}
                showLoc={showLoc}
              />
            ))
          )}
        </div>
      </div>

      <div className="inv-print-layout">
        {/* Item selection */}
        <div className="inv-print-panel">
          <div className="inv-print-panel-header">
            <span className="inv-print-panel-title">SELECT ITEMS</span>
            <div className="inv-print-sel-btns">
              <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => setSelected(new Set(items.map(i => i.id)))}>ALL</button>
              <button className="inv-btn inv-btn--ghost inv-btn--sm" onClick={() => setSelected(new Set())}>NONE</button>
              <span className="inv-print-count">{selected.size}/{items.length}</span>
            </div>
          </div>
          <div className="inv-print-item-list">
            {items.map(item => (
              <label key={item.id} className="inv-print-item-row">
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleItem(item.id)} />
                <span className="inv-print-item-name">{item.name}</span>
                <span className="inv-print-item-ein">{item.ein}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Settings + print */}
        <div className="inv-print-panel inv-print-panel--right">
          <div className="inv-print-panel-title">LABEL SIZE</div>
          <div className="inv-print-size-grid">
            {LABEL_PRESETS.map(p => (
              <button
                key={p.key}
                className={`inv-print-size-btn${presetKey === p.key ? ' inv-print-size-btn--active' : ''}`}
                onClick={() => setPresetKey(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="inv-print-panel-title" style={{ marginTop: 18 }}>FIELDS</div>
          {fieldRows.map(({ label, val, set, enabled }) => (
            <label key={label} className={`inv-print-toggle${!enabled ? ' inv-print-toggle--dim' : ''}`}>
              <input type="checkbox" checked={val && enabled} disabled={!enabled} onChange={e => set(e.target.checked)} />
              {label}
              {!enabled && <span className="inv-print-toggle-note">not on {preset.key}</span>}
            </label>
          ))}

          <div className="inv-print-panel-title" style={{ marginTop: 18 }}>COPIES PER LABEL</div>
          <input
            type="number" min={1} max={10} value={copies}
            className="inv-input inv-print-copies"
            onChange={e => setCopies(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
          />

          <button
            className="inv-btn inv-print-btn"
            onClick={handlePrint}
            disabled={selected.size === 0}
            title={selected.size === 0 ? 'Select items to print labels' : undefined}
          >
            PRINT {totalLabels} LABEL{totalLabels !== 1 ? 'S' : ''}
          </button>

          {preset.tier < 4 && (
            <div className="inv-print-tip">
              Set your P-touch tape width to <strong>{preset.key}</strong> in your printer driver before printing.
            </div>
          )}
        </div>
      </div>

      {/* On-screen preview */}
      <div className="inv-print-preview-wrap">
        <div className="inv-print-panel-title">PREVIEW — {preset.label}</div>
        {selectedItems.length === 0 ? (
          <div className="inv-empty-state inv-empty-state--sm">No items selected.</div>
        ) : (
          <div className="inv-print-preview">
            <LabelCard
              item={selectedItems[0]}
              preset={preset}
              showQR={showQR}
              showSerial={showSerial}
              showMfr={showMfr}
              showLoc={showLoc}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

const PAGE_TABS = ['ITEMS', 'AUDIT', 'HISTORY', 'PRINT', 'SETTINGS']

export default function InventoryPage() {
  const { token } = useAuth()

  const [homes,      setHomes]      = useState([])
  const [activeHome, setActiveHome] = useState(null)
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(false)
  const [search,     setSearch]     = useState('')
  const [userTimezone, setUserTimezone] = useState('UTC')

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

  // ── Load user timezone ──────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/inventory/users/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.timezone) setUserTimezone(d.timezone) })
      .catch(() => {})
  }, [token])

  // ── Homes ──────────────────────────────────────────────────────────────────

  const fetchHomes = useCallback(async () => {
    try {
      const res = await safeFetch('/api/inventory/homes', { headers: authHeaders() })
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
    const res = await safeFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
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
    await safeFetch(`/api/inventory/homes/${homeId}`, { method: 'DELETE', headers: authHeaders() })
    setHomes(prev => prev.filter(h => h.id !== homeId))
    if (activeHome?.id === homeId) { setActiveHome(null); setItems([]) }
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  const fetchItems = useCallback(async (homeId) => {
    setLoading(true)
    try {
      const res = await safeFetch(`/api/inventory/homes/${homeId}/items`, { headers: authHeaders() })
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
    const res = await safeFetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) })
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
    await safeFetch(`/api/inventory/items/${itemId}`, { method: 'DELETE', headers: authHeaders() })
    setItems(prev => prev.filter(i => i.id !== itemId))
    setDetailItem(null)
    fetchHomes()
  }

  // ── Manifest download ──────────────────────────────────────────────────────

  const downloadManifest = async () => {
    const res = await safeFetch(`/api/inventory/homes/${activeHome.id}/manifest`, { headers: authHeaders() })
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
            <div style={{ flex: 1 }} />
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
          <p>No homes yet. Create your first home to start tracking inventory.</p>
          <button                                                                           
            className="inv-btn"
            style={{ marginTop: 16 }}                                                       
            onClick={() => { setEditingHome(null); setShowHomeModal(true) }}
          >                                                                                 
            + NEW HOME
          </button>                                                                         
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
              {search || filterStatus !== 'ALL' || filterCategory !== 'ALL' ? (
                'No items match your filters.'                                                  
              ) : (
                <>                                                                              
                  <p style={{ margin: '0 0 12px' }}>No items in this home yet.</p>
                  <button                                                                       
                    className="inv-btn"
                    onClick={() => { setEditingItem(null); setShowItemModal(true) }}            
                  >       
                    + ADD ITEM
                  </button>                                                                     
                </>
              )}                                                                                
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
              token={token}
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

      {/* Audit tab */}
      {activeHome && activeTab === 'AUDIT' && (
        <AuditTab home={activeHome} token={token} items={items} />
      )}

      {/* History tab */}
      {activeHome && activeTab === 'HISTORY' && (
        <HistoryTab home={activeHome} token={token} userTimezone={userTimezone} />
      )}

      {/* Print tab */}
      {activeHome && activeTab === 'PRINT' && (
        <PrintTab items={items} />
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
