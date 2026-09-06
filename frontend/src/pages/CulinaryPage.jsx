import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import BarcodeScanner from '../components/BarcodeScanner.jsx'
import AddRecipeModal from '../components/AddRecipeModal.jsx'
import ShoppingListTab from '../components/ShoppingListTab.jsx'
import CookPlanTab from '../components/CookPlanTab.jsx'
import AppliancePanel from '../components/AppliancePanel.jsx'
import { API_BASE } from '../lib/api.js'

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
    <div style={{ display: 'flex', gap: 2 }}>
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
       <div className="rs-card-inner" style={{ padding: 24 }}>
          <div className="rs-card-head" style={{ marginBottom: 20 }}>
             <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>WHAT THIS SESSION NEEDS</span>
          </div>
          <div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {items.length === 0 ? (
                  <div className="rs-card-meta">All provisions available in pantry.</div>
                ) : items.map((it, idx) => (
                  <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: it._from_stockroom ? 'rgba(255,184,108,0.1)' : 'var(--md-surface-container-low)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, minWidth: 60, color: 'var(--primary)' }}>{it.qty} {it.unit}</span>
                    <span style={{ flex: 1 }}>{it.name}</span>
                    {it._from_stockroom && <span className="rs-card-label" style={{ fontSize: '0.85rem', color: '#FFB86C' }}>STOCK LOW</span>}
                  </div>
                ))}
             </div>
             
             <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button className="rs-pill" style={{ width: '100%', justifyContent: 'center' }} onClick={handlePush} disabled={pushing || !sessionId || items.length === 0 || pushed !== null}>
                    <span className="material-symbols-rounded">playlist_add</span>
                    {pushed !== null
                      ? (pushed === 0 ? 'ALREADY ON THE LIST' : `ADDED ${pushed} TO THE LIST`)
                      : (pushing ? 'ADDING...' : 'PUSH TO SHOPPING LIST')}
                  </button>
                  {exportResult ? (
                    <div style={{ padding: 16, background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade80', borderRadius: 8 }}>
                      <div style={{ color: '#4ade80', fontWeight: 800, marginBottom: 8 }}>EXPORT SUCCESSFUL</div>
                      {exportResult.cart_url ? (
                         <a href={exportResult.cart_url} target="_blank" rel="noreferrer" className="rs-btn-primary" style={{ display: 'inline-flex', textDecoration: 'none' }}>OPEN WALMART CART</a>
                      ) : (
                         <div>No items were mapped to Walmart products.</div>
                      )}
                      {exportResult.unmapped?.length > 0 && (
                         <div style={{ marginTop: 12, fontSize: '0.95rem', color: '#f87171' }}>Unmapped: {exportResult.unmapped.join(', ')}</div>
                      )}
                    </div>
                  ) : (
                    <button className="rs-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleWalmartExport} disabled={exporting || items.length === 0}>
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
    <div style={{ marginTop: 12, padding: '12px 16px', background: 'var(--md-surface-container-low)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
       <span className="rs-card-label">SCALE TO</span>
       <input className="rs-pill" type="number" style={{ width: 60, border: 'none', background: 'rgba(0,0,0,0.2)', textAlign: 'center' }} value={target} onChange={e => setTarget(e.target.value)} />
       <select className="rs-pill" style={{ border: 'none', background: 'rgba(0,0,0,0.2)' }} value={system} onChange={e => setSystem(e.target.value)}>
          <option value="">ORIGINAL</option>
          <option value="imperial">IMPERIAL</option>
          <option value="metric">METRIC</option>
       </select>
       <button className="rs-btn-primary" style={{ height: 32, fontSize: '0.85rem' }} onClick={handleScale} disabled={scaling}>{scaling ? 'SCALING...' : 'APPLY'}</button>
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)' }} onClick={onClose}>
       <div ref={modalRef} tabIndex="-1" className="rs-card is-elev animate-page-in" style={{ width: 'min(95%, 720px)', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', animationDuration: '250ms', transformOrigin: 'center' }} onClick={e => e.stopPropagation()}>
          <div className="rs-card-inner" style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
             <div className="rs-card-head" style={{ marginBottom: 24, padding: '8px 8px 0 8px' }}>
                <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>{isEditing ? 'EDIT RECIPE' : recipe.meal_type.toUpperCase()}</span>
                <div style={{ display: 'flex', gap: 12 }}>
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
               <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div className="rs-chat-input-container" style={{ background: 'var(--md-surface-container-low)' }}>
                     <input className="rs-chat-input" value={edited.title} onChange={e => setEdited({ ...edited, title: e.target.value })} placeholder="RECIPE TITLE" style={{ lineHeight: 1.7 }} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                     <input className="rs-pill" value={edited.tags_str || ''} onChange={e => setEdited({ ...edited, tags_str: e.target.value, tags: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) })} placeholder="DIETARY TAGS (e.g. keto, low-sodium)" style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: '12px 16px', gridColumn: '1 / -1' }} />
                     <select className="rs-pill" value={edited.meal_type} onChange={e => setEdited({ ...edited, meal_type: e.target.value })} style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: '12px 16px' }}>
                        {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Other'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                     </select>
                     <select className="rs-pill" value={edited.primary_protein || ''} onChange={e => setEdited({ ...edited, primary_protein: e.target.value || null })} style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: '12px 16px' }}>
                        <option value="">NO PRIMARY PROTEIN</option>
                        {['Chicken', 'Beef', 'Pork', 'Fish', 'Seafood', 'Turkey', 'Lamb', 'Vegetarian'].map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                     </select>
                  </div>
                  
                  <div>
                    <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                      PROVISIONS
                      <button className="rs-pill" style={{ fontSize: '0.85rem' }} onClick={addIngredient}>ADD PROVISION</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {edited.ingredients?.map((ing, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8 }}>
                          <input className="rs-pill" style={{ width: 60, background: 'var(--md-surface-container-low)', border: 'none', textAlign: 'center' }} placeholder="QTY" value={ing.qty} onChange={e => updateIngredient(i, 'qty', e.target.value)} />
                          <input className="rs-pill" style={{ width: 80, background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="UNIT" value={ing.unit} onChange={e => updateIngredient(i, 'unit', e.target.value)} />
                          <input className="rs-pill" style={{ flex: 1, background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="INGREDIENT NAME" value={ing.name} onChange={e => updateIngredient(i, 'name', e.target.value)} />
                          <button className="rs-pill" style={{ padding: 8, color: 'var(--md-error)' }} onClick={() => removeIngredient(i)}><span className="material-symbols-rounded">delete</span></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="rs-card-label" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                      EXECUTION SEQUENCE
                      <button className="rs-pill" style={{ fontSize: '0.85rem' }} onClick={addStep}>ADD STEP</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {edited.steps?.map((step, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <span style={{ marginTop: 12, fontFamily: 'var(--font-mono)', opacity: 0.7, fontWeight: 900 }}>{String(i+1).padStart(2, '0')}</span>
                          <textarea 
                            className="rs-pill" 
                            style={{ flex: 1, minHeight: 60, borderRadius: 16, background: 'var(--md-surface-container-low)', border: 'none', padding: '12px 16px', lineHeight: 1.7, resize: 'vertical' }} 
                            value={step} 
                            onChange={e => updateStep(i, e.target.value)} 
                          />
                          <button className="rs-pill" style={{ padding: 8, color: 'var(--md-error)', marginTop: 8 }} onClick={() => removeStep(i)}><span className="material-symbols-rounded">delete</span></button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 32, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                     <div className="rs-card-label" style={{ marginBottom: 12 }}>ADAPT EQUIPMENT</div>
                     <div style={{ display: 'flex', gap: 12 }}>
                       <input className="rs-pill" style={{ flex: 1, background: 'var(--md-surface-container-low)', border: 'none' }} placeholder="E.g., Air Fryer, Instant Pot, Dutch Oven" value={targetEquipment} onChange={e => setTargetEquipment(e.target.value)} />
                       <button className="rs-btn-primary" onClick={handleTranslateEquipment} disabled={translating || !targetEquipment.trim()}>
                         <span className="material-symbols-rounded">sync_alt</span>
                         {translating ? 'TRANSLATING...' : 'TRANSLATE'}
                       </button>
                     </div>
                  </div>

                  <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                     <button className="rs-btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>{saving ? 'SAVING...' : 'SAVE CHANGES'}</button>
                     <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={() => { if(confirm('Delete this recipe?')) onDelete(recipe.id) }}>DELETE</button>
                  </div>
               </div>
             ) : (
               <>
                 <div className="rs-card-value" style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: 8 }}>{recipe.title}</div>
                 {recipe.tags && recipe.tags.length > 0 && (
                   <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                     {recipe.tags.map((t, i) => <span key={i} className="rs-card-label" style={{ background: 'var(--primary)', color: 'var(--bg-base)', padding: '4px 8px', borderRadius: 4 }}>{t.toUpperCase()}</span>)}
                   </div>
                 )}
                 <div style={{ marginBottom: 32 }}><StarRating value={recipe.rating} size={20} onChange={async (v) => {
                    const updated = await api.patch(`/recipes/${recipe.id}/rate`, { rating: v });
                    onSave(updated);
                 }} /></div>

                 {recipe.blacklisted?.length > 0 && (
                   <div className="rs-card" style={{ borderColor: 'var(--md-error)', background: 'rgba(239,68,68,0.05)', marginBottom: 32 }}>
                      <div className="rs-card-inner">
                         <div className="rs-card-label" style={{ color: 'var(--md-error)', marginBottom: 12 }}>BANNED INGREDIENTS DETECTED</div>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {recipe.blacklisted.map((b, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '1.05rem' }}>
                                 <span style={{ color: 'var(--md-error)', fontWeight: 700 }}>{b.name}</span>
                                 {b.substitute && (
                                   <>
                                     <span style={{ opacity: 0.7 }}>→</span>
                                     <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{b.substitute}</span>
                                     <button className="rs-pill" style={{ padding: '2px 10px', fontSize: '0.85rem' }} onClick={() => applySubstitute(b.name, b.substitute)}>APPLY SUBSTITUTE</button>
                                   </>
                                 )}
                              </div>
                            ))}
                         </div>
                      </div>
                   </div>
                 )}

                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 48 }}>
                   <div>
                     <div className="rs-card-label" style={{ marginBottom: 16 }}>PROVISIONS</div>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                       {recipe.ingredients?.map((ing, i) => (
                         <div key={i} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'var(--md-surface-container-low)' }}>
                           <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, minWidth: 40 }}>{ing.qty}</span>
                           <span style={{ flex: 1 }}>{ing.unit} {ing.name}</span>
                         </div>
                       ))}
                     </div>
                   </div>
                   <div>
                     <div className="rs-card-label" style={{ marginBottom: 16 }}>EXECUTION SEQUENCE</div>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                       {recipe.steps.map((s, i) => (
                         <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7, fontWeight: 900, marginTop: 4 }}>{String(i+1).padStart(2, '0')}</span>
                            <div style={{ flex: 1, lineHeight: 1.6 }}>{s}</div>
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
                 
                 <div style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      className="gh-cook-btn-next"
                      style={{ flex: 2, height: 48, justifyContent: 'center' }}
                      onClick={() => {
                        onClose();
                        onCook(recipe);
                      }}
                    >
                      <span className="material-symbols-rounded">skillet</span>
                      <span>COOK NOW IN GUIDE</span>
                    </button>
                    <button className="rs-pill" style={{ flex: 1 }} onClick={async () => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sub-toggle: Recipes vs Dietary Rules */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`gh-kitchen-nav-btn ${cookbookSubTab === 'recipes' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
            onClick={() => setCookbookSubTab('recipes')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>menu_book</span>
            <span>All Recipes ({recipes.length})</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${cookbookSubTab === 'banned' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
            onClick={() => setCookbookSubTab('banned')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>block</span>
            <span>Dietary Rules ({banned.length})</span>
          </button>
        </div>

        {cookbookSubTab === 'recipes' && (
          <button
            className="gh-cook-btn-next"
            style={{ flex: 'none', height: 42, padding: '0 20px', fontSize: '0.88rem' }}
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
          <div className="gh-card" style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 220, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.06)', padding: '6px 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)' }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20, color: 'rgba(220,230,245,0.6)' }}>search</span>
                <input
                  style={{ all: 'unset', width: '100%', fontSize: '0.95rem', color: '#fff' }}
                  placeholder="Search recipes, ingredients..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="rs-pill" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '0.85rem' }}>
                  <option value="ALL">ALL MEALS</option>
                  {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill" value={filterProtein} onChange={e => setFilterProtein(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '0.85rem' }}>
                  {uniqueProteins.map(p => <option key={p} value={p}>{p === 'ALL' ? 'ALL PROTEINS' : p.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill" value={sortMode} onChange={e => setSortMode(e.target.value)} style={{ border: 'none', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: '0.85rem' }}>
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
              <div key={r.id} className="rs-card is-tappable animate-page-in" style={{ padding: 0, overflow: 'hidden', animationDuration: '300ms' }} onClick={() => setActiveRecipe(r)}>
                <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/10', overflow: 'hidden', background: 'var(--md-surface-container-highest)' }}>
                    {r.image_url ? (
                      <img src={r.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '4.5rem' }}>restaurant</span>
                      </div>
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 65%)' }} />
                    <div style={{ position: 'absolute', bottom: 14, left: 16 }}>
                      <StarRating value={r.rating} size={16} />
                    </div>
                  </div>
                  <div style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#00e5ff', textTransform: 'uppercase' }}>
                        {r.meal_type}
                      </span>
                      <button
                        className="gh-glance-action"
                        style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCookRecipe(r);
                        }}
                      >
                        <span className="material-symbols-rounded" style={{ fontSize: 16 }}>skillet</span>
                        <span>Cook</span>
                      </button>
                    </div>
                    <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{r.title}</div>
                    <div style={{ marginTop: 14, display: 'flex', gap: 14, fontSize: '0.95rem', color: 'rgba(220,230,245,0.8)' }}>
                      <span>{r.primary_protein?.toUpperCase() || 'NO PROTEIN'}</span>
                      <span>·</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{r.servings} SERVINGS</span>
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
            <div key={item.id} className="rs-card animate-page-in" style={{ animationDuration: '300ms', padding: 24 }}>
              <div className="rs-card-inner">
                <div className="rs-card-head" style={{ marginBottom: 12 }}>
                  <span className="rs-card-label" style={{ color: 'var(--md-error)', fontWeight: 900 }}>RESTRICTION</span>
                  <div style={{ display: 'flex', gap: 8 }}>
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
                {item.substitute && <div className="rs-card-meta" style={{ marginTop: 8 }}>PREFERRED SUBSTITUTE: <span style={{ color: '#00e5ff', fontWeight: 800 }}>{item.substitute.toUpperCase()}</span></div>}
                
                {recommendations[item.id] && (
                  <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="rs-card-label">AI SUGGESTIONS</div>
                    {recommendations[item.id].map((rec, idx) => (
                      <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'rgba(255,255,255,0.04)', cursor: 'pointer' }} onClick={async () => {
                        await api.patch(`/household/banned/${item.id}`, { substitute: rec.name });
                        fetchData('cookbook');
                      }}>
                        <span style={{ fontWeight: 700, color: '#00e5ff', marginRight: 10 }}>{rec.name}</span>
                        <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>{rec.reason}</span>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Sub-toggle: Dinner Calendar vs Batch Prep */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`gh-kitchen-nav-btn ${planSubTab === 'dinner' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
            onClick={() => setPlanSubTab('dinner')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>calendar_month</span>
            <span>7-Day Dinners</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${planSubTab === 'prep' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>This Week's Dinner Menu</h3>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(220,230,245,0.65)' }}>Household dinner calendar and ingredient procurement</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                {week.map(w => {
                  const isToday = w.dateStr === new Date().toISOString().split('T')[0];
                  return (
                    <div key={w.dateStr} style={{ 
                      background: isToday ? 'rgba(0, 229, 255, 0.08)' : (w.entry ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'), 
                      borderRadius: 16, padding: 14, 
                      border: isToday ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 120
                    }}>
                      <div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: isToday ? '#00e5ff' : 'rgba(220,230,245,0.75)', marginBottom: 8 }}>
                          {w.dayName.toUpperCase()} {isToday && '· TODAY'}
                        </div>
                        {w.entry ? (
                          <>
                            <div style={{ fontWeight: 750, fontSize: '1.15rem', color: '#fff', lineHeight: 1.35 }}>
                              {w.entry.recipe_title || w.entry.label || 'Planned'}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: w.entry.status === 'cooked' ? '#4ade80' : '#00e5ff', marginTop: 6, fontWeight: 700 }}>
                              {w.entry.status.toUpperCase()}
                            </div>
                          </>
                        ) : (
                          <div style={{ opacity: 0.4, fontSize: '0.85rem', fontStyle: 'italic' }}>Open</div>
                        )}
                      </div>

                      {isToday && w.entry?.recipe_id && (
                        <button
                          className="gh-cook-btn-next"
                          style={{ marginTop: 10, height: 34, fontSize: '0.78rem', width: '100%', justifyContent: 'center' }}
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
                <h3 style={{ margin: '0 0 14px 0', fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>
                  Household Dinner Proposals
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {proposals.map(p => (
                    <div key={p.id} className="rs-card animate-page-in" style={{ padding: 18, border: p.status === 'approved' ? '1px solid #00e5ff' : '1px solid rgba(255,255,255,0.1)' }}>
                      <div className="rs-card-inner">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: p.status === 'approved' ? '#00e5ff' : 'inherit' }}>
                            {p.status.toUpperCase()} PROPOSAL
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <span className="rs-pill" style={{ padding: '2px 8px', fontSize: '0.75rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)' }}>{p.votes_yes.length} YES</span>
                            <span className="rs-pill" style={{ padding: '2px 8px', fontSize: '0.75rem', color: '#f87171', background: 'rgba(248,113,113,0.1)' }}>{p.votes_no.length} NO</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: 14 }}>
                          {p.recipe?.title}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="rs-btn-primary" style={{ flex: 1, height: 36, fontSize: '0.82rem' }} onClick={async () => {
                            await api.post(`/dinner/${p.id}/vote`, { vote: 'yes' });
                            fetchData('plan');
                          }}>APPROVE</button>
                          <button className="rs-pill" style={{ flex: 1, height: 36, fontSize: '0.82rem', color: 'var(--md-error)' }} onClick={async () => {
                            await api.post(`/dinner/${p.id}/vote`, { vote: 'no' });
                            fetchData('plan');
                          }}>VETO</button>
                          <button className="rs-pill" style={{ height: 36, padding: '0 10px' }} onClick={async () => {
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!activePrep ? (
              <div className="gh-card" style={{ textAlign: 'center', padding: 48 }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: '#fff' }}>No Active Prep Session</h3>
                <p style={{ color: 'rgba(220,230,245,0.7)', fontSize: '0.9rem', marginBottom: 20 }}>
                  Stage multiple dishes to cook concurrently with synchronized timing.
                </p>
                <button className="gh-cook-btn-next" style={{ display: 'inline-flex', padding: '0 24px' }} onClick={async () => {
                  await api.post('/prep', { label: 'New Session' });
                  fetchData('plan');
                }}>Start Prep Session</button>
              </div>
            ) : (
              <div className="gh-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>
                      Active Prep: {activePrep.label || 'Multi-Dish Meal'}
                    </h3>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(220,230,245,0.65)' }}>
                      {activePrep.recipes?.length || 0} dishes staged
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      className="gh-cook-btn-next"
                      style={{ height: 42, padding: '0 20px', fontSize: '0.88rem' }}
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(activePrep.recipes || []).map((pr, i) => (
                    <div key={i} style={{ padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fff' }}>{pr.recipe_title}</div>
                        <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={async () => {
                          await api.delete(`/prep/${activePrep.id}/recipes/${pr.entry_id}`);
                          fetchData('plan');
                        }}><span className="material-symbols-rounded">remove_circle</span></button>
                      </div>
                      <PrepAdjuster entry={pr} api={api} onUpdate={() => fetchData('plan')} />
                    </div>
                  ))}
                </div>

                {/* Staged vs Needs inline toggle */}
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    className={`gh-kitchen-nav-btn ${prepView === 'recipes' ? 'is-active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                    onClick={() => setPrepView('recipes')}
                  >
                    <span className="material-symbols-rounded">list_alt</span>
                    <span>Staged Recipes</span>
                  </button>
                  <button
                    className={`gh-kitchen-nav-btn ${prepView === 'list' ? 'is-active' : ''}`}
                    style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                    onClick={() => setPrepView('list')}
                  >
                    <span className="material-symbols-rounded">shopping_cart</span>
                    <span>Needed Ingredients</span>
                  </button>
                </div>

                {prepView === 'list' && (
                  <div style={{ marginTop: 16 }}>
                    {prepList ? (
                      <PrepShoppingListPanel
                        items={prepList}
                        sessionId={activePrep.id}
                        api={api}
                        onPushed={() => { setGroceryNonce(n => n + 1); setActiveTab('pantry') }}
                      />
                    ) : (
                      <div className="rs-card-meta" style={{ padding: 24, textAlign: 'center' }}>Calculating ingredient requirements…</div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sub-toggle: Groceries vs Stockroom */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`gh-kitchen-nav-btn ${pantrySubTab === 'list' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
            onClick={() => setPantrySubTab('list')}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>shopping_cart</span>
            <span>Grocery List</span>
          </button>
          <button
            className={`gh-kitchen-nav-btn ${pantrySubTab === 'stockroom' ? 'is-active' : ''}`}
            style={{ padding: '6px 16px', fontSize: '0.85rem' }}
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
                  <span className="rs-card-label" style={{ color: item.quantity <= item.min_quantity ? '#f87171' : '#4ade80', fontWeight: 900 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 800 }}>{item.quantity.toFixed(2)}</span> IN STOCK
                  </span>
                  <span className="rs-card-label" style={{ opacity: 0.7 }}>{item.brand?.toUpperCase()}</span>
                </div>
                <div className="rs-card-value" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff' }}>{item.name}</div>
                <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
                  <button className="rs-pill is-active" style={{ flex: 1 }} onClick={() => setAdjustItem(item)}>ADJUST</button>
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
    <div className="rs-foyer gh-kitchen-stage">
      {/* Header */}
      <div className="rs-foyer-head" style={{ marginBottom: 20 }}>
        <h1 className="rs-greeting" style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>Kitchen</h1>
        <div className="rs-greeting-sub" style={{ fontSize: '1.15rem', color: 'rgba(220, 230, 245, 0.85)', marginTop: 6 }}>Cookbook, meal plans, autonomous cooking guides & groceries.</div>
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
            <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>KITCHEN ERROR</div>
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
            <div className="rs-card-label" style={{ marginBottom: 16 }}>ADJUST STOCK: {adjustItem.name.toUpperCase()}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', justifyContent: 'center' }}>
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: Math.max(0, adjustItem.quantity - 0.25)})}>-</button>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '1.75rem', fontWeight: 800 }}>{adjustItem.quantity.toFixed(2)}</div>
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: adjustItem.quantity + 0.25})}>+</button>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
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
