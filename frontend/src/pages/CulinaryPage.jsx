import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@context/AuthContext.jsx'
import BarcodeScanner from '@components/BarcodeScanner.jsx'
import AddRecipeModal from '@components/AddRecipeModal.jsx'
import ShoppingListTab from '@components/ShoppingListTab.jsx'
import CookPlanTab from '@components/CookPlanTab.jsx'
import AppliancePanel from '@components/AppliancePanel.jsx'
import { API_BASE } from '@lib/api.js'

/**
 * CulinaryPage — Google Home / AI-First Kitchen Hub
 * -----------------------------------------------------------------------------
 * 4 Consolidated Pillars:
 * 1. Cookbook: Recipe library, dietary tags, AI substitutions, one-tap "Cook Now".
 * 2. Meal Plan: 7-day dinner calendar, household proposals/voting, and batch prep staging.
 * 3. Cook Guide: Start-to-finish guided cooking companion (mise en place, active timers, focus mode).
 * 4. Pantry & Groceries: Multi-store shopping list, stockroom inventory, and barcode scanning.
 */

// -- Helpers --
function StarRating({ value, size = 14, onChange }) {
  const [hover, setHover] = useState(0)
  const filled = hover || value || 0
  return (
    <div className="rs-flex" style={{ gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button 
          key={n} 
          style={{ all: 'unset', cursor: onChange ? 'pointer' : 'default', fontSize: size, color: filled >= n ? 'var(--primary)' : 'var(--md-outline-variant)' }}
          onMouseEnter={() => onChange && setHover(n)}
          onMouseLeave={() => onChange && setHover(0)}
          onClick={(e) => {
            e.stopPropagation();
            if (onChange) onChange(n);
          }}
        >
          {filled >= n ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}

function PrepShoppingListPanel({ items, sessionId, onPushed, api }) {
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(null);

  const handleWalmartExport = async () => {
    setExporting(true);
    try {
      const res = await api.post('/walmart/export', {});
      setExportResult(res);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      const res = await api.post(`/prep/${sessionId}/shopping-list/push`, {});
      setPushed(res.added);
      if (res.added > 0) onPushed?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="rs-card">
       <div className="rs-card-inner rs-p-5">
          <div className="rs-card-head rs-mb-5">
             <span className="rs-card-label rs-fw-900 rs-c-accent">WHAT THIS SESSION NEEDS</span>
          </div>
          <div>
             <div className="rs-flex rs-flex-col rs-gap-3">
                {items.length === 0 ? (
                  <div className="rs-card-meta">All provisions available in pantry.</div>
                ) : items.map((it, idx) => (
                  <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: it._from_stockroom ? 'rgba(255,184,108,0.1)' : 'var(--md-surface-container-low)' }}>
                    <span className="rs-mono rs-fw-800 rs-c-accent" style={{ minWidth: 60 }}>{it.qty} {it.unit}</span>
                    <span className="rs-grow">{it.name}</span>
                    {it._from_stockroom && <span className="rs-card-label rs-type-tiny" style={{ color: '#FFB86C' }}>STOCK LOW</span>}
                  </div>
                ))}
             </div>
             
             <div className="rs-mt-5 rs-flex rs-flex-col rs-gap-3">
                  <button className="rs-pill rs-w-full rs-justify-center" onClick={handlePush} disabled={pushing || !sessionId || items.length === 0 || pushed !== null}>
                    <span className="material-symbols-rounded">playlist_add</span>
                    {pushed !== null
                      ? (pushed === 0 ? 'ALREADY ON THE LIST' : `ADDED ${pushed} TO THE LIST`)
                      : (pushing ? 'ADDING...' : 'PUSH TO SHOPPING LIST')}
                  </button>
                  {exportResult ? (
                    <div className="rs-p-4" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade80', borderRadius: 'var(--md-shape-sm)' }}>
                      <div className="rs-mb-2 rs-c-nominal rs-fw-800">EXPORT SUCCESSFUL</div>
                      {exportResult.cart_url ? (
                         <a href={exportResult.cart_url} target="_blank" rel="noreferrer" className="rs-btn-primary" style={{ display: 'inline-flex', textDecoration: 'none' }}>OPEN WALMART CART</a>
                      ) : (
                         <div>No items were mapped to Walmart products.</div>
                      )}
                      {exportResult.unmapped?.length > 0 && (
                         <div className="rs-mt-3 rs-type-small rs-c-critical">Unmapped: {exportResult.unmapped.join(', ')}</div>
                      )}
                    </div>
                  ) : (
                    <button className="rs-btn-primary rs-w-full rs-justify-center" onClick={handleWalmartExport} disabled={exporting || items.length === 0}>
                      <span className="material-symbols-rounded">shopping_cart_checkout</span>
                      {exporting ? 'EXPORTING...' : 'EXPORT TO WALMART CART'}
                    </button>
                  )}
               </div>
           </div>
        </div>
    </div>
  )
}

function PrepAdjuster({ entry, recipe, api, onUpdate }) {
  const [scaling, setScaling] = useState(false)
  const [target, setTarget] = useState(entry.servings_target || recipe?.servings || 4)
  const [system, setSystem] = useState('')

  const handleScale = async () => {
    setScaling(true)
    try {
      const result = await api.post(`/recipes/${entry.recipe_id}/scale`, { target_servings: parseInt(target), prefer_system: system || null })
      await api.put(`/prep/${entry.session_id}/recipes/${entry.id}/scale`, { target_servings: result.target_servings, scaled_ingredients: result.scaled_ingredients })
      onUpdate()
    } finally {
      setScaling(false)
    }
  }

  return (
    <div className="rs-mt-3 rs-flex rs-gap-3 rs-items-center rs-flex-wrap" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container-low)', borderRadius: 'var(--md-shape-md)' }}>
       <span className="rs-card-label">SCALE TO</span>
       <input className="rs-pill rs-text-center" type="number" style={{ width: 60, border: 'none', background: 'rgba(0,0,0,0.2)' }} value={target} onChange={e => setTarget(e.target.value)} />
       <select className="rs-pill" style={{ border: 'none', background: 'rgba(0,0,0,0.2)' }} value={system} onChange={e => setSystem(e.target.value)}>
          <option value="">ORIGINAL</option>
          <option value="imperial">IMPERIAL</option>
          <option value="metric">METRIC</option>
       </select>
       <button className="rs-btn-primary rs-type-tiny" style={{ height: 32 }} onClick={handleScale} disabled={scaling}>{scaling ? 'SCALING...' : 'APPLY'}</button>
    </div>
  )
}

function RecipeDetailModal({ recipe, onClose, onSave, onDelete, onCook, api }) {
  const [isEditing, setIsEditing] = useState(false)
  const [edited, setEdited] = useState({ ...recipe, tags_str: (recipe.tags || []).join(', ') })
  const [saving, setSaving] = useState(false)
  const [targetEquipment, setTargetEquipment] = useState('')
  const [translating, setTranslating] = useState(false)
  const modalRef = React.useRef(null)

  const handleTranslateEquipment = async () => {
    if (!targetEquipment.trim()) return;
    setTranslating(true);
    try {
      const res = await api.post(`/recipes/${recipe.id}/translate-equipment`, { equipment: targetEquipment });
      const newSteps = res.rewritten_steps;
      const updated = await api.put(`/recipes/${recipe.id}`, { ...recipe, steps: newSteps });
      onSave(updated);
      setTargetEquipment('');
    } catch (err) {
      alert(err.message);
    } finally {
      setTranslating(false);
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    if (modalRef.current) {
      const focusable = modalRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length) focusable[0].focus();
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await api.put(`/recipes/${recipe.id}`, edited)
      onSave(updated)
      setIsEditing(false)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const applySubstitute = async (bannedName, sub) => {
    const newIngredients = edited.ingredients.map(ing => {
      if (ing.name.toLowerCase().includes(bannedName.toLowerCase())) {
        return { ...ing, name: sub }
      }
      return ing
    })
    const newSteps = edited.steps.map(step => step.replace(new RegExp(bannedName, 'gi'), sub))
    const updated = { ...edited, ingredients: newIngredients, steps: newSteps }
    setEdited(updated)
    const saved = await api.put(`/recipes/${recipe.id}`, updated)
    onSave(saved)
  }

  const addIngredient = () => setEdited({ ...edited, ingredients: [...(edited.ingredients || []), { qty: '', unit: '', name: '' }] })
  const updateIngredient = (index, field, value) => {
    const updated = [...(edited.ingredients || [])]
    updated[index] = { ...updated[index], [field]: value }
    setEdited({ ...edited, ingredients: updated })
  }
  const removeIngredient = (index) => {
    const updated = [...(edited.ingredients || [])]
    updated.splice(index, 1)
    setEdited({ ...edited, ingredients: updated })
  }

  const addStep = () => setEdited({ ...edited, steps: [...(edited.steps || []), ''] })
  const updateStep = (index, value) => {
    const updated = [...(edited.steps || [])]
    updated[index] = value
    setEdited({ ...edited, steps: updated })
  }
  const removeStep = (index) => {
    const updated = [...(edited.steps || [])]
    updated.splice(index, 1)
    setEdited({ ...edited, steps: updated })
  }

  return (
    <div className="rs-flex rs-items-center rs-justify-center" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)' }} onClick={onClose}>
       <div ref={modalRef} tabIndex="-1" className="rs-card is-elev animate-page-in rs-flex rs-flex-col rs-clip" style={{ width: 'min(95%, 720px)', maxHeight: '90vh', animationDuration: '250ms', transformOrigin: 'center' }} onClick={e => e.stopPropagation()}>
          <div className="rs-card-inner rs-grow rs-p-6" style={{ overflowY: 'auto' }}>
             <div className="rs-card-head rs-mb-5" style={{ padding: 'var(--rs-space-2) var(--rs-space-2) 0 var(--rs-space-2)' }}>
                <span className="rs-card-label rs-fw-900 rs-c-accent">{isEditing ? 'EDIT RECIPE' : recipe.meal_type.toUpperCase()}</span>
                <div className="rs-flex rs-gap-3">
                   <button className="rs-pill" onClick={() => setIsEditing(!isEditing)}>
                      <span className="material-symbols-rounded">{isEditing ? 'close' : 'edit'}</span>
                      {isEditing ? 'CANCEL' : 'EDIT'}
                   </button>
                   <button className="rs-pill" onClick={onClose}>
                      <span className="material-symbols-rounded">close</span>
                   </button>
                </div>
             </div>

             {isEditing ? (
               <div className="rs-flex rs-flex-col rs-gap-5">
                  <div className="rs-chat-input-container" style={{ background: 'var(--md-surface-container-low)' }}>
                     <input className="rs-chat-input" value={edited.title} onChange={e => setEdited({ ...edited, title: e.target.value })} placeholder="RECIPE TITLE" style={{ lineHeight: 1.7 }} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                     <input className="rs-pill" value={edited.tags_str || ''} onChange={e => setEdited({ ...edited, tags_str: e.target.value, tags: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) })} placeholder="DIETARY TAGS (e.g. keto, low-sodium)" style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: 'var(--rs-space-3) var(--rs-space-4)', gridColumn: '1 / -1' }} />
                     <select className="rs-pill" value={edited.meal_type} onChange={e => setEdited({ ...edited, meal_type: e.target.value })} style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: 'var(--rs-space-3) var(--rs-space-4)' }}>
                        {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Other'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                     </select>
                     <select className="rs-pill" value={edited.primary_protein || ''} onChange={e => setEdited({ ...edited, primary_protein: e.target.value || null })} style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: 'var(--rs-space-3) var(--rs-space-4)' }}>
                        <option value="">NO PRIMARY PROTEIN</option>
                        {['Chicken', 'Beef', 'Pork', 'Fish', 'Seafood', 'Turkey', 'Lamb', 'Vegetarian'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                     </select>
                  </div>
                  
                  <div>
                    <div className="rs-card-label rs-mb-4 rs-flex rs-justify-between">
                      PROVISIONS
                      <button className="rs-pill rs-type-tiny" onClick={addIngredient}>ADD PROVISION</button>
                    </div>
                    <div className="rs-flex rs-flex-col rs-gap-3">
                      {edited.ingredients?.map((ing, i) => (
                        <div key={i} className="rs-flex rs-gap-2">
                          <input className="rs-pill rs-text-center" style={{ width: 60, background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="QTY" value={ing.qty} onChange={e => updateIngredient(i, 'qty', e.target.value)} />
                          <input className="rs-pill" style={{ width: 80, background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="UNIT" value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} />
                          <input className="rs-pill rs-grow" style={{ background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="INGREDIENT NAME" value={ing.name} onChange={e => updateIngredient(i, 'name', e.target.value)} />
                          <button className="rs-pill rs-p-2 rs-c-error" onClick={() => removeIngredient(i)}><span className="material-symbols-rounded">delete</span></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="rs-card-label rs-mb-4 rs-flex rs-justify-between">
                      EXECUTION SEQUENCE
                      <button className="rs-pill rs-type-tiny" onClick={addStep}>ADD STEP</button>
                    </div>
                    <div className="rs-flex rs-flex-col rs-gap-3">
                      {edited.steps?.map((step, i) => (
                        <div key={i} className="rs-flex rs-gap-3 rs-items-start">
                          <span className="rs-mt-3 rs-muted rs-mono rs-fw-900">{String(i+1).padStart(2, '0')}</span>
                          <textarea 
                            className="rs-pill rs-grow" 
                            style={{ minHeight: 60, borderRadius: 'var(--md-shape-lg)', background: 'var(--md-surface-container-low)', border: 'none', padding: 'var(--rs-space-3) var(--rs-space-4)', lineHeight: 1.7, resize: 'vertical' }} 
                            value={step} 
                            onChange={e => updateStep(i, e.target.value)} 
                          />
                          <button className="rs-pill rs-p-2 rs-mt-2 rs-c-error" onClick={() => removeStep(i)}><span className="material-symbols-rounded">delete</span></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rs-mt-6 rs-p-4" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--md-shape-md)' }}>
                     <div className="rs-card-label rs-mb-3">ADAPT EQUIPMENT</div>
                     <div className="rs-flex rs-gap-3">
                       <input className="rs-pill rs-grow" style={{ background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="E.g., Air Fryer, Instant Pot, Dutch Oven" value={targetEquipment} onChange={e => setTargetEquipment(e.target.value)} />
                       <button className="rs-btn-primary" onClick={handleTranslateEquipment} disabled={translating || !targetEquipment.trim()}>
                         <span className="material-symbols-rounded">sync_alt</span>
                         {translating ? 'TRANSLATING...' : 'TRANSLATE'}
                       </button>
                     </div>
                  </div>

                  <div className="rs-flex rs-gap-3 rs-mt-3">
                     <button className="rs-btn-primary rs-grow" onClick={handleSave} disabled={saving}>{saving ? 'SAVING...' : 'SAVE CHANGES'}</button>
                     <button className="rs-pill rs-c-error" onClick={() => { if(confirm('Delete this recipe?')) onDelete(recipe.id) }}>DELETE</button>
                  </div>
               </div>
             ) : (
               <>
                 <div className="rs-card-value rs-mb-2 rs-fw-800" style={{ fontSize: '1.75rem' }}>{recipe.title}</div>
                 {recipe.tags && recipe.tags.length > 0 && (
                   <div className="rs-flex rs-gap-2 rs-flex-wrap rs-mb-3">
                     {recipe.tags.map((t, i) => <span key={i} className="rs-card-label" style={{ background: 'var(--primary)', color: 'var(--bg-base)', padding: 'var(--rs-space-1) var(--rs-space-2)', borderRadius: 'var(--md-shape-xs)' }}>{t.toUpperCase()}</span>)}
                   </div>
                 )}
                 <div className="rs-mb-6"><StarRating value={recipe.rating} size={20} onChange={async (v) => {
                    const updated = await api.patch(`/recipes/${recipe.id}/rate`, { rating: v });
                    onSave(updated);
                 }} /></div>

                 {recipe.blacklisted?.length > 0 && (
                   <div className="rs-card rs-mb-6" style={{ borderColor: 'var(--md-error)', background: 'rgba(239,68,68,0.05)' }}>
                      <div className="rs-card-inner">
                         <div className="rs-card-label rs-mb-3 rs-c-error">BANNED INGREDIENTS DETECTED</div>
                         <div className="rs-flex rs-flex-col rs-gap-2">
                            {recipe.blacklisted.map((b, i) => (
                              <div key={i} className="rs-flex rs-items-center rs-gap-3 rs-type-body">
                                 <span className="rs-c-error rs-fw-700">{b.name}</span>
                                 {b.substitute && (
                                   <>
                                     <span style={{ opacity: 0.7 }}>→</span>
                                     <span className="rs-c-accent rs-fw-600">{b.substitute}</span>
                                     <button className="rs-pill rs-type-tiny" style={{ padding: '2px 10px' }} onClick={() => applySubstitute(b.name, b.substitute)}>APPLY SUBSTITUTE</button>
                                   </>
                                 )}
                              </div>
                            ))}
                         </div>
                      </div>
                   </div>
                 )}

                 <div className="rs-gap-7" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                   <div>
                     <div className="rs-card-label rs-mb-4">PROVISIONS</div>
                     <div className="rs-flex rs-flex-col rs-gap-3">
                       {recipe.ingredients?.map((ing, i) => (
                         <div key={i} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'var(--md-surface-container-low)' }}>
                           <span className="rs-mono rs-fw-800" style={{ minWidth: 40 }}>{ing.qty}</span>
                           <span className="rs-grow">{ing.unit} {ing.name}</span>
                         </div>
                       ))}
                     </div>
                   </div>
                   <div>
                     <div className="rs-card-label rs-mb-4">EXECUTION SEQUENCE</div>
                     <div className="rs-flex rs-flex-col rs-gap-5">
                       {recipe.steps.map((s, i) => (
                         <div key={i} className="rs-flex rs-gap-4 rs-items-start">
                            <span className="rs-mt-1 rs-muted rs-mono rs-fw-900">{String(i+1).padStart(2, '0')}</span>
                            <div className="rs-grow" style={{ lineHeight: 1.6 }}>{s}</div>
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
                 
                 <div className="rs-mt-7 rs-flex rs-gap-3 rs-flex-wrap">
                    <button
                      className="gh-cook-btn-next rs-justify-center"
                      style={{ flex: 2, height: 48 }}
                      onClick={() => {
                        onClose();
                        onCook(recipe);
                      }}
                    >
                      <span className="material-symbols-rounded">skillet</span>
                      <span>COOK NOW IN GUIDE</span>
                    </button>
                    <button className="rs-pill rs-grow" onClick={async () => {
                       await api.post('/dinner/suggest', { recipe_id: recipe.id });
                       alert('Suggestion broadcast to household.');
                    }}>SUGGEST DINNER</button>
                 </div>
               </>
             )}
          </div>
       </div>
    </div>
  )
}

function useApi(token) {
  const headers = useCallback((extra = {}) => ({
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra
  }), [token])
  const _handle = async (r) => {
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.detail || r.statusText)
    return data
  }
  return useMemo(() => ({
    get: (p) => fetch(`/api/culinary${p}`, { headers: headers() }).then(_handle),
    post: (p, b) => fetch(`/api/culinary${p}`, { method: 'POST', headers: headers(), body: JSON.stringify(b) }).then(_handle),
    patch: (p, b) => fetch(`/api/culinary${p}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(b) }).then(_handle),
    put: (p, b) => fetch(`/api/culinary${p}`, { method: 'PUT', headers: headers(), body: JSON.stringify(b) }).then(_handle),
    delete: (p) => fetch(`/api/culinary${p}`, { method: 'DELETE', headers: headers() }).then(_handle),
  }), [headers])
}

export default function CulinaryPage({ setAction }) {
  const { token } = useAuth()
  const api = useApi(token)
  
  // 4 Consolidated Pillars: 'cookbook' | 'plan' | 'cook' | 'pantry'
  const [activeTab, setActiveTab] = useState('cookbook')
  const [cookbookSubTab, setCookbookSubTab] = useState('recipes') // 'recipes' | 'banned'
  const [planSubTab, setPlanSubTab] = useState('dinner')         // 'dinner' | 'prep'
  const [pantrySubTab, setPantrySubTab] = useState('list')       // 'list' | 'stockroom'
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [scannerMode, setScannerMode] = useState(null)
  const [showAddRecipe, setShowAddRecipe] = useState(false)
  const [recipes, setRecipes] = useState([])
  const [stock, setStock] = useState([])
  const [equipment, setEquipment] = useState([])
  const [banned, setBanned] = useState([])
  const [mealPlan, setMealPlan] = useState([])
  const [proposals, setProposals] = useState([])
  const [activePrep, setActivePrep] = useState(null)
  const [groceryNonce, setGroceryNonce] = useState(0)
  const [mealCookNonce, setMealCookNonce] = useState(0)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [filterProtein, setFilterProtein] = useState('ALL')
  const [sortMode, setSortMode] = useState('NEWEST')
  
  const [activeRecipe, setActiveRecipe] = useState(null)
  const [prepView, setPrepView] = useState('recipes')
  const [prepList, setPrepList] = useState(null)
  const [adjustItem, setAdjustItem] = useState(null)

  const [recommendations, setRecommendations] = useState({})
  const [recLoading, setRecLoading] = useState({})

  // Ensure bottom action bar is not hijacking the global floating dock!
  useEffect(() => {
    if (setAction) setAction(null);
  }, [setAction])

  // Dynamic Proteins
  const uniqueProteins = useMemo(() => {
    return ['ALL', ...new Set(recipes.map(r => r.primary_protein).filter(Boolean))].sort()
  }, [recipes])

  // Fetch Logic
  const fetchData = useCallback(async (tab) => {
    setLoading(true)
    try {
      if (tab === 'cookbook' || tab === 'library') {
        const data = await api.get('/recipes')
        setRecipes(Array.isArray(data) ? data : [])
        setBanned(await api.get('/household/banned'))
      }
      if (tab === 'pantry' || tab === 'stockroom') {
        setStock(await api.get('/stockroom'))
      }
      if (tab === 'plan' || tab === 'dinner' || tab === 'prep') {
        setProposals(await api.get('/dinner'));
        const d = new Date();
        const d2 = new Date(d);
        d2.setDate(d.getDate() - d.getDay()); // Sunday start
        const start = d2.toISOString().split('T')[0];
        setMealPlan(await api.get(`/meal-plan?start=${start}`));
        try { setActivePrep(await api.get('/prep')) } catch { setActivePrep(null) }
      }
      if (tab === 'cook') {
        try { setActivePrep(await api.get('/prep')) } catch { setActivePrep(null) }
        const recData = await api.get('/recipes')
        setRecipes(Array.isArray(recData) ? recData : [])
        try {
          const eqData = await api.get('/household/equipment')
          setEquipment(Array.isArray(eqData) ? eqData : [])
        } catch { setEquipment([]) }
        const d = new Date();
        const d2 = new Date(d);
        d2.setDate(d.getDate() - d.getDay());
        const start = d2.toISOString().split('T')[0];
        setMealPlan(await api.get(`/meal-plan?start=${start}`));
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { fetchData(activeTab) }, [activeTab, fetchData])

  useEffect(() => {
    if (!activePrep) return
    if (prepView !== 'list' || prepList) return
    let live = true
    api.get(`/prep/${activePrep.id}/shopping-list`)
      .then(res => { if (live) setPrepList(res.shopping_list || []) })
      .catch(err => { if (live) setError(err.message) })
    return () => { live = false }
  }, [api, activePrep, prepView, prepList])

  useEffect(() => {
    if (!token) return;
    const baseHost = API_BASE ? API_BASE.replace(/^http(s)?:\/\//, '') : window.location.host;
    const protocol = (API_BASE.startsWith('https://') || window.location.protocol === 'https:') ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${baseHost}/api/culinary/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (['stockroom_updated', 'stockroom_deleted', 'stockroom_created'].includes(msg.event)) {
          if (activeTab === 'pantry') fetchData('pantry');
        }
        if (msg.event === 'meal_plan_updated' || msg.event === 'dinner_updated') {
          if (activeTab === 'plan') fetchData('plan');
        }
        if (msg.event === 'grocery_updated') {
          setGroceryNonce(n => n + 1);
        }
        if (msg.event === 'meal_cook_updated') {
          if (activeTab === 'cook') fetchData('cook');
          setMealCookNonce(n => n + 1);
        }
      } catch (e) {}
    };
    return () => ws.close();
  }, [token, activeTab, fetchData]);

  const getRecommendations = async (id, name) => {
    setRecLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await api.post('/household/banned/recommend', { ingredient: name })
      setRecommendations(prev => ({ ...prev, [id]: res }))
    } finally {
      setRecLoading(prev => ({ ...prev, [id]: false }))
    }
  }

  // Quick Action: Stage recipe and jump directly to Cook Guide
  const handleCookRecipe = async (recipe) => {
    try {
      let session = activePrep
      if (!session) {
        session = await api.post('/prep', { label: `Cook: ${recipe.title}` })
        setActivePrep(session)
      }
      await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipe.id, servings: recipe.servings || 4 })
      setActiveTab('cook')
      setMealCookNonce(n => n + 1)
    } catch (err) {
      alert('Could not start cook guide: ' + err.message)
    }
  }

  // Quick Action: Cook today's planned dinner
  const handleCookTodayDinner = async (entry) => {
    if (!entry?.recipe_id) return
    try {
      const res = await api.post('/meal-plan/create-prep-session', { entry_ids: [entry.id] })
      if (res.status === 'ok') {
        setActivePrep(await api.get('/prep'))
        setActiveTab('cook')
        setMealCookNonce(n => n + 1)
      }
    } catch (err) {
      alert('Could not start dinner cook: ' + err.message)
    }
  }

  // ---------------------------------------------------------------------------
  // PILLAR 1: COOKBOOK RENDERER
  // ---------------------------------------------------------------------------
  const renderCookbook = () => (
    <div className="rs-flex rs-flex-col rs-gap-5">
      {/* Sub-toggle: Recipes vs Dietary Rules */}
      <div className="rs-flex rs-justify-between rs-items-center rs-flex-wrap rs-gap-3">
        <div className="rs-flex rs-gap-2">
          <button
            className={`gh-kitchen-nav-btn ${cookbookSubTab === 'recipes' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setCookbookSubTab('recipes')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>menu_book</span>
            <span>All Recipes ({recipes.length})</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${cookbookSubTab === 'banned' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setCookbookSubTab('banned')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>block</span>
            <span>Dietary Rules ({banned.length})</span>
          </button>
        </div>

        {cookbookSubTab === 'recipes' && (
          <button
            className="gh-cook-btn-next rs-type-small"
            style={{ flex: 'none', height: 42, padding: '0 var(--rs-space-5)' }}
            onClick={() => setShowAddRecipe(true)}
          >
            <span className="material-symbols-rounded">add</span>
            <span>Add Recipe</span>
          </button>
        )}
      </div>

      {cookbookSubTab === 'recipes' ? (
        <>
          {/* Search & Filter Bar */}
          <div className="gh-card" style={{ padding: 'var(--rs-space-4) var(--rs-space-5)' }}>
            <div className="rs-flex rs-gap-4 rs-items-center rs-flex-wrap">
              <div className="rs-flex rs-items-center rs-gap-3" style={{ flex: 2, minWidth: 220, background: 'rgba(255,255,255,0.06)', padding: 'var(--rs-space-2) var(--rs-space-4)', borderRadius: 'var(--md-shape-full)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <span className="material-symbols-rounded rs-muted" style={{ fontSize: 20 }}>search</span>
                <input
                  className="rs-w-full rs-type-small rs-c-fg" style={{ all: 'unset' }}
                  placeholder="Search recipes, ingredients..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="rs-flex rs-gap-2 rs-flex-wrap">
                <select className="rs-pill rs-type-tiny" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
                  <option value="ALL">ALL MEALS</option>
                  {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill rs-type-tiny" value={filterProtein} onChange={e => setFilterProtein(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
                  {uniqueProteins.map(p => <option key={p} value={p}>{p === 'ALL' ? 'ALL PROTEINS' : p.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill rs-type-tiny" value={sortMode} onChange={e => setSortMode(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>
                  <option value="NEWEST">NEWEST</option>
                  <option value="RATING">TOP RATED</option>
                </select>
              </div>
            </div>
          </div>

          {/* Recipes Tactile Cards Grid */}
          <div className="rs-card-flow" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
            {recipes
              .filter(r => r.title.toLowerCase().includes(search.toLowerCase()))
              .filter(r => filterType === 'ALL' || r.meal_type === filterType)
              .filter(r => filterProtein === 'ALL' || r.primary_protein === filterProtein)
              .sort((a, b) => sortMode === 'RATING' ? (b.rating || 0) - (a.rating || 0) : new Date(b.created_at || 0) - new Date(a.created_at || 0))
              .map(r => (
              <div key={r.id} className="rs-card is-tappable animate-page-in rs-clip" style={{ padding: 0, animationDuration: '300ms' }} onClick={() => setActiveRecipe(r)}>
                <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
                  <div className="rs-w-full rs-relative rs-clip" style={{ aspectRatio: '16/10', background: 'var(--md-surface-container-highest)' }}>
                    {r.image_url ? (
                      <img src={r.image_url} alt="" className="rs-w-full rs-h-full" style={{ objectFit: 'cover' }} />
                    ) : (
                      <div className="rs-w-full rs-flex rs-items-center rs-justify-center rs-h-full" style={{ opacity: 0.15 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '4.5rem' }}>restaurant</span>
                      </div>
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 65%)' }} />
                    <div style={{ position: 'absolute', bottom: 14, left: 16 }}>
                      <StarRating value={r.rating} size={16} />
                    </div>
                  </div>
                  <div className="rs-p-5">
                    <div className="rs-flex rs-justify-between rs-items-center rs-mb-2">
                      <span className="rs-type-micro rs-fw-800 rs-c-primary" style={{ textTransform: 'uppercase' }}>
                        {r.meal_type}
                      </span>
                      <button
                        className="gh-glance-action rs-type-micro"
                        style={{ padding: 'var(--rs-space-1) var(--rs-space-3)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCookRecipe(r);
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 16 }}>skillet</span>
                        <span>Cook</span>
                      </button>
                    </div>
                    <div className="rs-fw-800 rs-c-fg" style={{ fontSize: '1.45rem', lineHeight: 1.3 }}>{r.title}</div>
                    <div className="rs-mt-4 rs-flex rs-gap-4 rs-type-small rs-muted">
                      <span>{r.primary_protein?.toUpperCase() || 'NO PROTEIN'}</span>
                      <span>·</span>
                      <span className="rs-mono">{r.servings} SERVINGS</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Dietary Restrictions & AI Substitutes View */
        <div className="rs-card-flow">
          {banned.map(item => (
            <div key={item.id} className="rs-card animate-page-in rs-p-5" style={{ animationDuration: '300ms' }}>
              <div className="rs-card-inner">
                <div className="rs-card-head rs-mb-3">
                  <span className="rs-card-label rs-c-error rs-fw-900">RESTRICTION</span>
                  <div className="rs-flex rs-gap-2">
                    <button className="rs-pill" onClick={() => getRecommendations(item.id, item.name)} disabled={recLoading[item.id]}>
                      <span className="material-symbols-rounded">psychology</span>
                      {recLoading[item.id] ? 'Thinking...' : 'AI Recommend'}
                    </button>
                    <button className="rs-pill" onClick={async () => { await api.delete(`/household/banned/${item.id}`); fetchData('cookbook'); }}>
                      <span className="material-symbols-rounded">delete</span>
                    </button>
                  </div>
                </div>
                <div className="rs-card-value" style={{ fontSize: '1.5rem' }}>{item.name}</div>
                {item.substitute && <div className="rs-card-meta rs-mt-2">PREFERRED SUBSTITUTE: <span className="rs-c-primary rs-fw-800">{item.substitute.toUpperCase()}</span></div>}
                
                {recommendations[item.id] && (
                  <div className="rs-mt-5 rs-flex rs-flex-col rs-gap-2">
                    <div className="rs-card-label">AI SUGGESTIONS</div>
                    {recommendations[item.id].map((rec, idx) => (
                      <div key={idx} className="rs-pill rs-pointer" style={{ justifyContent: 'flex-start', background: 'rgba(255,255,255,0.04)' }} onClick={async () => {
                        await api.patch(`/household/banned/${item.id}`, { substitute: rec.name });
                        fetchData('cookbook');
                      }}>
                        <span className="rs-fw-700 rs-c-primary" style={{ marginRight: 'var(--rs-space-3)' }}>{rec.name}</span>
                        <span className="rs-type-tiny" style={{ opacity: 0.8 }}>{rec.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // PILLAR 2: MEAL PLAN RENDERER (Weekly Dinners & Batch Prep)
  // ---------------------------------------------------------------------------
  const renderMealPlan = () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Sunday
    
    const week = [];
    for (let i = 0; i < 7; i++) {
       const cd = new Date(d);
       cd.setDate(cd.getDate() + i);
       const dateStr = cd.toISOString().split('T')[0];
       const entry = mealPlan.find(m => m.plan_date.startsWith(dateStr));
       week.push({ dayName: days[i], dateStr, entry });
    }

    return (
      <div className="rs-flex rs-flex-col rs-gap-5">
        {/* Sub-toggle: Dinner Calendar vs Batch Prep */}
        <div className="rs-flex rs-gap-2">
          <button
            className={`gh-kitchen-nav-btn ${planSubTab === 'dinner' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setPlanSubTab('dinner')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>calendar_month</span>
            <span>7-Day Dinners</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${planSubTab === 'prep' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setPlanSubTab('prep')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>set_meal</span>
            <span>Batch Prep Staging</span>
            {activePrep && <span className="gh-live-dot" />}
          </button>
        </div>

        {planSubTab === 'dinner' ? (
          <>
            {/* Week Schedule Card */}
            <div className="gh-card">
              <div className="rs-flex rs-justify-between rs-items-center rs-mb-4 rs-flex-wrap rs-gap-3">
                <div>
                  <h3 className="rs-m-0 rs-type-h3 rs-fw-700 rs-c-fg">This Week's Dinner Menu</h3>
                  <div className="rs-type-tiny rs-muted">Household dinner calendar and ingredient procurement</div>
                </div>
                <div className="rs-flex rs-gap-2">
                  <button className="gh-glance-action" onClick={async () => {
                    await api.post('/meal-plan/shop-this-week');
                    alert('Added missing ingredients to Shopping List!');
                    setGroceryNonce(n => n + 1);
                  }}>
                    <span className="material-symbols-rounded">shopping_cart</span>
                    <span>Shop This Week</span>
                  </button>
                  <button className="gh-glance-action" onClick={async () => {
                    const entryIds = mealPlan.filter(e => e.status === 'planned' && e.recipe_id).map(e => e.id);
                    if (entryIds.length === 0) return alert('No planned recipes this week.');
                    const res = await api.post('/meal-plan/create-prep-session', { entry_ids: entryIds });
                    if (res.status === 'ok') {
                      fetchData('plan');
                      setPlanSubTab('prep');
                    }
                  }}>
                    <span className="material-symbols-rounded">kitchen</span>
                    <span>Stage Batch Prep</span>
                  </button>
                </div>
              </div>

              {/* 7 Days Row */}
              <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                {week.map(w => {
                  const isToday = w.dateStr === new Date().toISOString().split('T')[0];
                  return (
                    <div key={w.dateStr} className="rs-p-4 rs-flex rs-flex-col rs-justify-between" style={{
                      background: isToday ? 'rgba(0, 229, 255, 0.08)' : (w.entry ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'),
                      borderRadius: 'var(--md-shape-lg)',
                      border: isToday ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                      minHeight: 120,
                    }}>
                      <div>
                        <div className="rs-mb-2 rs-type-small rs-fw-800" style={{ color: isToday ? '#00e5ff' : 'rgba(220,230,245,0.75)' }}>
                          {w.dayName.toUpperCase()} {isToday && '· TODAY'}
                        </div>
                        {w.entry ? (
                          <>
                            <div className="rs-type-body rs-c-fg" style={{ fontWeight: 750, lineHeight: 1.35 }}>
                              {w.entry.recipe_title || w.entry.label || 'Planned'}
                            </div>
                            <div className="rs-mt-2 rs-type-micro rs-fw-700" style={{ color: w.entry.status === 'cooked' ? '#4ade80' : '#00e5ff' }}>
                              {w.entry.status.toUpperCase()}
                            </div>
                          </>
                        ) : (
                          <div className="rs-muted rs-type-tiny" style={{ fontStyle: 'italic' }}>Open</div>
                        )}
                      </div>

                      {isToday && w.entry?.recipe_id && (
                        <button
                          className="gh-cook-btn-next rs-mt-3 rs-w-full rs-justify-center rs-type-micro"
                          style={{ height: 34 }}
                          onClick={() => handleCookTodayDinner(w.entry)}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: 15 }}>skillet</span>
                          <span>Cook Today</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Dinner Proposals & Voting */}
            {proposals.length > 0 && (
              <div className="gh-card">
                <h3 className="rs-type-body rs-fw-700 rs-c-fg" style={{ margin: '0 0 var(--rs-space-4) 0' }}>
                  Household Dinner Proposals
                </h3>
                <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                  {proposals.map(p => (
                    <div key={p.id} className="rs-card animate-page-in rs-p-5" style={{ border: p.status === 'approved' ? '1px solid #00e5ff' : '1px solid rgba(255,255,255,0.1)' }}>
                      <div className="rs-card-inner">
                        <div className="rs-flex rs-justify-between rs-items-center rs-mb-2">
                          <span className="rs-type-micro rs-fw-800" style={{ color: p.status === 'approved' ? '#00e5ff' : 'inherit' }}>
                            {p.status.toUpperCase()} PROPOSAL
                          </span>
                          <div className="rs-flex rs-gap-2">
                            <span className="rs-pill rs-type-micro rs-c-nominal" style={{ padding: '2px 8px', background: 'rgba(74,222,128,0.1)' }}>{p.votes_yes.length} YES</span>
                            <span className="rs-pill rs-type-micro rs-c-critical" style={{ padding: '2px 8px', background: 'rgba(248,113,113,0.1)' }}>{p.votes_no.length} NO</span>
                          </div>
                        </div>
                        <div className="rs-mb-4 rs-type-h3 rs-fw-800 rs-c-fg">
                          {p.recipe?.title}
                        </div>
                        <div className="rs-flex rs-gap-2">
                          <button className="rs-btn-primary rs-grow rs-type-tiny" style={{ height: 36 }} onClick={async () => {
                            await api.post(`/dinner/${p.id}/vote`, { vote: 'yes' });
                            fetchData('plan');
                          }}>APPROVE</button>
                          <button className="rs-pill rs-grow rs-type-tiny rs-c-error" style={{ height: 36 }} onClick={async () => {
                            await api.post(`/dinner/${p.id}/vote`, { vote: 'no' });
                            fetchData('plan');
                          }}>VETO</button>
                          <button className="rs-pill" style={{ height: 36, padding: '0 var(--rs-space-3)' }} onClick={async () => {
                            await api.delete(`/dinner/${p.id}`);
                            fetchData('plan');
                          }}><span className="material-symbols-rounded">close</span></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Batch Prep Staging View */
          <div className="rs-flex rs-flex-col rs-gap-4">
            {!activePrep ? (
              <div className="gh-card rs-text-center rs-p-7">
                <h3 className="rs-type-h3 rs-c-fg" style={{ margin: '0 0 var(--rs-space-2) 0' }}>No Active Prep Session</h3>
                <p className="rs-mb-5 rs-muted rs-type-small">
                  Stage multiple dishes to cook concurrently with synchronized timing.
                </p>
                <button className="gh-cook-btn-next" style={{ display: 'inline-flex', padding: '0 var(--rs-space-5)' }} onClick={async () => {
                  await api.post('/prep', { label: 'New Session' });
                  fetchData('plan');
                }}>Start Prep Session</button>
              </div>
            ) : (
              <div className="gh-card">
                <div className="rs-flex rs-justify-between rs-items-center rs-mb-5">
                  <div>
                    <h3 className="rs-m-0 rs-type-h3 rs-fw-800 rs-c-fg">
                      Active Prep: {activePrep.label || 'Multi-Dish Meal'}
                    </h3>
                    <div className="rs-type-tiny rs-muted">
                      {activePrep.recipes?.length || 0} dishes staged
                    </div>
                  </div>
                  <div className="rs-flex rs-gap-3">
                    <button
                      className="gh-cook-btn-next rs-type-small"
                      style={{ height: 42, padding: '0 var(--rs-space-5)' }}
                      onClick={() => setActiveTab('cook')}
                    >
                      <span className="material-symbols-rounded">skillet</span>
                      <span>Start Cook Guide</span>
                    </button>
                    <button className="rs-pill" onClick={async () => {
                      if (confirm('Complete and clear this prep session?')) {
                        await api.post(`/prep/${activePrep.id}/complete`);
                        fetchData('plan');
                      }
                    }}>Finish Session</button>
                  </div>
                </div>

                <div className="rs-flex rs-flex-col rs-gap-3">
                  {(activePrep.recipes || []).map((pr, i) => (
                    <div key={i} className="rs-p-4" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--md-shape-lg)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="rs-flex rs-justify-between rs-items-center">
                        <div className="rs-type-body rs-fw-700 rs-c-fg">{pr.recipe_title}</div>
                        <button className="rs-pill rs-c-error" onClick={async () => {
                          await api.delete(`/prep/${activePrep.id}/recipes/${pr.entry_id}`);
                          fetchData('plan');
                        }}><span className="material-symbols-rounded">remove_circle</span></button>
                      </div>
                      <PrepAdjuster entry={pr} api={api} onUpdate={() => fetchData('plan')} />
                    </div>
                  ))}
                </div>

                {/* Staged vs Needs inline toggle */}
                <div className="rs-flex rs-gap-2 rs-mt-5">
                  <button
                    className={`gh-kitchen-nav-btn ${prepView === 'recipes' ? 'is-active' : ''}`}
                    style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
                    onClick={() => setPrepView('recipes')}
                  >
                    <span className="material-symbols-rounded">list_alt</span>
                    <span>Staged Recipes</span>
                  </button>
                  <button
                    className={`gh-kitchen-nav-btn ${prepView === 'list' ? 'is-active' : ''}`}
                    style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
                    onClick={() => setPrepView('list')}
                  >
                    <span className="material-symbols-rounded">shopping_cart</span>
                    <span>Needed Ingredients</span>
                  </button>
                </div>

                {prepView === 'list' && (
                  <div className="rs-mt-4">
                    {prepList ? (
                      <PrepShoppingListPanel
                        items={prepList}
                        sessionId={activePrep.id}
                        api={api}
                        onPushed={() => { setGroceryNonce(n => n + 1); setActiveTab('pantry') }}
                      />
                    ) : (
                      <div className="rs-card-meta rs-p-5 rs-text-center">Calculating ingredient requirements…</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // PILLAR 4: PANTRY & GROCERIES RENDERER
  // ---------------------------------------------------------------------------
  const renderPantry = () => (
    <div className="rs-flex rs-flex-col rs-gap-5">
      {/* Sub-toggle: Groceries vs Stockroom */}
      <div className="rs-flex rs-justify-between rs-items-center rs-flex-wrap rs-gap-3">
        <div className="rs-flex rs-gap-2">
          <button
            className={`gh-kitchen-nav-btn ${pantrySubTab === 'list' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setPantrySubTab('list')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>shopping_cart</span>
            <span>Grocery List</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${pantrySubTab === 'stockroom' ? 'is-active' : ''}`}
            style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', fontSize: 'var(--rs-fs-tiny)' }}
            onClick={() => setPantrySubTab('stockroom')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>inventory_2</span>
            <span>Pantry Stockroom ({stock.length})</span>
          </button>
        </div>

        <button
          className="gh-glance-action"
          onClick={() => setScannerMode('deplete')}
        >
          <span className="material-symbols-rounded">barcode_scanner</span>
          <span>Scan Barcode</span>
        </button>
      </div>

      {pantrySubTab === 'list' ? (
        <ShoppingListTab api={api} refreshKey={groceryNonce} />
      ) : (
        /* Stockroom Inventory Cards */
        <div className="rs-card-flow" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {stock.map(item => (
            <div key={item.id} className="rs-card is-wide animate-page-in" style={{ animationDuration: '300ms' }}>
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <span className="rs-card-label rs-fw-900" style={{ color: item.quantity <= item.min_quantity ? '#f87171' : '#4ade80' }}>
                    <span className="rs-mono rs-type-h3 rs-fw-800">{item.quantity.toFixed(2)}</span> IN STOCK
                  </span>
                  <span className="rs-card-label" style={{ opacity: 0.7 }}>{item.brand?.toUpperCase()}</span>
                </div>
                <div className="rs-card-value rs-fw-800 rs-c-fg" style={{ fontSize: '1.6rem' }}>{item.name}</div>
                <div className="rs-mt-5 rs-flex rs-gap-3">
                  <button className="rs-pill is-active rs-grow" onClick={() => setAdjustItem(item)}>ADJUST</button>
                  <button className="rs-pill" onClick={() => {
                    localStorage.setItem('rs-chat-intent', JSON.stringify({ text: `River, what is our stock level for ${item.name}?`, docId: null }));
                    window.dispatchEvent(new Event('rs-navigate-chat'));
                  }}>ASK RIVER</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // MAIN RENDER CONTAINER
  // ---------------------------------------------------------------------------
  return (
    <div className="gh-kitchen-stage animate-fade-in">
      {/* Header */}
      <div className="rs-foyer-head rs-mb-5">
        <h1 className="rs-greeting rs-fw-800 rs-c-fg" style={{ fontSize: '2.5rem', letterSpacing: '-0.02em' }}>Kitchen</h1>
        <div className="rs-greeting-sub rs-mt-2 rs-type-body rs-c-fg">Cookbook, meal plans, autonomous cooking guides & groceries.</div>
      </div>

      {/* Top Google Home Category Nav Bar (Sub-navigation) */}
      <div className="gh-kitchen-nav-bar">
        <button
          className={`gh-kitchen-nav-btn ${activeTab === 'cookbook' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('cookbook')}
        >
          <span className="material-symbols-rounded">menu_book</span>
          <span>Cookbook</span>
        </button>
        <button
          className={`gh-kitchen-nav-btn ${activeTab === 'plan' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          <span className="material-symbols-rounded">calendar_month</span>
          <span>Meal Plan</span>
        </button>
        <button
          className={`gh-kitchen-nav-btn ${activeTab === 'cook' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('cook')}
        >
          <span className="material-symbols-rounded">skillet</span>
          <span>Cook Guide</span>
          {activePrep && <span className="gh-live-dot" />}
        </button>
        <button
          className={`gh-kitchen-nav-btn ${activeTab === 'pantry' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('pantry')}
        >
          <span className="material-symbols-rounded">local_grocery_store</span>
          <span>Pantry & Groceries</span>
        </button>
      </div>

      {/* Modals */}
      {showAddRecipe && (
        <AddRecipeModal
          token={token}
          onClose={() => setShowAddRecipe(false)}
          onSaved={() => fetchData('cookbook')}
        />
      )}

      {scannerMode && (
        <BarcodeScanner 
           onDetected={async (code) => {
             const mode = scannerMode;
             setScannerMode(null);
             if (mode === 'deplete') {
               try {
                 await api.post('/stockroom/deplete', { barcode: code });
                 const stockRes = await api.get('/stockroom');
                 setStock(stockRes);
               } catch(e) {
                 alert('Deplete failed: ' + e.message);
               }
             } else {
               setSearch(code);
             }
           }} 
           onClose={() => setScannerMode(null)} 
        />
      )}

      {error ? (
        <div className="rs-card is-wide" style={{ borderColor: 'var(--md-error)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-label rs-c-error">KITCHEN ERROR</div>
            <div className="rs-card-meta">{error}</div>
          </div>
        </div>
      ) : (
        <div className="animate-page-in" style={{ animationDuration: '300ms' }}>
          {activeTab === 'cookbook' && renderCookbook()}
          {activeTab === 'plan' && renderMealPlan()}
          {activeTab === 'cook' && (
            <CookPlanTab
              api={api}
              activePrep={activePrep}
              refreshNonce={mealCookNonce}
              recipes={recipes}
              mealPlan={mealPlan}
              equipment={equipment}
              onRefreshPrep={() => fetchData('plan')}
              setActiveTab={setActiveTab}
            />
          )}
          {activeTab === 'pantry' && renderPantry()}
        </div>
      )}

      {activeRecipe && (
        <RecipeDetailModal
          recipe={activeRecipe}
          onClose={() => setActiveRecipe(null)}
          onSave={(updated) => {
            setRecipes(recipes.map(r => r.id === updated.id ? updated : r))
            setActiveRecipe(updated)
          }}
          onDelete={async (id) => {
            await api.delete(`/recipes/${id}`)
            setRecipes(recipes.filter(r => r.id !== id))
            setActiveRecipe(null)
          }}
          onCook={handleCookRecipe}
          api={api}
        />
      )}

      {adjustItem && (
        <div className="rs-modal-overlay">
          <div className="rs-modal" style={{ maxWidth: 400 }}>
            <div className="rs-card-label rs-mb-4">ADJUST STOCK: {adjustItem.name.toUpperCase()}</div>
            <div className="rs-flex rs-gap-3 rs-mb-5 rs-items-center rs-justify-center">
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: Math.max(0, adjustItem.quantity - 0.25)})}>-</button>
              <div className="rs-grow rs-text-center rs-fw-800" style={{ fontSize: '1.75rem' }}>{adjustItem.quantity.toFixed(2)}</div>
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: adjustItem.quantity + 0.25})}>+</button>
            </div>
            <div className="rs-flex rs-gap-3">
              <button className="rs-btn-primary rs-grow" onClick={async () => {
                await api.put(`/stockroom/${adjustItem.id}`, { quantity: adjustItem.quantity });
                setAdjustItem(null);
                fetchData('pantry');
              }}>SAVE</button>
              <button className="rs-pill" onClick={() => setAdjustItem(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
