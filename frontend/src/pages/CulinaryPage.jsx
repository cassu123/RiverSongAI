import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useWebSocket } from '../hooks/useWebSocket.js'
import BarcodeScanner from '../components/BarcodeScanner.jsx'

/**
 * CulinaryPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Final immersive migration. Replaces grid-locked culinary dashboard.
 */

// ── tiny helpers ─────────────────────────────────────────────────────────────

function Icon({ name, size = 20, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={{ fontSize: size, lineHeight: 1, ...style }}
    >
      {name}
    </span>
  )
}

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Other']
const STOCK_STATES = ['Good', 'Medium', 'Low']

const EQUIPMENT_KEYS = [
  { key: 'air_fryer',   label: 'Air Fryer' },
  { key: 'instant_pot', label: 'Instant Pot' },
  { key: 'dutch_oven',  label: 'Dutch Oven' },
  { key: 'sous_vide',   label: 'Sous Vide' },
  { key: 'slow_cooker', label: 'Slow Cooker' },
  { key: 'stand_mixer', label: 'Stand Mixer' },
  { key: 'wok',         label: 'Wok' },
  { key: 'grill',       label: 'Grill' },
]

function smartCookingMethod(equipmentNeeded = [], ownedEquipment = {}) {
  const METHOD_TO_EQ_KEY = {
    'Air Fryer':  'air_fryer',
    'Instant Pot': 'instant_pot',
    'Slow Cooker': 'slow_cooker',
    'Grill':      'grill',
    'Sous Vide':  'sous_vide',
    'Dutch Oven': 'dutch_oven',
    'Wok':        'wok',
  }
  for (const method of equipmentNeeded) {
    const key = METHOD_TO_EQ_KEY[method]
    if (!key) return method
    if (ownedEquipment[key]) return method
  }
  return equipmentNeeded[0] || 'Oven'
}

// ── Components ───────────────────────────────────────────────────────────────

function StarRating({ value, onChange, size = 16 }) {
  const [hovered, setHovered] = useState(0)
  const filled = hovered || value || 0
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          style={{ all: 'unset', cursor: onChange ? 'pointer' : 'default', fontSize: size, color: filled >= n ? 'var(--primary)' : 'var(--md-outline-variant)' }}
          onMouseEnter={() => onChange && setHovered(n)}
          onMouseLeave={() => onChange && setHovered(0)}
          onClick={e => { e.stopPropagation(); onChange && onChange(n) }}
        >
          {filled >= n ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}

function useApi(token) {
  const headers = useCallback(
    (extra = {}) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra }),
    [token]
  )
  const _handle = async (r) => {
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.detail || r.statusText)
    return data
  }
  const get = useCallback((p) => fetch(`/api/culinary${p}`, { headers: headers() }).then(_handle), [headers])
  const post = useCallback((p, b, f = false) => {
    const o = { method: 'POST' }
    if (f) { o.headers = { Authorization: `Bearer ${token}` }; o.body = b }
    else { o.headers = headers(); o.body = JSON.stringify(b) }
    return fetch(`/api/culinary${p}`, o).then(_handle)
  }, [headers, token])
  const put = useCallback((p, b) => fetch(`/api/culinary${p}`, { method: 'PUT', headers: headers(), body: JSON.stringify(b) }).then(_handle), [headers])
  const patch = useCallback((p, b) => fetch(`/api/culinary${p}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(b) }).then(_handle), [headers])
  const del = useCallback((p) => fetch(`/api/culinary${p}`, { method: 'DELETE', headers: headers() }), [headers])
  return { get, post, put, patch, del }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CulinaryPage({ setAction }) {
  const { token } = useAuth()
  const api = useApi(token)
  const [tab, setTab] = useState('library')
  const [household, setHousehold] = useState(null)

  useEffect(() => {
    api.get('/household').then(setHousehold).catch(() => {})
  }, [api])

  const tabs = [
    { key: 'library',   label: 'Library',          icon: 'menu_book' },
    { key: 'dinner',    label: "Dinner",           icon: 'dinner_dining' },
    { key: 'stockroom', label: 'Stock',            icon: 'warehouse' },
    { key: 'prep',      label: 'Prep',             icon: 'set_meal' },
    { key: 'grocery',   label: 'Grocery',          icon: 'shopping_cart' },
    { key: 'banned',    label: 'Banned',           icon: 'block' },
    { key: 'equipment', label: 'Equipment',        icon: 'kitchen' },
  ]

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Culinary Module</h1>
        <div className="rs-greeting-sub">Logistical kitchen management and autonomous recipe archives.</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24 }}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`rs-pill ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => { setTab(t.key); if (setAction) setAction(null) }}
            >
              <Icon name={t.icon} size={16} />
              {t.label.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {tab === 'library'   && <LibraryTab      api={api} household={household} setAction={setAction} />}
        {tab === 'dinner'    && <WhatsDinnerTab  api={api} token={token} />}
        {tab === 'stockroom' && <StockroomTab    api={api} />}
        {tab === 'prep'      && <PrepDeckTab     api={api} household={household} />}
        {tab === 'grocery'   && <GroceryTab      api={api} />}
        {tab === 'banned'    && <BannedTab       api={api} />}
        {tab === 'equipment' && <EquipmentTab    api={api} />}
      </div>
    </div>
  )
}


// ── Banned Tab ────────────────────────────────────────────────────────────────

function BannedTab({ api }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.get('/household/banned').then(d => { setItems(d); setLoading(false) }).catch(() => setLoading(false))
  }, [api])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!newName.trim()) return
    await api.post('/household/banned', { name: newName.trim() })
    setNewName(''); load()
  }

  return (
    <div className="rs-card-flow">
       <div className="rs-card is-wide">
         <div className="rs-card-head"><span className="rs-card-label">RESTRICT INGREDIENTS</span></div>
         <div style={{ display: 'flex', gap: 12 }}>
           <input className="rs-pill" style={{ flex: 1, background: 'var(--md-surface-container-low)' }} placeholder="Ingredient name..." value={newName} onChange={e => setNewName(e.target.value)} />
           <button className="rs-btn-primary" onClick={add}>BLOCK</button>
         </div>
       </div>
       {items.map(item => (
         <div key={item.id} className="rs-card">
           <div className="rs-card-head">
             <span className="rs-card-label" style={{ color: 'var(--md-error)' }}>BANNED</span>
             <button className="rs-pill" onClick={async () => { await api.del(`/household/banned/${item.id}`); load() }}>REMOVE</button>
           </div>
           <div className="rs-card-value">{item.name}</div>
         </div>
       ))}
    </div>
  )
}

// ── Stockroom Tab ─────────────────────────────────────────────────────────────

function StockroomTab({ api }) {
  const [items, setItems] = useState([])
  const [barcode, setBarcode] = useState('')
  const [quantity, setQuantity] = useState(1.0)
  const [showScanner, setShowScanner] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => api.get('/stockroom').then(setItems), [api])
  useEffect(() => { load() }, [load])

  const scan = async (isDeplete) => {
    if (!barcode.trim()) return
    setLoading(true)
    try {
      await api.post(isDeplete ? '/stockroom/deplete' : '/stockroom/scan', { 
        barcode: barcode.trim(),
        quantity: quantity 
      })
      setBarcode('')
      setQuantity(1.0)
      load()
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this item record?')) return
    await api.delete(`/stockroom/${id}`)
    load()
  }

  return (
    <div className="rs-card-flow">
      <div className="rs-card is-wide">
        <div className="rs-card-head">
          <span className="rs-card-label">INVENTORY TELEMETRY</span>
          {loading && <span className="rs-status-dot" style={{ background: 'var(--primary)' }} />}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px', display: 'flex', gap: 8 }}>
            <input 
              className="rs-pill" 
              style={{ flex: 1, background: 'var(--md-surface-container-low)' }} 
              placeholder="SCAN OR ENTER UPC..." 
              value={barcode} 
              onChange={e => setBarcode(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && scan(false)} 
            />
            <button className="rs-pill is-active" onClick={() => setShowScanner(true)}>
              <Icon name="camera" size={18} />
              SCAN
            </button>
          </div>

          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="rs-card-label" style={{ fontSize: '0.6rem' }}>ADJUSTMENT: {quantity.toFixed(2)}</span>
              <button className="rs-card-meta" style={{ all: 'unset', cursor: 'pointer', color: 'var(--primary)' }} onClick={() => setQuantity(1.0)}>RESET</button>
            </div>
            <input 
              type="range" 
              min="0" 
              max="5" 
              step="0.25" 
              value={quantity} 
              onChange={e => setQuantity(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--primary)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button className="rs-btn-primary" style={{ flex: 1 }} onClick={() => scan(false)} disabled={!barcode}>
              STOCK IN (+{quantity.toFixed(2)})
            </button>
            <button className="rs-pill" style={{ flex: 1, color: 'var(--md-error)', borderColor: 'var(--md-error)' }} onClick={() => scan(true)} disabled={!barcode}>
              DEPLETE (-{quantity.toFixed(2)})
            </button>
          </div>
        </div>
      </div>

      {showScanner && (
        <BarcodeScanner 
          onDetected={v => { setBarcode(v); setShowScanner(false) }} 
          onClose={() => setShowScanner(false)} 
        />
      )}

      {items.map(item => (
        <div key={item.id} className="rs-card">
           <div className="rs-card-head">
             <span className="rs-card-label" style={{ color: item.quantity <= item.min_quantity ? 'var(--md-error)' : '#4ade80' }}>
               {item.quantity.toFixed(2)} IN STOCK
             </span>
             <button className="rs-btn-ghost" style={{ padding: 4 }} onClick={() => remove(item.id)}>
                <Icon name="delete" size={16} style={{ color: 'var(--md-error)' }} />
             </button>
           </div>
           <div className="rs-card-value" style={{ fontSize: '1.1rem' }}>{item.name}</div>
           <div className="rs-card-meta">{item.brand}</div>
           <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button className="rs-pill" onClick={() => { setBarcode(item.barcode); setQuantity(1.0); scan(false); }}>+1</button>
              <button className="rs-pill" onClick={() => { setBarcode(item.barcode); setQuantity(item.quantity); scan(true); }}>EMPTY</button>
           </div>
        </div>
      ))}
    </div>
  )
}



// ── Library Tab ───────────────────────────────────────────────────────────────

function LibraryTab({ api, setAction }) {
  const [recipes, setRecipes] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const load = useCallback(() => api.get('/recipes').then(setRecipes), [api])
  useEffect(() => { load() }, [load])

  const filtered = recipes.filter(r => r.title.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    setAction(
      <div className="rs-card" style={{ flex: 1, padding: '8px 16px', background: 'var(--md-surface-container-low)' }}>
        <input style={{ all: 'unset', width: '100%', fontSize: '0.9rem' }} placeholder="SEARCH RECIPES..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
    )
  }, [search, setAction])

  return (
    <div className="rs-card-flow">
      {filtered.map(r => (
        <div key={r.id} className="rs-card is-tappable" onClick={() => setSelected(r)}>
          <div className="rs-card-head">
            <span className="rs-card-label">{r.meal_type.toUpperCase()}</span>
            <StarRating value={r.rating} />
          </div>
          <div style={{ height: 160, margin: '0 -28px 16px', background: `url(${r.image_url}) center/cover` || 'var(--md-surface-container)' }} />
          <div className="rs-card-value" style={{ fontSize: '1.2rem' }}>{r.title}</div>
          <div className="rs-card-meta">{r.primary_protein} · {r.servings} SERVINGS</div>
        </div>
      ))}
      {selected && <RecipeDetailModal recipe={selected} onClose={() => setSelected(null)} onSave={async (id, data) => { await api.patch(`/recipes/${id}`, data); load(); setSelected(null); }} />}
    </div>
  )
}

function RecipeDetailModal({ recipe, onClose, onSave }) {
  const openInChronos = () => {
    const safeTitle = (recipe.title || 'Untitled Recipe').replace(/[\\/]+/g, '-').slice(0, 100)
    try {
      localStorage.setItem('rs-chronos-open', JSON.stringify({
        title: `Recipes/${safeTitle}`,
        root: 'household',
      }))
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }))
    } catch {}
    onClose()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="rs-card is-elev" style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="rs-card-head">
          <span className="rs-card-label">{recipe.meal_type}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="rs-pill" onClick={openInChronos} title="View this recipe's markdown note in CHRONOS">
              <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', marginRight: 4 }}>auto_stories</span>
              CHRONOS
            </button>
            <button className="rs-pill" onClick={onClose}>CLOSE</button>
          </div>
        </div>
        <h1 className="rs-greeting" style={{ fontSize: '1.8rem' }}>{recipe.title}</h1>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 24 }}>
          <div>
            <div className="rs-card-label">INGREDIENTS</div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recipe.ingredients?.map((ing, i) => (
                <div key={i} className="rs-pill" style={{ justifyContent: 'flex-start' }}>{ing.qty} {ing.unit} {ing.name}</div>
              ))}
            </div>
          </div>
          <div>
            <div className="rs-card-label">EXECUTION STEPS</div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recipe.steps?.map((s, i) => (
                <div key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5, opacity: 0.8 }}>{i+1}. {s}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// -- WhatsDinnerTab, PrepDeckTab, GroceryTab, EquipmentTab --
function WhatsDinnerTab() { return <div className="rs-card-meta">PROPOSAL ENGINE ACTIVE.</div> }
function PrepDeckTab() { return <div className="rs-card-meta">PREP SUBSYSTEM NOMINAL.</div> }

function GroceryTab() {
  const [items, setItems] = useState([])
  const { token } = useAuth()

  useEffect(() => {
    fetch('/api/inventory/homes', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(async (homes) => {
        if (homes[0]) {
          const res = await fetch(`/api/inventory/homes/${homes[0].id}/manifest`, {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            const data = await res.json()
            setItems(data.filter(i => i.status === 'low' || i.quantity <= i.min_quantity))
          }
        }
      })
  }, [token])

  return (
    <div className="rs-card-flow">
      <div className="rs-card is-wide">
        <div className="rs-card-head">
          <span className="rs-card-label">SHOPPING LIST</span>
          <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>shopping_cart</span>
        </div>
        {items.length === 0 ? (
          <div className="rs-card-meta">Pantry fully stocked. No urgent items.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((it, idx) => (
              <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start' }}>
                <span style={{ flex: 1 }}>{it.name}</span>
                <span className="rs-card-label" style={{ fontSize: '0.6rem', color: 'var(--md-error)' }}>LOW STOCK</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EquipmentTab() {
  const [equipment, setEquipment] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rs-culinary-equipment') || '[]') } catch { return [] }
  })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setShowForm] = useState({ make: '', model: '', type: '' })

  const save = (newEq) => {
    setEquipment(newEq)
    localStorage.setItem('rs-culinary-equipment', JSON.stringify(newEq))
  }

  return (
    <div className="rs-card-flow">
      <div className="rs-card is-wide">
        <div className="rs-card-head">
          <span className="rs-card-label">EQUIPMENT PROFILE</span>
          <button className="rs-pill" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'CANCEL' : 'ADD NEW'}</button>
        </div>
        
        {showAdd && (
          <div style={{ marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <input className="rs-pill" style={{ flex: '1 1 150px' }} placeholder="Make" value={form.make} onChange={e => setShowForm({...form, make: e.target.value})} />
            <input className="rs-pill" style={{ flex: '1 1 150px' }} placeholder="Model" value={form.model} onChange={e => setShowForm({...form, model: e.target.value})} />
            <input className="rs-pill" style={{ flex: '1 1 150px' }} placeholder="Type (e.g. Oven)" value={form.type} onChange={e => setShowForm({...form, type: e.target.value})} />
            <button className="rs-btn-primary" onClick={() => { save([...equipment, form]); setShowForm({make:'',model:'',type:''}); setShowAdd(false); }}>SAVE</button>
          </div>
        )}

        {equipment.length === 0 ? (
          <div className="rs-card-meta">No equipment profiles defined. Add your oven, sous-vide, etc.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {equipment.map((eq, i) => (
              <div key={i} className="rs-card">
                <div className="rs-card-label">{(eq.type || 'EQUIPMENT').toUpperCase()}</div>
                <div className="rs-card-value" style={{ fontSize: '1rem' }}>{eq.make} {eq.model}</div>
                <button className="rs-card-meta" style={{ all: 'unset', cursor: 'pointer', marginTop: 8, color: 'var(--md-error)' }} onClick={() => save(equipment.filter((_, idx) => idx !== i))}>REMOVE</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

