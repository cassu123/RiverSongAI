import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useWebSocket } from '../hooks/useWebSocket.js'
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

const COOKING_METHOD_OPTIONS = ['Air Fryer', 'Instant Pot', 'Slow Cooker', 'Oven', 'Stovetop', 'Grill', 'Sous Vide', 'Dutch Oven', 'Wok']

// Map cooking method label → household equipment key
const METHOD_TO_EQ_KEY = {
  'Air Fryer':  'air_fryer',
  'Instant Pot': 'instant_pot',
  'Slow Cooker': 'slow_cooker',
  'Grill':      'grill',
  'Sous Vide':  'sous_vide',
  'Dutch Oven': 'dutch_oven',
  'Wok':        'wok',
}

function smartCookingMethod(equipmentNeeded = [], ownedEquipment = {}) {
  for (const method of equipmentNeeded) {
    const key = METHOD_TO_EQ_KEY[method]
    if (!key) return method               // no special equipment needed (Oven, Stovetop)
    if (ownedEquipment[key]) return method // user owns this equipment
  }
  return equipmentNeeded[0] || 'Oven'
}

// ── Star Rating ───────────────────────────────────────────────────────────────

function StarRating({ value, onChange, size = 16 }) {
  const [hovered, setHovered] = useState(0)
  const filled = hovered || value || 0
  return (
    <div
      className="star-rating"
      onMouseLeave={() => onChange && setHovered(0)}
      style={{ fontSize: size }}
    >
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          className={`star-btn${filled >= n ? ' filled' : ''}`}
          style={{ cursor: onChange ? 'pointer' : 'default' }}
          onMouseEnter={() => onChange && setHovered(n)}
          onClick={e => { e.stopPropagation(); onChange && onChange(n) }}
          tabIndex={onChange ? 0 : -1}
        >
          ★
        </button>
      ))}
    </div>
  )
}

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

  const patch = useCallback(
    (path, body) => fetch(`/api/culinary${path}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body),
    }).then(r => r.json()),
    [headers]
  )

  const del = useCallback(
    (path) => fetch(`/api/culinary${path}`, { method: 'DELETE', headers: headers() }),
    [headers]
  )

  return { get, post, put, patch, del }
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
    { key: 'library',   label: 'Library',          icon: 'menu_book' },
    { key: 'dinner',    label: "What's for Dinner", icon: 'dinner_dining' },
    { key: 'stockroom', label: 'Stockroom',         icon: 'warehouse' },
    { key: 'prep',      label: 'Prep Deck',         icon: 'set_meal' },
    { key: 'walmart',   label: 'Walmart Export',    icon: 'shopping_cart' },
    { key: 'settings',  label: 'Equipment',         icon: 'kitchen' },
  ]

  return (
    <div className="culinary-page page-wrap">
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>HOME</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>CULINARY</span>
          </div>
          <h1 className="page-title">Culinary</h1>
          <p className="page-subtitle">
            <span className="page-subtitle-dot" />
            Recipe library, prep planning &amp; household meal voting
          </p>
        </div>
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

      {tab === 'library'   && <LibraryTab      api={api} household={household} />}
      {tab === 'dinner'    && <WhatsDinnerTab  api={api} token={token} />}
      {tab === 'stockroom' && <StockroomTab    api={api} household={household} />}
      {tab === 'prep'      && <PrepDeckTab     api={api} household={household} />}
      {tab === 'walmart'   && <WalmartTab      api={api} household={household} />}
      {tab === 'settings'  && <EquipmentTab    api={api} />}
    </div>
  )
}

// ── Library Tab ───────────────────────────────────────────────────────────────

function LibraryTab({ api }) {
  const [recipes, setRecipes]   = useState([])
  const [selected, setSelected] = useState(null)
  const [showIngest, setShowIngest] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [sort, setSort]         = useState('newest') // newest | rating

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

  const rateRecipe = async (recipeId, rating) => {
    const updated = await api.patch(`/recipes/${recipeId}/rate`, { rating })
    setRecipes(prev => prev.map(r => r.id === recipeId ? { ...r, rating: updated.rating } : r))
    if (selected?.id === recipeId) setSelected(prev => ({ ...prev, rating: updated.rating }))
  }

  const suggestForDinner = async (recipeId) => {
    try {
      await api.post('/dinner/suggest', { recipe_id: recipeId })
      alert('Recipe added to the dinner queue!')
    } catch {
      alert('Could not suggest recipe. Try again.')
    }
  }

  const sorted = [...recipes].sort((a, b) => {
    if (sort === 'rating') return (b.rating || 0) - (a.rating || 0)
    return new Date(b.created_at) - new Date(a.created_at)
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="cul-btn cul-btn-primary" onClick={() => setShowIngest(true)}>
          <Icon name="upload_file" size={16} /> Ingest PDF / URL
        </button>
        <button className="cul-btn cul-btn-secondary" onClick={() => setShowCreate(true)}>
          <Icon name="add" size={16} /> Manual Entry
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)' }}>Sort:</span>
          {[['newest', 'Newest'], ['rating', 'Top Rated']].map(([key, label]) => (
            <button
              key={key}
              className={`cul-btn cul-btn-sm ${sort === key ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {recipes.length === 0 && !loading && (
        <div className="cul-empty">
          <Icon name="menu_book" size={48} />
          No recipes yet. Ingest a PDF or URL to get started.
        </div>
      )}

      <div className="cul-grid-3">
        {sorted.map(r => (
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
              <div style={{ marginBottom: 6 }}>
                <StarRating
                  value={r.rating}
                  onChange={rating => rateRecipe(r.id, rating)}
                  size={14}
                />
              </div>
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
              <button
                className="cul-btn cul-btn-secondary cul-btn-sm"
                style={{ marginTop: 10, width: '100%' }}
                onClick={e => { e.stopPropagation(); suggestForDinner(r.id) }}
              >
                <Icon name="dinner_dining" size={13} /> Suggest for Dinner
              </button>
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
          api={api}
          onClose={() => { setSelected(null); load() }}
          onDelete={() => deleteRecipe(selected.id)}
          onSendToPrep={() => sendToPrep(selected.id)}
          onRate={rateRecipe}
          onSuggestDinner={() => suggestForDinner(selected.id)}
          onSave={async (id, data) => {
            const updated = await api.put(`/recipes/${id}`, data)
            setRecipes(prev => prev.map(r => r.id === id ? updated : r))
            setSelected(updated)
          }}
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

function RecipeDetailModal({ recipe, onClose, onDelete, onSendToPrep, onRate, onSuggestDinner, onSave }) {
  const [localRating, setLocalRating] = useState(recipe.rating || 0)
  const [editing, setEditing]         = useState(false)
  const [saving, setSaving]           = useState(false)

  // Edit fields — kept in sync with recipe prop via startEdit()
  const [editTitle,     setEditTitle]     = useState('')
  const [editMealType,  setEditMealType]  = useState('')
  const [editProtein,   setEditProtein]   = useState('')
  const [editServings,  setEditServings]  = useState(4)
  const [editImageUrl,  setEditImageUrl]  = useState('')
  const [editIngs,      setEditIngs]      = useState([])
  const [editSteps,     setEditSteps]     = useState([])
  const [editEquipment, setEditEquipment] = useState([])

  const startEdit = () => {
    setEditTitle(recipe.title || '')
    setEditMealType(recipe.meal_type || 'Other')
    setEditProtein(recipe.primary_protein || '')
    setEditServings(recipe.servings || 4)
    setEditImageUrl(recipe.image_url || '')
    setEditIngs(recipe.ingredients?.length ? recipe.ingredients.map(i => ({ ...i })) : [{ name: '', qty: '', unit: '' }])
    setEditSteps(recipe.steps?.length ? [...recipe.steps] : [''])
    setEditEquipment(recipe.equipment_needed?.length ? [...recipe.equipment_needed] : [''])
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!editTitle.trim() || !onSave) return
    setSaving(true)
    await onSave(recipe.id, {
      title:            editTitle.trim(),
      meal_type:        editMealType,
      primary_protein:  editProtein.trim() || null,
      servings:         parseInt(editServings) || 4,
      image_url:        editImageUrl.trim() || null,
      ingredients:      editIngs.filter(i => i.name?.trim()),
      steps:            editSteps.filter(s => s.trim()),
      equipment_needed: editEquipment.filter(e => e.trim()),
    })
    setSaving(false)
    setEditing(false)
  }

  const handleRate = (rating) => {
    setLocalRating(rating)
    onRate && onRate(recipe.id, rating)
  }

  const setIng = (i, field, val) =>
    setEditIngs(prev => prev.map((x, j) => j === i ? { ...x, [field]: val } : x))
  const removeIng   = (i) => setEditIngs(prev => prev.filter((_, j) => j !== i))
  const removeStep  = (i) => setEditSteps(prev => prev.filter((_, j) => j !== i))
  const removeEq    = (i) => setEditEquipment(prev => prev.filter((_, j) => j !== i))

  const blacklistSet = new Set((recipe.blacklisted || []).map(b => b.name?.toLowerCase()))

  return (
    <div className="cul-modal-backdrop" onClick={editing ? undefined : onClose}>
      <div className="cul-modal cul-modal-recipe" onClick={e => e.stopPropagation()}>

        {/* ── Hero (always visible, image URL editable in edit mode) ── */}
        <div className="recipe-hero-wrap">
          {(editing ? editImageUrl : recipe.image_url)
            ? <img className="recipe-hero-img" src={editing ? editImageUrl : recipe.image_url} alt={recipe.title} />
            : <div className="recipe-hero-placeholder"><Icon name="restaurant_menu" size={48} /></div>
          }
          <div className="recipe-hero-gradient" />
          <button className="cul-modal-close recipe-hero-close" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>

          {/* ══ VIEW MODE ══════════════════════════════════════════════ */}
          {!editing && (
            <>
              <h2 style={{ marginTop: 16 }}>{recipe.title}</h2>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <StarRating value={localRating} onChange={handleRate} size={22} />
                {localRating > 0 && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>{localRating} / 5</span>
                )}
              </div>

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
                  <li key={i} className={`ing-chip${blacklistSet.has(ing.name?.toLowerCase()) ? ' blacklisted' : ''}`}>
                    {ing.qty} {ing.unit} {ing.name}
                  </li>
                ))}
              </ul>

              <div className="cul-section-title">Steps</div>
              <ol className="steps-list">
                {(recipe.steps || []).map((step, i) => <li key={i}>{step}</li>)}
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
                <button className="cul-btn cul-btn-secondary" onClick={startEdit}>
                  <Icon name="edit" size={15} /> Edit
                </button>
                <button className="cul-btn cul-btn-primary" onClick={onSendToPrep}>
                  <Icon name="set_meal" size={15} /> Send to Prep Deck
                </button>
                {onSuggestDinner && (
                  <button className="cul-btn cul-btn-secondary" onClick={onSuggestDinner}>
                    <Icon name="dinner_dining" size={15} /> Suggest for Dinner
                  </button>
                )}
                <button className="cul-btn cul-btn-danger" onClick={onDelete}>
                  <Icon name="delete" size={15} /> Delete
                </button>
                <button className="cul-btn cul-btn-secondary" onClick={onClose}>Close</button>
              </div>
            </>
          )}

          {/* ══ EDIT MODE ══════════════════════════════════════════════ */}
          {editing && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 14px' }}>
                <Icon name="edit" size={18} />
                <span style={{ fontFamily: 'var(--font-display, monospace)', fontSize: '1rem', color: 'var(--primary)', letterSpacing: '0.06em' }}>
                  EDITING
                </span>
              </div>

              {/* Title */}
              <div className="cul-input-row">
                <label>Title</label>
                <input className="cul-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              </div>

              {/* Meal type + Protein */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Meal Type</div>
                  <select className="cul-select" style={{ width: '100%' }} value={editMealType} onChange={e => setEditMealType(e.target.value)}>
                    {MEAL_TYPES.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Protein</div>
                  <input className="cul-input" placeholder="Chicken, Beef…" value={editProtein} onChange={e => setEditProtein(e.target.value)} />
                </div>
              </div>

              {/* Servings + Image URL */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flexBasis: 90 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Servings</div>
                  <input className="cul-input" type="number" min={1} value={editServings} onChange={e => setEditServings(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Image URL</div>
                  <input className="cul-input" placeholder="https://… (optional)" value={editImageUrl} onChange={e => setEditImageUrl(e.target.value)} />
                </div>
              </div>

              {/* Ingredients */}
              <div className="cul-section-title">Ingredients</div>
              {editIngs.map((ing, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 6, alignItems: 'center' }}>
                  <input className="cul-input" style={{ flex: 3 }} placeholder="Name" value={ing.name} onChange={e => setIng(i, 'name', e.target.value)} />
                  <input className="cul-input" style={{ flex: 1 }} placeholder="Qty" value={ing.qty} onChange={e => setIng(i, 'qty', e.target.value)} />
                  <input className="cul-input" style={{ flex: 1 }} placeholder="Unit" value={ing.unit} onChange={e => setIng(i, 'unit', e.target.value)} />
                  <button
                    className="cul-btn cul-btn-danger cul-btn-sm"
                    style={{ flexShrink: 0 }}
                    onClick={() => removeIng(i)}
                    disabled={editIngs.length === 1}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setEditIngs(p => [...p, { name: '', qty: '', unit: '' }])}>
                <Icon name="add" size={14} /> Add Ingredient
              </button>

              {/* Steps */}
              <div className="cul-section-title" style={{ marginTop: 16 }}>Steps</div>
              {editSteps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 6, alignItems: 'flex-start' }}>
                  <div style={{ flex: '0 0 22px', height: 22, marginTop: 10, background: 'var(--primary)', color: 'var(--on-primary, #000)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <textarea
                    className="cul-input"
                    style={{ flex: 1, minHeight: 52, resize: 'vertical' }}
                    value={step}
                    onChange={e => setEditSteps(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                  />
                  <button
                    className="cul-btn cul-btn-danger cul-btn-sm"
                    style={{ flexShrink: 0, marginTop: 4 }}
                    onClick={() => removeStep(i)}
                    disabled={editSteps.length === 1}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setEditSteps(p => [...p, ''])}>
                <Icon name="add" size={14} /> Add Step
              </button>

              {/* Equipment */}
              <div className="cul-section-title" style={{ marginTop: 16 }}>Equipment Needed</div>
              {editEquipment.map((eq, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                  <input className="cul-input" placeholder="e.g. Instant Pot" value={eq} onChange={e => setEditEquipment(prev => prev.map((x, j) => j === i ? e.target.value : x))} />
                  <button
                    className="cul-btn cul-btn-danger cul-btn-sm"
                    style={{ flexShrink: 0 }}
                    onClick={() => removeEq(i)}
                    disabled={editEquipment.length === 1}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
              <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setEditEquipment(p => [...p, ''])}>
                <Icon name="add" size={14} /> Add Equipment
              </button>

              {/* Save / Cancel */}
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button className="cul-btn cul-btn-primary" onClick={saveEdit} disabled={saving || !editTitle.trim()}>
                  {saving ? 'Saving…' : <><Icon name="check" size={15} /> Save Changes</>}
                </button>
                <button className="cul-btn cul-btn-secondary" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}

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

function PrepDeckTab({ api, household }) {
  const [session, setSession]           = useState(null)
  const [loading, setLoading]           = useState(true)
  const [recipeDetails, setRecipeDetails] = useState({}) // recipe_id → full recipe
  const [shoppingList, setShoppingList] = useState(null)
  const [staging, setStaging]           = useState(null)
  const [view, setView]                 = useState('overview') // overview | cooking | shopping | staging
  const [newLabel, setNewLabel]         = useState('')

  const ownedEquipment = household?.equipment || {}

  const loadSession = useCallback(() => {
    setLoading(true)
    api.get('/prep')
      .then(s => { setSession(s); setLoading(false) })
      .catch(() => { setSession(null); setLoading(false) })
  }, [api])

  useEffect(() => { loadSession() }, [loadSession])

  // Load full recipe details whenever session changes
  useEffect(() => {
    if (!session?.recipes?.length) return
    session.recipes.forEach(entry => {
      if (recipeDetails[entry.recipe_id]) return
      api.get(`/recipes/${entry.recipe_id}`)
        .then(r => setRecipeDetails(prev => ({ ...prev, [entry.recipe_id]: r })))
        .catch(() => {})
    })
  }, [session, api]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setRecipeDetails({})
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
      {/* Session header */}
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
            recipe={recipeDetails[entry.recipe_id] || null}
            api={api}
            ownedEquipment={ownedEquipment}
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
            className={`cul-btn ${view === 'cooking' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={() => setView('cooking')}
          >
            <Icon name="local_fire_department" size={15} /> Cooking Guide
          </button>
          <button
            className={`cul-btn ${view === 'shopping' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={loadShoppingList}
          >
            <Icon name="shopping_cart" size={15} /> Shopping List
          </button>
          <button
            className={`cul-btn ${view === 'staging' ? 'cul-btn-primary' : 'cul-btn-secondary'}`}
            onClick={loadStaging}
          >
            <Icon name="view_column" size={15} /> Staging Area
          </button>
        </div>
      )}

      {/* Overview */}
      {view === 'overview' && session.recipes.length > 0 && (
        <div className="cul-grid-2">
          {session.recipes.map(entry => {
            const recipe = recipeDetails[entry.recipe_id]
            const method = recipe ? smartCookingMethod(recipe.equipment_needed, ownedEquipment) : null
            const methodKey = method ? METHOD_TO_EQ_KEY[method] : null
            const owned = methodKey ? ownedEquipment[methodKey] : true
            return (
              <div key={entry.entry_id} className="cul-card" style={{ margin: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 4 }}>{entry.recipe_title}</div>
                {entry.servings_target && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 6 }}>
                    Target: {entry.servings_target} servings
                  </div>
                )}
                {recipe && (
                  <>
                    <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 6 }}>
                      {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
                      {recipe.steps.length > 0 && ` · ${recipe.steps.length} step${recipe.steps.length !== 1 ? 's' : ''}`}
                    </div>
                    {method && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99, background: owned ? 'var(--primary-container)' : 'var(--surface-variant)', color: owned ? 'var(--on-primary-container)' : 'var(--on-surface-variant)' }}>
                          {method}
                        </span>
                        {owned && <span style={{ fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>Recommended</span>}
                      </div>
                    )}
                  </>
                )}
                {!recipe && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)' }}>Loading details...</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Cooking Guide */}
      {view === 'cooking' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {session.recipes.map(entry => (
            <CookingGuideCard
              key={entry.entry_id}
              entry={entry}
              recipe={recipeDetails[entry.recipe_id] || null}
              api={api}
              ownedEquipment={ownedEquipment}
            />
          ))}
        </div>
      )}

      {/* Shopping List */}
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

      {/* Staging Area */}
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

// ── Cooking Guide Card ────────────────────────────────────────────────────────

function CookingGuideCard({ entry, recipe, api, ownedEquipment }) {
  const defaultMethod = recipe ? smartCookingMethod(recipe.equipment_needed, ownedEquipment) : 'Oven'
  const [method, setMethod]           = useState(defaultMethod)
  const [translating, setTranslating] = useState(false)
  const [steps, setSteps]             = useState(null)

  // Update method when recipe loads
  useEffect(() => {
    if (recipe) setMethod(smartCookingMethod(recipe.equipment_needed, ownedEquipment))
  }, [recipe, ownedEquipment]) // eslint-disable-line react-hooks/exhaustive-deps

  const displaySteps = steps || recipe?.steps || []
  const methodKey = METHOD_TO_EQ_KEY[method]
  const owned = !methodKey || ownedEquipment[methodKey]

  const translate = async () => {
    setTranslating(true)
    try {
      const result = await api.post(`/recipes/${entry.recipe_id}/translate-equipment`, { equipment: method })
      setSteps(result.rewritten_steps)
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div className="cul-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{entry.recipe_title}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="cul-select"
            value={method}
            onChange={e => { setMethod(e.target.value); setSteps(null) }}
            style={{ fontSize: '0.82rem' }}
          >
            {COOKING_METHOD_OPTIONS.map(m => (
              <option key={m} value={m}>{m}{METHOD_TO_EQ_KEY[m] && ownedEquipment[METHOD_TO_EQ_KEY[m]] ? ' ✓' : ''}</option>
            ))}
          </select>
          {!owned && (
            <span style={{ fontSize: '0.7rem', color: 'var(--on-surface-variant)' }}>not owned</span>
          )}
          <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={translate} disabled={translating || !recipe}>
            {translating ? 'Rewriting...' : `Rewrite for ${method}`}
          </button>
          {steps && (
            <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={() => setSteps(null)}>
              Original
            </button>
          )}
        </div>
      </div>

      {!recipe && (
        <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem' }}>Loading recipe...</div>
      )}

      {displaySteps.length > 0 && (
        <ol className="steps-list" style={{ fontSize: '0.88rem', margin: 0 }}>
          {displaySteps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      )}

      {recipe && displaySteps.length === 0 && (
        <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.85rem' }}>No steps recorded for this recipe.</div>
      )}
    </div>
  )
}

// ── Prep Recipe Card (with Adjuster + Cooking Method) ────────────────────────

function PrepRecipeCard({ entry, recipe, api, ownedEquipment, onRemove }) {
  const [expanded, setExpanded]       = useState(false)

  // Adjuster
  const [containers, setContainers]   = useState(8)
  const [contOz, setContOz]           = useState(8)
  const [scaling, setScaling]         = useState(false)
  const [scaleResult, setScaleResult] = useState(null)

  // Cooking Method — smart default from recipe equipment + owned equipment
  const [eqTarget, setEqTarget]           = useState(() => recipe ? smartCookingMethod(recipe.equipment_needed, ownedEquipment) : 'Oven')
  const [translating, setTranslating]     = useState(false)
  const [rewrittenSteps, setRewrittenSteps] = useState(null)

  useEffect(() => {
    if (recipe) setEqTarget(smartCookingMethod(recipe.equipment_needed, ownedEquipment))
  }, [recipe, ownedEquipment]) // eslint-disable-line react-hooks/exhaustive-deps

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
              {COOKING_METHOD_OPTIONS.map(m => (
                <option key={m} value={m}>{m}{METHOD_TO_EQ_KEY[m] && ownedEquipment[METHOD_TO_EQ_KEY[m]] ? ' ✓' : ''}</option>
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

// ── What's for Dinner Tab ─────────────────────────────────────────────────────

function WhatsDinnerTab({ api, token }) {
  const [proposals, setProposals]     = useState([])
  const [cookNowResult, setCookNowResult] = useState(null)
  const [loading, setLoading]         = useState(true)

  const load = useCallback(() => {
    api.get('/dinner')
      .then(data => { setProposals(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [api])

  useEffect(() => { load() }, [load])

  const proto    = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl    = token ? `${proto}://${window.location.host}/api/culinary/ws?token=${token}` : null
  const handleWs = useCallback((msg) => {
    if (msg.event === 'dinner_updated') setProposals(msg.data.proposals || [])
  }, [])
  useWebSocket(wsUrl || '', handleWs)

  const vote = async (proposalId, v) => {
    await api.post(`/dinner/${proposalId}/vote`, { vote: v })
    load()
  }

  const dismiss = async (proposalId) => {
    await api.del(`/dinner/${proposalId}`)
    load()
  }

  const cookNow = async (proposalId) => {
    const result = await api.post(`/dinner/${proposalId}/cook-now`, {})
    setCookNowResult(result)
    load()
  }

  const sendToPrep = async (recipeId, proposalId) => {
    try {
      const active = await api.get('/prep')
      await api.post(`/prep/${active.id}/add-recipe`, { recipe_id: recipeId })
    } catch {
      const session = await api.post('/prep', { label: 'Tonight\'s Dinner' })
      await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipeId })
    }
    await api.del(`/dinner/${proposalId}`)
    load()
  }

  if (loading) {
    return <div className="cul-empty"><Icon name="dinner_dining" size={48} />Loading...</div>
  }

  return (
    <div>
      <div className="cul-card-title" style={{ marginBottom: 16 }}>
        <Icon name="how_to_vote" size={20} /> Household Dinner Vote
      </div>

      {proposals.length === 0 && (
        <div className="cul-empty">
          <Icon name="dinner_dining" size={48} />
          No dinner suggestions yet. Open a recipe in the Library and click{' '}
          <strong>Suggest for Dinner</strong>.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {proposals.map(p => (
          <DinnerProposalCard
            key={p.id}
            proposal={p}
            onVoteYes={() => vote(p.id, 'yes')}
            onVoteNo={() => vote(p.id, 'no')}
            onDismiss={() => dismiss(p.id)}
            onCookNow={() => cookNow(p.id)}
            onSendToPrep={() => sendToPrep(p.recipe_id, p.id)}
          />
        ))}
      </div>

      {cookNowResult && (
        <CookNowModal result={cookNowResult} onClose={() => setCookNowResult(null)} />
      )}
    </div>
  )
}

function DinnerProposalCard({ proposal, onVoteYes, onVoteNo, onDismiss, onCookNow, onSendToPrep }) {
  const recipe   = proposal.recipe || {}
  const approved = proposal.status === 'approved'
  const yesCount = proposal.votes_yes?.length || 0
  const noCount  = proposal.votes_no?.length  || 0

  return (
    <div className={`dinner-card${approved ? ' dinner-card-approved' : ''}`}>
      {/* Recipe info */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {recipe.image_url ? (
          <img
            src={recipe.image_url}
            alt={recipe.title}
            className="dinner-card-thumb"
          />
        ) : (
          <div className="dinner-card-thumb dinner-card-thumb-placeholder">
            <Icon name="restaurant_menu" size={28} />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '1.05rem', marginBottom: 4 }}>
            {recipe.title || 'Unknown Recipe'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {recipe.meal_type && <span className="recipe-tag">{recipe.meal_type}</span>}
            {recipe.primary_protein && <span className="recipe-tag protein">{recipe.primary_protein}</span>}
            {recipe.servings && <span className="recipe-tag">{recipe.servings} srv</span>}
            {recipe.rating > 0 && (
              <span className="recipe-tag" style={{ color: 'var(--primary)' }}>
                {'★'.repeat(recipe.rating)}{'☆'.repeat(5 - recipe.rating)}
              </span>
            )}
          </div>
        </div>
        <button
          className="cul-btn cul-btn-secondary cul-btn-sm"
          onClick={onDismiss}
          title="Remove from queue"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      {/* Vote tally */}
      <div className="dinner-vote-row">
        <span className="dinner-vote-count yes">{yesCount} Yes</span>
        <span className="dinner-vote-count no">{noCount} No</span>
      </div>

      {/* Vote buttons */}
      {!approved && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="cul-btn vote-btn-yes" onClick={onVoteYes}>
            <Icon name="thumb_up" size={16} /> Yes, I'm feeling this
          </button>
          <button className="cul-btn vote-btn-no" onClick={onVoteNo}>
            <Icon name="thumb_down" size={16} /> No thanks
          </button>
        </div>
      )}

      {/* Execution menu — shown on approval */}
      {approved && (
        <div className="dinner-approved-banner">
          <Icon name="check_circle" size={18} />
          <span>Let's cook this! Choose how to proceed:</span>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="cul-btn cul-btn-primary" onClick={onCookNow}>
              <Icon name="skillet" size={15} /> Cook Now
            </button>
            <button className="cul-btn cul-btn-secondary" onClick={onSendToPrep}>
              <Icon name="set_meal" size={15} /> Send to Prep Deck
            </button>
            <button className="cul-btn vote-btn-no" onClick={onVoteNo}>
              <Icon name="thumb_down" size={15} /> Actually, no
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CookNowModal({ result, onClose }) {
  return (
    <div className="cul-modal-backdrop" onClick={onClose}>
      <div className="cul-modal" onClick={e => e.stopPropagation()}>
        <button className="cul-modal-close" onClick={onClose}><Icon name="close" /></button>
        <h2><Icon name="skillet" size={20} /> Cook Now — {result.title}</h2>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
          padding: '10px 14px', borderRadius: 8,
          background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
        }}>
          <Icon name="people" size={18} />
          <span style={{ fontSize: '0.9rem' }}>Scaled for <strong>{result.servings}</strong> servings</span>
        </div>

        <div className="cul-section-title">Shopping List</div>
        <ul className="prep-shopping-list">
          {(result.shopping_list || []).map((ing, i) => (
            <li key={i}>
              <span className="prep-shopping-qty">{ing.qty} {ing.unit}</span>
              <span>{ing.name}</span>
            </li>
          ))}
        </ul>

        {result.steps?.length > 0 && (
          <>
            <div className="cul-section-title" style={{ marginTop: 16 }}>Steps</div>
            <ol className="steps-list">
              {result.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </>
        )}

        <button className="cul-btn cul-btn-primary" style={{ marginTop: 16 }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

// ── Equipment Tab ─────────────────────────────────────────────────────────────

function EquipmentTab({ api }) {
  const [items, setItems]         = useState([])
  const [adding, setAdding]       = useState(false)
  const [newMake, setNewMake]     = useState('')
  const [newModel, setNewModel]   = useState('')
  const [preview, setPreview]     = useState(null)   // {label, types} from /identify
  const [identifying, setIdentifying] = useState(false)
  const [saving, setSaving]       = useState(false)

  const load = useCallback(() => {
    api.get('/household/equipment').then(setItems).catch(() => {})
  }, [api])

  useEffect(() => { load() }, [load])

  const identify = async () => {
    if (!newMake.trim() && !newModel.trim()) return
    setIdentifying(true)
    setPreview(null)
    try {
      const result = await api.post('/household/equipment/identify', {
        make: newMake.trim(),
        model: newModel.trim(),
      })
      setPreview(result)
    } catch {
      setPreview({ label: `${newMake} ${newModel}`.trim(), types: [] })
    } finally {
      setIdentifying(false)
    }
  }

  const addItem = async () => {
    if (saving) return
    setSaving(true)
    await api.post('/household/equipment', {
      make:  newMake.trim(),
      model: newModel.trim(),
    })
    setAdding(false)
    setNewMake('')
    setNewModel('')
    setPreview(null)
    setSaving(false)
    load()
  }

  const cancelAdd = () => {
    setAdding(false)
    setNewMake('')
    setNewModel('')
    setPreview(null)
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
          Enter the brand and model — the AI will identify what it is, including multifunctional devices.
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
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Brand</div>
                <input
                  className="cul-input"
                  placeholder="e.g. Instant Pot"
                  value={newMake}
                  onChange={e => { setNewMake(e.target.value); setPreview(null) }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Model</div>
                <input
                  className="cul-input"
                  placeholder="e.g. Duo 7-in-1"
                  value={newModel}
                  onChange={e => { setNewModel(e.target.value); setPreview(null) }}
                  onKeyDown={e => e.key === 'Enter' && !preview && identify()}
                />
              </div>
            </div>

            {preview && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--surface)', borderRadius: 8 }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', marginBottom: 4 }}>Detected</div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{preview.label}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {preview.types.length > 0
                    ? preview.types.map(t => (
                        <span key={t} style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99, background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}>
                          {EQUIPMENT_KEYS.find(k => k.key === t)?.label || t}
                        </span>
                      ))
                    : <span style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)' }}>No matching category — will still be saved.</span>
                  }
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {!preview ? (
                <button className="cul-btn cul-btn-primary cul-btn-sm" onClick={identify} disabled={identifying || (!newMake.trim() && !newModel.trim())}>
                  {identifying ? 'Identifying...' : 'Identify'}
                </button>
              ) : (
                <button className="cul-btn cul-btn-primary cul-btn-sm" onClick={addItem} disabled={saving}>
                  {saving ? 'Saving...' : 'Add'}
                </button>
              )}
              <button className="cul-btn cul-btn-secondary cul-btn-sm" onClick={cancelAdd}>
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

  const caps = item.capabilities || (item.equipment_type ? [item.equipment_type] : [])

  return (
    <div className="stock-item" style={{ alignItems: 'flex-start' }}>
      <Icon name="kitchen" size={20} style={{ marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{item.label}</div>
        {!editing ? (
          <>
            {(item.make || item.model) && (
              <div style={{ fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: 2 }}>
                {[item.make, item.model].filter(Boolean).join(' · ')}
              </div>
            )}
            {caps.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                {caps.map(t => (
                  <span key={t} style={{ fontSize: '0.7rem', padding: '2px 7px', borderRadius: 99, background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}>
                    {EQUIPMENT_KEYS.find(k => k.key === t)?.label || t}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <input
              className="cul-input"
              style={{ flex: 1, minWidth: 100 }}
              placeholder="Brand"
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
