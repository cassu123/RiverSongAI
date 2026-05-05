import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import './CulinaryPage.css'

// ── tiny helpers ─────────────────────────────────────────────────────────────

function Icon({ name, size = 20 }) {
  return (
    <span
      className="material-symbols-rounded"
      style={{ fontSize: size, lineHeight: 1 }}
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

// ── API helpers ───────────────────────────────────────────────────────────────

function useApi(token) {
  const headers = useCallback(
    (extra = {}) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra }),
    [token]
  )

  const get = useCallback(
    (path) => fetch(`/api/culinary${path}`, { headers: headers() }).then(r => {
      if (!r.ok) throw Object.assign(new Error(r.statusText), { status: r.status })
      return r.json()
    }),
    [headers]
  )

  const post = useCallback(
    (path, body, formData = false) => {
      if (formData) {
        return fetch(`/api/culinary${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body,
        }).then(r => r.json())
      }
      return fetch(`/api/culinary${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      }).then(r => r.json())
    },
    [headers, token]
  )

  const put = useCallback(
    (path, body) => fetch(`/api/culinary${path}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(body),
    }).then(r => r.json()),
    [headers]
  )

  const del = useCallback(
    (path) => fetch(`/api/culinary${path}`, { method: 'DELETE', headers: headers() }),
    [headers]
  )

  return { get, post, put, del }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CulinaryPage() {
  const { token } = useAuth()
  const api = useApi(token)
  const [tab, setTab] = useState('library')
  const [household, setHousehold] = useState(null)

  useEffect(() => {
    api.get('/household').then(h => setHousehold(h)).catch(() => {})
  }, []) // eslint-disable-line

  const tabs = [
    { key: 'library',   label: 'Library',       icon: 'menu_book' },
    { key: 'stockroom', label: 'Stockroom',      icon: 'warehouse' },
    { key: 'prep',      label: 'Prep Deck',      icon: 'set_meal' },
    { key: 'walmart',   label: 'Walmart Export', icon: 'shopping_cart' },
    { key: 'settings',  label: 'Equipment',      icon: 'kitchen' },
  ]

  return (
    <div className="culinary-page page-wrap">
      <div className="culinary-header">
        <Icon name="restaurant_menu" size={32} />
        <h1>CULINARY</h1>
      </div>

      <div className="culinary-tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`culinary-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'library'   && <LibraryTab   api={api} household={household} />}
      {tab === 'stockroom' && <StockroomTab api={api} household={household} />}
      {tab === 'prep'      && <PrepDeckTab  api={api} household={household} />}
      {tab === 'walmart'   && <WalmartTab   api={api} household={household} />}
      {tab === 'settings'  && <EquipmentTab api={api} />}
    </div>
  )
}

// ── Library Tab ───────────────────────────────────────────────────────────────

function LibraryTab({ api }) {
  const [recipes, setRecipes] = useState([])
  const [selected, setSelected] = useState(null)
  const [showIngest, setShowIngest] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    api.get('/recipes').then(setRecipes).catch(() => {})
  }, [api])

  useEffect(() => { load() }, [load])

  const deleteRecipe = async (id) => {
    await api.del(`/recipes/${id}`)
    setSelected(null)
    load()
  }

  const sendToPrep = async (recipeId) => {
    try {
      const active = await api.get('/prep')
      await api.post(`/prep/${active.id}/add-recipe`, { recipe_id: recipeId })
      alert('Added to active Prep Deck session.')
    } catch {
      const create = window.confirm('No active Prep Deck session. Create one now?')
      if (create) {
        const session = await api.post('/prep', { label: 'Meal Prep Session' })
        await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipeId })
        alert('Prep Deck session created and recipe added.')
      }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button className="cul-btn cul-btn-primary" onClick={() => setShowIngest(true)}>
          <Icon name="upload_file" size={16} /> Ingest PDF / URL
        </button>
        <button className="cul-btn cul-btn-secondary" onClick={() => setShowCreate(true)}>
          <Icon name="add" size={16} /> Manual Entry
        </button>
      </div>

      {recipes.length === 0 && !loading && (
        <div className="cul-empty">
          <Icon name="menu_book" size={48} />
          No recipes yet. Ingest a PDF or URL to get started.
        </div>
      )}

      <div className="cul-grid-3">
        {recipes.map(r => (
          <div
            key={r.id}
            className="recipe-card"
            onClick={() => setSelected(r)}
          >
            <div className="recipe-card-banner">
              {r.image_url
                ? <img className="recipe-card-img" src={r.image_url} alt={r.title} loading="lazy" />
                : <div className="recipe-card-placeholder"><Icon name="restaurant_menu" size={32} /></div>
              }
            </div>
            <div className="recipe-card-body">
              <h3>{r.title}</h3>
              <div className="recipe-meta">
                <span className="recipe-tag">{r.meal_type}</span>
                {r.primary_protein && (
                  <span className="recipe-tag protein">{r.primary_protein}</span>
                )}
                <span className="recipe-tag">{r.servings} srv</span>
              </div>
              {r.blacklisted?.length > 0 && (
                <div className="recipe-blacklist-warning">
                  <Icon name="warning" size={14} />
                  {r.blacklisted.length} flagged ingredient{r.blacklisted.length > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showIngest && (
        <IngestModal
          api={api}
          onClose={() => { setShowIngest(false); load() }}
        />
      )}

      {showCreate && (
        <CreateRecipeModal
          api={api}
          onClose={() => { setShowCreate(false); load() }}
        />
      )}

      {selected && (
        <RecipeDetailModal
          recipe={selected}
          onClose={() => { setSelected(null); load() }}
          onDelete={() => deleteRecipe(selected.id)}
          onSendToPrep={() => sendToPrep(selected.id)}
        />
      )}
    </div>
  )
}

// ── Ingest Modal ──────────────────────────────────────────────────────────────

function IngestModal({ api, onClose }) {
  const [mode, setMode]       = useState('url')
  const [url, setUrl]         = useState('')
  const [file, setFile]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState(null)

  const submit = async () => {
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const fd = new FormData()
      if (mode === 'url') {
        if (!url.trim()) { setError('Enter a URL.'); setLoading(false); return }
        fd.append('source_url', url.trim())
      } else if (file) {
        fd.append('file', file)
      } else {
        setError('Select a PDF file.')
        setLoading(false)
        return
      }
      const res = await api.post('/recipes/ingest', fd, true)
      if (res.count != null) {
        setResult(res)
      } else {
        setError(res.detail || 'Ingest failed.')
      }
    } catch (e) {
      setError(e?.message || 'Network error.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cul-modal-backdrop" onClick={result ? undefined : onClose}>
      <div className="cul-modal" onClick={e => e.stopPropagation()}>
        <button className="cul-modal-close" onClick={onClose}>
          <Icon name="close" />
        </button>
        <h2>Ingest Recipes</h2>

        {!result ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                className={`cul-btn ${mode === 'url' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
                onClick={() => setMode('url')}
              >
                URL
              </button>
              <button
                className={`cul-btn ${mode === 'pdf' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
                onClick={() => setMode('pdf')}
              >
                PDF
              </button>
            </div>

            {mode === 'url' ? (
              <input
                className="cul-input"
                placeholder="https://..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
              />
            ) : (
              <input
                type="file"
                accept=".pdf"
                style={{ color: 'var(--on-surface)' }}
                onChange={e => setFile(e.target.files[0])}
              />
            )}

            {error && (
              <div style={{ color: 'var(--error)', marginTop: 8, fontSize: '0.85rem' }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="cul-btn cul-btn-primary" onClick={submit} disabled={loading}>
                {loading ? 'Parsing...' : 'Parse with AI'}
              </button>
              <button className="cul-btn cul-btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
              padding: '12px 14px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
            }}>
              <Icon name="check_circle" size={24} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                  {result.count} recipe{result.count !== 1 ? 's' : ''} imported
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                  All saved to your Library.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16, maxHeight: 240, overflowY: 'auto' }}>
              {result.recipes.map((r, i) => (
                <div key={i} className="stock-item" style={{ gap: 8 }}>
                  <Icon name="restaurant_menu" size={16} />
                  <div style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{r.title}</div>
                  <span className="recipe-tag">{r.meal_type}</span>
                  {r.blacklisted?.length > 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--error)' }}>
                      <Icon name="warning" size={13} /> {r.blacklisted.length}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <button className="cul-btn cul-btn-primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Create Recipe Modal ───────────────────────────────────────────────────────

function CreateRecipeModal({ api, onClose }) {
  const [title, setTitle]         = useState('')
  const [mealType, setMealType]   = useState('Other')
  const [protein, setProtein]     = useState('')
  const [servings, setServings]   = useState(4)
  const [imageUrl, setImageUrl]   = useState('')
  const [ingredients, setIngredients] = useState([{ name: '', qty: '', unit: '' }])
  const [steps, setSteps]         = useState([''])
  const [equipment, setEquipment] = useState([''])
  const [saving, setSaving]       = useState(false)

  const addIngredient = () => setIngredients(p => [...p, { name: '', qty: '', unit: '' }])
  const addStep       = () => setSteps(p => [...p, ''])
  const addEquipment  = () => setEquipment(p => [...p, ''])

  const submit = async () => {
    if (!title.trim()) return
    setSaving(true)
    await api.post('/recipes', {
      title: title.trim(),
      meal_type: mealType,
      primary_protein: protein || null,
      servings: parseInt(servings),
      image_url: imageUrl.trim() || null,
      ingredients: ingredients.filter(i => i.name.trim()),
      steps: steps.filter(s => s.trim()),
      equipment_needed: equipment.filter(e => e.trim()),
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="cul-modal-backdrop" onClick={onClose}>
      <div className="cul-modal" onClick={e => e.stopPropagation()}>
        <button className="cul-modal-close" onClick={onClose}><Icon name="close" /></button>
        <h2>New Recipe</h2>

        <div className="cul-input-row">
          <label>Title</label>
          <input className="cul-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Recipe title" />
        </div>
        <div className="cul-input-row">
          <label>Meal Type</label>
          <select className="cul-select" value={mealType} onChange={e => setMealType(e.target.value)}>
            {MEAL_TYPES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="cul-input-row">
          <label>Protein</label>
          <input className="cul-input" value={protein} onChange={e => setProtein(e.target.value)} placeholder="Chicken, Beef..." />
        </div>
        <div className="cul-input-row">
          <label>Servings</label>
          <input className="cul-input" type="number" value={servings} min={1} onChange={e => setServings(e.target.value)} style={{ maxWidth: 80 }} />
        </div>
        <div className="cul-input-row">
          <label>Image URL</label>
          <input className="cul-input" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://... (optional)" />
        </div>

        <div className="cul-section-title">Ingredients</div>
        {ingredients.map((ing, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input className="cul-input" style={{ flex: 3 }} placeholder="Name" value={ing.name} onChange={e => setIngredients(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="cul-input" style={{ flex: 1 }} placeholder="Qty" value={ing.qty} onChange={e => setIngredients(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
            <input className="cul-input" style={{ flex: 1 }} placeholder="Unit" value={ing.unit} onChange={e => setIngredients(p => p.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
          </div>
        ))}
        <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={addIngredient}><Icon name="add" size={14} /> Add</button>

        <div className="cul-section-title">Steps</div>
        {steps.map((s, i) => (
          <textarea
            key={i}
            className="cul-input"
            style={{ marginBottom: 6, minHeight: 56, resize: 'vertical' }}
            placeholder={`Step ${i + 1}`}
            value={s}
            onChange={e => setSteps(p => p.map((x, j) => j === i ? e.target.value : x))}
          />
        ))}
        <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={addStep}><Icon name="add" size={14} /> Add Step</button>

        <div className="cul-section-title">Equipment</div>
        {equipment.map((eq, i) => (
          <input key={i} className="cul-input" style={{ marginBottom: 6 }} placeholder="e.g. Instant Pot" value={eq} onChange={e => setEquipment(p => p.map((x, j) => j === i ? e.target.value : x))} />
        ))}
        <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={addEquipment}><Icon name="add" size={14} /> Add</button>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="cul-btn cul-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Save Recipe'}</button>
          <button className="cul-btn cul-btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Recipe Detail Modal ───────────────────────────────────────────────────────

function RecipeDetailModal({ recipe, onClose, onDelete, onSendToPrep }) {
  const blacklistSet = new Set((recipe.blacklisted || []).map(b => b.name?.toLowerCase()))

  return (
    <div className="cul-modal-backdrop" onClick={onClose}>
      <div className="cul-modal cul-modal-recipe" onClick={e => e.stopPropagation()}>
        <div className="recipe-hero-wrap">
          {recipe.image_url
            ? <img className="recipe-hero-img" src={recipe.image_url} alt={recipe.title} />
            : <div className="recipe-hero-placeholder"><Icon name="restaurant_menu" size={48} /></div>
          }
          <div className="recipe-hero-gradient" />
          <button className="cul-modal-close recipe-hero-close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          <h2 style={{ marginTop: 16 }}>{recipe.title}</h2>

          <div className="recipe-meta" style={{ marginBottom: 14 }}>
            <span className="recipe-tag">{recipe.meal_type}</span>
            {recipe.primary_protein && <span className="recipe-tag protein">{recipe.primary_protein}</span>}
            <span className="recipe-tag">{recipe.servings} servings</span>
            {recipe.source_type !== 'manual' && <span className="recipe-tag">{recipe.source_type}</span>}
          </div>

          {recipe.blacklisted?.length > 0 && (
            <div className="cul-card" style={{ borderColor: 'var(--error)', marginBottom: 14 }}>
              <div className="cul-card-title"><Icon name="warning" size={16} /> Flagged Ingredients</div>
              {recipe.blacklisted.map((b, i) => (
                <div key={i} style={{ fontSize: '0.85rem', marginBottom: 4 }}>
                  <span style={{ color: 'var(--error)' }}>{b.name}</span>
                  {b.substitute && <span style={{ color: 'var(--on-surface-variant)' }}> → suggest: {b.substitute}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="cul-section-title">Ingredients</div>
          <ul className="ing-list">
            {(recipe.ingredients || []).map((ing, i) => (
              <li
                key={i}
                className={`ing-chip${blacklistSet.has(ing.name?.toLowerCase()) ? ' blacklisted' : ''}`}
              >
                {ing.qty} {ing.unit} {ing.name}
              </li>
            ))}
          </ul>

          <div className="cul-section-title">Steps</div>
          <ol className="steps-list">
            {(recipe.steps || []).map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>

          {recipe.equipment_needed?.length > 0 && (
            <>
              <div className="cul-section-title">Equipment Needed</div>
              <ul className="ing-list">
                {recipe.equipment_needed.map((e, i) => <li key={i} className="ing-chip">{e}</li>)}
              </ul>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
            <button className="cul-btn cul-btn-primary" onClick={onSendToPrep}>
              <Icon name="set_meal" size={15} /> Send to Prep Deck
            </button>
            <button className="cul-btn cul-btn-danger" onClick={onDelete}>
              <Icon name="delete" size={15} /> Delete
            </button>
            <button className="cul-btn cul-btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Stockroom Tab ─────────────────────────────────────────────────────────────

function StockroomTab({ api }) {
  const [items, setItems]       = useState([])
  const [barcode, setBarcode]   = useState('')
  const [filter, setFilter]     = useState('all')
  const [manualName, setManualName] = useState('')
  const [manualState, setManualState] = useState('Good')
  const barcodeRef = useRef(null)

  const load = useCallback(() => {
    api.get('/stockroom').then(setItems).catch(() => {})
  }, [api])

  useEffect(() => { load() }, [load])

  const scan = async (deplete = false) => {
    if (!barcode.trim()) return
    const result = await (deplete
      ? api.post('/stockroom/deplete', { barcode: barcode.trim() })
      : api.post('/stockroom/scan',    { barcode: barcode.trim() })
    )
    setBarcode('')
    load()
    barcodeRef.current?.focus()
  }

  const setState = async (id, state) => {
    await api.put(`/stockroom/${id}`, { state })
    load()
  }

  const deleteItem = async (id) => {
    await api.del(`/stockroom/${id}`)
    load()
  }

  const addManual = async () => {
    if (!manualName.trim()) return
    await api.post('/stockroom', { name: manualName.trim(), state: manualState })
    setManualName('')
    load()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.state === filter)

  return (
    <div>
      {/* Barcode scanner */}
      <div className="cul-card">
        <div className="cul-card-title"><Icon name="qr_code_scanner" size={18} /> Barcode Scanner</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={barcodeRef}
            className="cul-input"
            style={{ maxWidth: 240 }}
            placeholder="Scan or type UPC..."
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && scan(false)}
          />
          <button className="cul-btn cul-btn-primary" onClick={() => scan(false)}>
            <Icon name="add_box" size={15} /> Stock In (Good)
          </button>
          <button className="cul-btn cul-btn-danger" onClick={() => scan(true)}>
            <Icon name="delete_sweep" size={15} /> Trash Scan (Low)
          </button>
        </div>
      </div>

      {/* Manual add */}
      <div className="cul-card">
        <div className="cul-card-title"><Icon name="edit" size={16} /> Add Manually</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            className="cul-input"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Ingredient name..."
            value={manualName}
            onChange={e => setManualName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addManual()}
          />
          <select className="cul-select" value={manualState} onChange={e => setManualState(e.target.value)}>
            {STOCK_STATES.map(s => <option key={s}>{s}</option>)}
          </select>
          <button className="cul-btn cul-btn-primary" onClick={addManual}>Add</button>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['all', 'Good', 'Medium', 'Low'].map(f => (
          <button
            key={f}
            className={`cul-btn cul-btn-sm ${filter === f ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="cul-empty">
          <Icon name="warehouse" size={48} />
          Stockroom is empty. Start scanning items.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(item => (
          <div key={item.id} className="stock-item">
            <div className={`stock-state-badge ${item.state.toLowerCase()}`}>{item.state}</div>
            <div style={{ flex: 1 }}>
              <div className="stock-item-name">{item.name}</div>
              {item.brand && <div className="stock-item-brand">{item.brand}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {STOCK_STATES.filter(s => s !== item.state).map(s => (
                <button
                  key={s}
                  className="cul-btn cul-btn-secondary cul-btn-sm"
                  onClick={() => setState(item.id, s)}
                >
                  → {s}
                </button>
              ))}
              <button className="cul-btn cul-btn-danger cul-btn-sm" onClick={() => deleteItem(item.id)}>
                <Icon name="delete" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Prep Deck Tab ─────────────────────────────────────────────────────────────

function PrepDeckTab({ api }) {
  const [session, setSession]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [shoppingList, setShoppingList] = useState(null)
  const [staging, setStaging]     = useState(null)
  const [view, setView]           = useState('overview') // overview | shopping | staging
  const [newLabel, setNewLabel]   = useState('')

  const loadSession = useCallback(() => {
    setLoading(true)
    api.get('/prep')
      .then(s => { setSession(s); setLoading(false) })
      .catch(() => { setSession(null); setLoading(false) })
  }, [api])

  useEffect(() => { loadSession() }, [loadSession])

  const createSession = async () => {
    const s = await api.post('/prep', { label: newLabel || 'Meal Prep Session' })
    setSession(s)
    setNewLabel('')
  }

  const completeSession = async () => {
    if (!window.confirm('Mark this session complete and clear the Prep Deck?')) return
    await api.post(`/prep/${session.id}/complete`, {})
    setSession(null)
    setShoppingList(null)
    setStaging(null)
  }

  const removeRecipe = async (entryId) => {
    await api.del(`/prep/${session.id}/recipes/${entryId}`)
    loadSession()
  }

  const loadShoppingList = async () => {
    const result = await api.get(`/prep/${session.id}/shopping-list`)
    setShoppingList(result.shopping_list)
    setView('shopping')
  }

  const loadStaging = async () => {
    const result = await api.get(`/prep/${session.id}/staging`)
    setStaging(result.piles)
    setView('staging')
  }

  if (loading) return <div className="cul-empty">Loading...</div>

  if (!session) {
    return (
      <div>
        <div className="cul-card">
          <div className="cul-card-title"><Icon name="add_circle" size={18} /> Start New Prep Session</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="cul-input"
              placeholder="Session label (optional)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createSession()}
            />
            <button className="cul-btn cul-btn-primary" onClick={createSession}>
              <Icon name="play_arrow" size={16} /> Start
            </button>
          </div>
        </div>
        <div className="cul-empty">
          <Icon name="set_meal" size={48} />
          No active prep session. Create one above and add recipes from the Library.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="cul-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="cul-card-title">
              <Icon name="set_meal" size={18} />
              {session.label || 'Prep Session'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
              {session.recipes.length} recipe{session.recipes.length !== 1 ? 's' : ''} staged
            </div>
          </div>
          <button className="cul-btn cul-btn-danger cul-btn-sm" onClick={completeSession}>
            <Icon name="check_circle" size={14} /> Complete Session
          </button>
        </div>

        {session.recipes.length === 0 && (
          <div style={{ marginTop: 12, color: 'var(--on-surface-variant)', fontSize: '0.88rem' }}>
            Use "Send to Prep Deck" in the Library tab to stage recipes.
          </div>
        )}

        {session.recipes.map(entry => (
          <PrepRecipeCard
            key={entry.entry_id}
            entry={entry}
            api={api}
            onRemove={() => removeRecipe(entry.entry_id)}
          />
        ))}
      </div>

      {session.recipes.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            className={`cul-btn ${view === 'overview' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={() => setView('overview')}
          >
            <Icon name="list_alt" size={15} /> Overview
          </button>
          <button
            className={`cul-btn ${view === 'shopping' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={loadShoppingList}
          >
            <Icon name="shopping_cart" size={15} /> Master Shopping List
          </button>
          <button
            className={`cul-btn ${view === 'staging' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={loadStaging}
          >
            <Icon name="view_column" size={15} /> Staging Area
          </button>
        </div>
      )}

      {view === 'shopping' && shoppingList && (
        <div className="cul-card">
          <div className="cul-card-title"><Icon name="shopping_cart" size={16} /> Master Shopping List</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', margin: '0 0 10px 0' }}>
            Good stockroom items are omitted. Low items are included automatically.
          </p>
          {shoppingList.length === 0 ? (
            <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.88rem' }}>
              Everything is stocked. Nothing to buy!
            </div>
          ) : (
            <ul className="prep-shopping-list">
              {shoppingList.map((item, i) => (
                <li key={i}>
                  <span className="prep-shopping-qty">{item.qty} {item.unit}</span>
                  <span>{item.name}</span>
                  {item._from_stockroom && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--error)', marginLeft: 4 }}>(Low)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view === 'staging' && staging && (
        <div>
          <div className="cul-section-title">Staging Area — Recipe Piles</div>
          <div className="cul-grid-2">
            {staging.map((pile, i) => (
              <div key={i} className="staging-pile">
                <h4>{pile.recipe_title}</h4>
                {pile.ingredients.length === 0 ? (
                  <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.82rem' }}>
                    All ingredients in stock.
                  </div>
                ) : (
                  <ul className="prep-shopping-list">
                    {pile.ingredients.map((ing, j) => (
                      <li key={j}>
                        <span className="prep-shopping-qty">{ing.qty} {ing.unit}</span>
                        <span>{ing.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Prep Recipe Card (with Adjuster + Cooking Method) ────────────────────────

function PrepRecipeCard({ entry, api, onRemove }) {
  const [expanded, setExpanded]       = useState(false)

  // Adjuster
  const [containers, setContainers]   = useState(8)
  const [contOz, setContOz]           = useState(8)
  const [scaling, setScaling]         = useState(false)
  const [scaleResult, setScaleResult] = useState(null)

  // Cooking Method
  const [eqTarget, setEqTarget]           = useState('Air Fryer')
  const [translating, setTranslating]     = useState(false)
  const [rewrittenSteps, setRewrittenSteps] = useState(null)

  const handleScale = async () => {
    setScaling(true)
    const result = await api.post(`/recipes/${entry.recipe_id}/scale`, {
      target_containers: parseInt(containers),
      container_oz:      parseInt(contOz),
    })
    setScaleResult(result)
    setScaling(false)
  }

  const handleTranslate = async () => {
    setTranslating(true)
    const result = await api.post(`/recipes/${entry.recipe_id}/translate-equipment`, { equipment: eqTarget })
    setRewrittenSteps(result.rewritten_steps)
    setTranslating(false)
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="stock-item">
        <Icon name="restaurant_menu" size={18} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>{entry.recipe_title}</div>
          {entry.servings_target && (
            <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)' }}>
              Target: {entry.servings_target} servings
            </div>
          )}
        </div>
        <button
          className={`cul-btn cul-btn-sm ${expanded ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
          onClick={() => setExpanded(v => !v)}
          title="Adjuster &amp; Cooking Method"
        >
          <Icon name="tune" size={14} />
        </button>
        <button className="cul-btn cul-btn-danger cul-btn-sm" onClick={onRemove}>
          <Icon name="remove_circle" size={14} />
        </button>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 28, paddingTop: 12 }}>

          {/* ── Adjuster ──────────────────────────────────────────── */}
          <div className="cul-section-title">The Adjuster</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="cul-input"
              type="number"
              min={1}
              style={{ maxWidth: 80 }}
              value={containers}
              onChange={e => setContainers(e.target.value)}
              placeholder="Containers"
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>containers ×</span>
            <input
              className="cul-input"
              type="number"
              min={1}
              style={{ maxWidth: 70 }}
              value={contOz}
              onChange={e => setContOz(e.target.value)}
              placeholder="oz"
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>oz each</span>
            <button className="cul-btn cul-btn-primary cul-btn-sm" onClick={handleScale} disabled={scaling}>
              {scaling ? 'Scaling...' : 'Scale'}
            </button>
          </div>

          {scaleResult && (
            <div className="cul-card" style={{ marginTop: 10 }}>
              <div className="cul-card-title">
                ×{scaleResult.scale_factor} — {scaleResult.total_oz} oz total
              </div>
              <ul className="ing-list">
                {(scaleResult.scaled_ingredients || []).map((ing, i) => (
                  <li key={i} className="ing-chip">{ing.qty} {ing.unit} {ing.name}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Cooking Method ────────────────────────────────────── */}
          <div className="cul-section-title" style={{ marginTop: 16 }}>Cooking Method</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="cul-select" value={eqTarget} onChange={e => setEqTarget(e.target.value)}>
              {['Air Fryer', 'Instant Pot', 'Slow Cooker', 'Oven', 'Stovetop', 'Grill', 'Sous Vide'].map(eq => (
                <option key={eq}>{eq}</option>
              ))}
            </select>
            <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={handleTranslate} disabled={translating}>
              {translating ? 'Rewriting...' : 'Rewrite Steps'}
            </button>
          </div>

          {rewrittenSteps && (
            <div className="cul-card" style={{ marginTop: 10 }}>
              <div className="cul-card-title" style={{ marginBottom: 6 }}>
                <Icon name="check_circle" size={14} /> Steps for {eqTarget}
              </div>
              <ol className="steps-list" style={{ fontSize: '0.85rem' }}>
                {rewrittenSteps.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── Walmart Export Tab ────────────────────────────────────────────────────────

function WalmartTab({ api }) {
  const [mappings, setMappings]   = useState([])
  const [ingName, setIngName]     = useState('')
  const [itemId, setItemId]       = useState('')
  const [exportResult, setExportResult] = useState(null)
  const [exporting, setExporting] = useState(false)

  const loadMappings = useCallback(() => {
    api.get('/walmart/mappings').then(setMappings).catch(() => {})
  }, [api])

  useEffect(() => { loadMappings() }, [loadMappings])

  const addMapping = async () => {
    if (!ingName.trim() || !itemId.trim()) return
    await api.post('/walmart/mappings', {
      ingredient_name: ingName.trim(),
      walmart_item_id: itemId.trim(),
    })
    setIngName('')
    setItemId('')
    loadMappings()
  }

  const deleteMapping = async (id) => {
    await api.del(`/walmart/mappings/${id}`)
    loadMappings()
  }

  const exportCart = async () => {
    setExporting(true)
    const result = await api.post('/walmart/export', {})
    setExportResult(result)
    setExporting(false)
  }

  return (
    <div>
      <div className="cul-card">
        <div className="cul-card-title"><Icon name="shopping_cart" size={18} /> Generate Walmart Cart</div>
        <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: 'var(--on-surface-variant)' }}>
          Generates a cart URL from the active Prep Deck session's shopping list using your Walmart Item ID mappings.
        </p>
        <button className="cul-btn cul-btn-primary" onClick={exportCart} disabled={exporting}>
          <Icon name="open_in_new" size={15} /> {exporting ? 'Building...' : 'Export to Walmart Cart'}
        </button>

        {exportResult && (
          <div style={{ marginTop: 14 }}>
            {exportResult.cart_url ? (
              <>
                <div style={{ fontSize: '0.85rem', marginBottom: 6, color: 'var(--on-surface-variant)' }}>
                  {exportResult.mapped_count} item{exportResult.mapped_count !== 1 ? 's' : ''} mapped
                </div>
                <div className="walmart-url-box">{exportResult.cart_url}</div>
                <a
                  className="cul-btn cul-btn-primary"
                  href={exportResult.cart_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none', display: 'inline-flex' }}
                >
                  <Icon name="open_in_new" size={15} /> Open Cart
                </a>
              </>
            ) : (
              <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem' }}>
                No mapped items found. Add Walmart Item ID mappings below.
              </div>
            )}

            {exportResult.unmapped?.length > 0 && (
              <div className="walmart-unmapped">
                <h4><Icon name="warning" size={14} /> Unmapped — Add Manually</h4>
                <ul>
                  {exportResult.unmapped.map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="cul-card">
        <div className="cul-card-title"><Icon name="table_view" size={16} /> Ingredient → Walmart Item ID Mappings</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <input
            className="cul-input"
            style={{ flex: 2, minWidth: 140 }}
            placeholder="Ingredient name (e.g. chicken breast)"
            value={ingName}
            onChange={e => setIngName(e.target.value)}
          />
          <input
            className="cul-input"
            style={{ flex: 1, minWidth: 120 }}
            placeholder="Walmart Item ID"
            value={itemId}
            onChange={e => setItemId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addMapping()}
          />
          <button className="cul-btn cul-btn-primary" onClick={addMapping}>Add</button>
        </div>

        {mappings.length === 0 ? (
          <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem' }}>
            No mappings yet. Add ingredient → Walmart Item ID pairs above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mappings.map(m => (
              <div key={m.id} className="stock-item">
                <div style={{ flex: 1, fontSize: '0.88rem' }}>{m.ingredient_name}</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--primary)' }}>
                  {m.walmart_item_id}
                </div>
                <button
                  className="cul-btn cul-btn-danger cul-btn-sm"
                  onClick={() => deleteMapping(m.id)}
                >
                  <Icon name="delete" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Equipment Tab ─────────────────────────────────────────────────────────────

function EquipmentTab({ api }) {
  const [items, setItems]     = useState([])
  const [adding, setAdding]   = useState(false)
  const [newType, setNewType] = useState(EQUIPMENT_KEYS[0].key)
  const [newMake, setNewMake] = useState('')
  const [newModel, setNewModel] = useState('')
  const [saving, setSaving]   = useState(false)

  const load = useCallback(() => {
    api.get('/household/equipment').then(setItems).catch(() => {})
  }, [api])

  useEffect(() => { load() }, [load])

  const addItem = async () => {
    if (saving) return
    setSaving(true)
    const label = EQUIPMENT_KEYS.find(e => e.key === newType)?.label || newType
    await api.post('/household/equipment', {
      equipment_type: newType,
      label,
      make:  newMake.trim()  || null,
      model: newModel.trim() || null,
    })
    setAdding(false)
    setNewMake('')
    setNewModel('')
    setSaving(false)
    load()
  }

  const updateItem = async (id, make, model) => {
    await api.put(`/household/equipment/${id}`, {
      make:  make  || null,
      model: model || null,
    })
    load()
  }

  const deleteItem = async (id) => {
    await api.del(`/household/equipment/${id}`)
    load()
  }

  return (
    <div>
      <div className="cul-card">
        <div className="cul-card-title"><Icon name="kitchen" size={18} /> Kitchen Equipment</div>
        <p style={{ margin: '0 0 14px 0', fontSize: '0.85rem', color: 'var(--on-surface-variant)' }}>
          Add your appliances with make and model to personalize recipes and power the AI Equipment Translator.
        </p>

        {items.length === 0 && !adding && (
          <div className="cul-empty" style={{ padding: '16px 0' }}>
            <Icon name="kitchen" size={36} />
            No equipment added yet.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: items.length ? 14 : 0 }}>
          {items.map(item => (
            <EquipmentItemCard
              key={item.id}
              item={item}
              onUpdate={updateItem}
              onDelete={deleteItem}
            />
          ))}
        </div>

        {adding ? (
          <div className="cul-card" style={{ background: 'var(--surface-variant)', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Equipment</div>
                <select className="cul-select" value={newType} onChange={e => setNewType(e.target.value)}>
                  {EQUIPMENT_KEYS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Make</div>
                <input
                  className="cul-input"
                  placeholder="e.g. Cosori"
                  value={newMake}
                  onChange={e => setNewMake(e.target.value)}
                />
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Model</div>
                <input
                  className="cul-input"
                  placeholder="e.g. Pro Gen 2"
                  value={newModel}
                  onChange={e => setNewModel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addItem()}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="cul-btn cul-btn-primary cul-btn-sm" onClick={addItem} disabled={saving}>
                {saving ? 'Saving...' : 'Add'}
              </button>
              <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="cul-btn cul-btn-secondary" onClick={() => setAdding(true)}>
            <Icon name="add" size={15} /> Add Equipment
          </button>
        )}
      </div>
    </div>
  )
}

function EquipmentItemCard({ item, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [make, setMake]   = useState(item.make  || '')
  const [model, setModel] = useState(item.model || '')

  const save = async () => {
    await onUpdate(item.id, make, model)
    setEditing(false)
  }

  return (
    <div className="stock-item">
      <Icon name="kitchen" size={20} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{item.label}</div>
        {!editing ? (
          (item.make || item.model) && (
            <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 2 }}>
              {[item.make, item.model].filter(Boolean).join(' · ')}
            </div>
          )
        ) : (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              className="cul-input"
              style={{ flex: 1, minWidth: 100 }}
              placeholder="Make"
              value={make}
              onChange={e => setMake(e.target.value)}
            />
            <input
              className="cul-input"
              style={{ flex: 1, minWidth: 100 }}
              placeholder="Model"
              value={model}
              onChange={e => setModel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
            />
            <button className="cul-btn cul-btn-primary cul-btn-sm" onClick={save}>Save</button>
            <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => {
              setMake(item.make || '')
              setModel(item.model || '')
              setEditing(false)
            }}>Cancel</button>
          </div>
        )}
      </div>
      {!editing && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setEditing(true)}>
            <Icon name="edit" size={14} />
          </button>
          <button className="cul-btn cul-btn-danger cul-btn-sm" onClick={() => onDelete(item.id)}>
            <Icon name="delete" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
