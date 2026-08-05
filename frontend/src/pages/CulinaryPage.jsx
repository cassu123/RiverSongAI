import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import BarcodeScanner from '../components/BarcodeScanner.jsx'

/**
 * CulinaryPage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Gourmet Logistics & Recipe Archives.
 * Full Double-Bezel and Cockpit density transformation.
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

function ShoppingListModal({ items, onClose, api }) {
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);

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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }} onClick={onClose}>
       <div className="rs-card is-elev animate-page-in" style={{ width: 'min(95%, 500px)', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
          <div className="rs-card-inner" style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
             <div className="rs-card-head" style={{ marginBottom: 24 }}>
                <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>MASTER SHOPPING LIST</span>
                <button className="rs-pill" onClick={onClose}><span className="material-symbols-rounded">close</span></button>
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {items.length === 0 ? (
                  <div className="rs-card-meta">No provisions required. Stock nominal.</div>
                ) : items.map((it, idx) => (
                  <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: it._from_stockroom ? 'rgba(255,184,108,0.1)' : 'var(--md-surface-container-low)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, minWidth: 60, color: 'var(--primary)' }}>{it.qty} {it.unit}</span>
                    <span style={{ flex: 1 }}>{it.name}</span>
                    {it._from_stockroom && <span className="rs-card-label" style={{ fontSize: '0.6rem', color: '#FFB86C' }}>STOCK LOW</span>}
                  </div>
                ))}
             </div>
             
             <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                 {exportResult ? (
                   <div style={{ padding: 16, background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade80', borderRadius: 8 }}>
                     <div style={{ color: '#4ade80', fontWeight: 800, marginBottom: 8 }}>EXPORT SUCCESSFUL</div>
                     {exportResult.cart_url ? (
                        <a href={exportResult.cart_url} target="_blank" rel="noreferrer" className="rs-btn-primary" style={{ display: 'inline-flex', textDecoration: 'none' }}>OPEN WALMART CART</a>
                     ) : (
                        <div>No items were mapped to Walmart products.</div>
                     )}
                     {exportResult.unmapped?.length > 0 && (
                        <div style={{ marginTop: 12, fontSize: '0.8rem', color: '#f87171' }}>Unmapped: {exportResult.unmapped.join(', ')}</div>
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

function StagingAreaModal({ piles, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }} onClick={onClose}>
       <div className="rs-card is-elev animate-page-in" style={{ width: 'min(95%, 800px)', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
          <div className="rs-card-inner" style={{ flex: 1, overflowY: 'auto', padding: 32 }}>
             <div className="rs-card-head" style={{ marginBottom: 24 }}>
                <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>STAGING AREA</span>
                <button className="rs-pill" onClick={onClose}><span className="material-symbols-rounded">close</span></button>
             </div>
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                {piles.map((pile, idx) => (
                  <div key={idx} className="rs-card" style={{ border: '1px solid var(--md-outline-variant)' }}>
                     <div className="rs-card-inner">
                        <div className="rs-card-label" style={{ marginBottom: 12 }}>{pile.recipe_title.toUpperCase()}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                           {pile.ingredients.map((ing, i) => (
                             <div key={i} className="rs-pill" style={{ justifyContent: 'flex-start', fontSize: '0.85rem' }}>
                                <span style={{ opacity: 0.6, marginRight: 8 }}>{ing.qty} {ing.unit}</span>
                                <span>{ing.name}</span>
                             </div>
                           ))}
                        </div>
                     </div>
                  </div>
                ))}
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
       <button className="rs-btn-primary" style={{ height: 32, fontSize: '0.7rem' }} onClick={handleScale} disabled={scaling}>{scaling ? 'SCALING...' : 'APPLY'}</button>
    </div>
  )
}

function RecipeDetailModal({ recipe, onClose, onSave, onDelete, api }) {
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
                <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>{isEditing ? 'EDITING ARCHIVE' : recipe.meal_type.toUpperCase()}</span>
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
                     <input className="rs-pill" value={edited.tags_str || ''} onChange={e => setEdited({ ...edited, tags_str: e.target.value, tags: e.target.value.split(',').map(s=>s.trim()).filter(Boolean) })} placeholder="DIETARY TAGS (comma separated, e.g. keto, low-sodium)" style={{ border: 'none', background: 'var(--md-surface-container-low)', padding: '12px 16px', gridColumn: '1 / -1' }} />
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
                      <button className="rs-pill" style={{ fontSize: '0.65rem' }} onClick={addIngredient}>ADD PROVISION</button>
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
                      <button className="rs-pill" style={{ fontSize: '0.65rem' }} onClick={addStep}>ADD STEP</button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {edited.steps?.map((step, i) => (
                        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <span style={{ marginTop: 12, fontFamily: 'var(--font-mono)', opacity: 0.4, fontWeight: 900 }}>{String(i+1).padStart(2, '0')}</span>
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
                     <button className="rs-btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>{saving ? 'PERSISTING...' : 'SAVE CHANGES'}</button>
                     <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={() => { if(confirm('Erase this archive?')) onDelete(recipe.id) }}>DELETE</button>
                  </div>
               </div>
             ) : (
               <>
                 <div className="rs-card-value" style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 8 }}>{recipe.title}</div>
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
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.88rem' }}>
                                 <span style={{ color: 'var(--md-error)', fontWeight: 700 }}>{b.name}</span>
                                 {b.substitute && (
                                   <>
                                     <span style={{ opacity: 0.5 }}>→</span>
                                     <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{b.substitute}</span>
                                     <button className="rs-pill" style={{ padding: '2px 10px', fontSize: '0.6rem' }} onClick={() => applySubstitute(b.name, b.substitute)}>APPLY SUBSTITUTE</button>
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
                            <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.4, fontWeight: 900, marginTop: 4 }}>{String(i+1).padStart(2, '0')}</span>
                            <div style={{ flex: 1, lineHeight: 1.6 }}>{s}</div>
                         </div>
                       ))}
                     </div>
                   </div>
                 </div>
                 
                 <div style={{ marginTop: 48, display: 'flex', gap: 12 }}>
                    <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
                       try {
                         const session = await api.get('/prep')
                         await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipe.id })
                       } catch {
                         const session = await api.post('/prep', { label: `Prep: ${recipe.title}` })
                         await api.post(`/prep/${session.id}/add-recipe`, { recipe_id: recipe.id })
                       }
                       onClose();
                    }}>INITIATE PREP</button>
                    <button className="rs-pill" onClick={() => {
                       localStorage.setItem('rs-chronos-open', JSON.stringify({ title: `Recipes/${recipe.title}`, root: 'household' }));
                       window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }));
                       onClose();
                    }}>ARCHIVE</button>
                    <button className="rs-pill" onClick={async () => {
                       await api.post('/dinner/suggest', { recipe_id: recipe.id });
                       alert('Suggestion broadcast to household.');
                    }}>SUGGEST FOR DINNER</button>
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
    delete: (p) => fetch(`/api/culinary${p}`, { method: 'DELETE', headers: headers() }),
  }), [headers])
}

export default function CulinaryPage({ setAction }) {
  const { token } = useAuth()
  const api = useApi(token)
  
  const [activeTab, setActiveTab] = useState('library')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [scannerMode, setScannerMode] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [stock, setStock] = useState([])
  const [grocery, setGrocery] = useState([])
  const [equipment, setEquipment] = useState([])
  const [banned, setBanned] = useState([])
  const [newGroceryItem, setNewGroceryItem] = useState("")
  const [mealPlan, setMealPlan] = useState([])
  const [proposals, setProposals] = useState([])
  const [activePrep, setActivePrep] = useState(null)
  
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('ALL')
  const [filterProtein, setFilterProtein] = useState('ALL')
  const [sortMode, setSortMode] = useState('NEWEST') // NEWEST, RATING
  
  const [activeRecipe, setActiveRecipe] = useState(null)
  const [showShoppingList, setShowShoppingList] = useState(null) // items
  const [showStagingArea, setShowStagingArea] = useState(null) // piles
  const [adjustItem, setAdjustItem] = useState(null)

  const [recommendations, setRecommendations] = useState({}) // bannedId -> recs[]
  const [recLoading, setRecLoading] = useState({}) // bannedId -> bool

  // Dynamic Proteins
  const uniqueProteins = useMemo(() => {
    return ['ALL', ...new Set(recipes.map(r => r.primary_protein).filter(Boolean))].sort()
  }, [recipes])

  // Fetch Logic
  const fetchData = useCallback(async (tab) => {
    setLoading(true)
    try {
      if (tab === 'library') setRecipes(await api.get('/recipes'))
      if (tab === 'stockroom') setStock(await api.get('/stockroom'))
      if (tab === 'dinner') {
        setProposals(await api.get('/dinner'));
        const d = new Date();
        const d2 = new Date(d);
        d2.setDate(d.getDate() - d.getDay()); // Start of week (Sunday)
        const start = d2.toISOString().split('T')[0];
        setMealPlan(await api.get(`/meal-plan?start=${start}`));
      }
      if (tab === 'prep') {
        try { setActivePrep(await api.get('/prep')) } catch { setActivePrep(null) }
      }
      if (tab === 'grocery') {
        try { setGrocery(await api.get('/grocery')) } catch { setGrocery([]) }
      }
      if (tab === 'equipment') setEquipment(await api.get('/household/equipment'))
      if (tab === 'banned') setBanned(await api.get('/household/banned'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api, token])

  useEffect(() => { fetchData(activeTab) }, [activeTab, fetchData])

  useEffect(() => {
    if (!token) return;
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/culinary/ws?token=${token}`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (['stockroom_updated', 'stockroom_deleted', 'stockroom_created'].includes(msg.event)) {
          if (activeTab === 'stockroom') fetchData('stockroom');
        }
        if (msg.event === 'grocery_updated') {
          if (activeTab === 'grocery') fetchData('grocery');
        }
        if (msg.event === 'meal_plan_updated' || msg.event === 'dinner_updated') {
          if (activeTab === 'dinner') fetchData('dinner');
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

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
          {[
            { key: 'library', icon: 'menu_book', label: 'MENU' },
            { key: 'dinner', icon: 'dinner_dining', label: 'DINNER' },
            { key: 'stockroom', icon: 'warehouse', label: 'STOCK' },
            { key: 'prep', icon: 'set_meal', label: 'PREP' },
            { key: 'grocery', icon: 'shopping_cart', label: 'LIST' },
            { key: 'equipment', icon: 'kitchen', label: 'HARDWARE' },
            { key: 'banned', icon: 'block', label: 'BANNED' }
          ].map(t => (
            <button key={t.key} className={`rs-pill ${activeTab === t.key ? 'is-active' : ''}`} onClick={() => setActiveTab(t.key)}>
              <span className="material-symbols-rounded">{t.icon}</span>
              <span className="rs-speak-actions-label">{t.label}</span>
            </button>
          ))}
          <button className="rs-pill" onClick={() => fetchData(activeTab)}>
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
    return () => setAction(null)
  }, [activeTab, setAction, fetchData])

  const renderLibrary = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
       {/* Structured Filter Bar */}
       <div className="rs-card is-wide" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-card-inner" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
             <div className="rs-chat-input-container" style={{ flex: 2, minWidth: 200, padding: '4px 16px', background: 'rgba(0,0,0,0.2)' }}>
                <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>search</span>
                <input style={{ all: 'unset', width: '100%', fontSize: '0.85rem' }} placeholder="SEARCH ARCHIVES..." value={search} onChange={e => setSearch(e.target.value)} />
             </div>
             <div style={{ display: 'flex', gap: 8 }}>
                <select className="rs-pill" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ border: 'none', background: 'rgba(0,0,0,0.2)', fontSize: '0.75rem' }}>
                  <option value="ALL">ALL MEALS</option>
                  {['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill" value={filterProtein} onChange={e => setFilterProtein(e.target.value)} style={{ border: 'none', background: 'rgba(0,0,0,0.2)', fontSize: '0.75rem' }}>
                  {uniqueProteins.map(p => <option key={p} value={p}>{p === 'ALL' ? 'ALL PROTEINS' : p.toUpperCase()}</option>)}
                </select>
                <select className="rs-pill" value={sortMode} onChange={e => setSortMode(e.target.value)} style={{ border: 'none', background: 'rgba(0,0,0,0.2)', fontSize: '0.75rem' }}>
                   <option value="NEWEST">NEWEST</option>
                   <option value="RATING">TOP RATED</option>
                </select>
             </div>
          </div>
       </div>

       <div className="rs-card-flow" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
        {recipes
          .filter(r => r.title.toLowerCase().includes(search.toLowerCase()))
          .filter(r => filterType === 'ALL' || r.meal_type === filterType)
          .filter(r => filterProtein === 'ALL' || r.primary_protein === filterProtein)
          .sort((a, b) => sortMode === 'RATING' ? (b.rating || 0) - (a.rating || 0) : new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .map(r => (
          <div key={r.id} className="rs-card is-tappable animate-page-in" style={{ padding: 0, overflow: 'hidden', animationDuration: '400ms' }} onClick={() => setActiveRecipe(r)}>
             <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
               <div style={{ position: 'relative', width: '100%', aspectRatio: '16/10', overflow: 'hidden', background: 'var(--md-surface-container-highest)' }}>
                  {r.image_url ? (
                    <img src={r.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.1 }}>
                       <span className="material-symbols-rounded" style={{ fontSize: '4rem' }}>restaurant</span>
                    </div>
                  )}
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 60%)' }} />
                  <div style={{ position: 'absolute', bottom: 16, left: 16 }}>
                    <StarRating value={r.rating} size={16} />
                  </div>
               </div>
               <div style={{ padding: 24 }}>
                 <div className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900, marginBottom: 12 }}>{r.meal_type.toUpperCase()}</div>
                 <div className="rs-card-value" style={{ fontSize: '1.25rem', fontWeight: 800 }}>{r.title}</div>
                 <div className="rs-card-meta" style={{ marginTop: 16, display: 'flex', gap: 16 }}>
                    <span>{r.primary_protein?.toUpperCase()}</span>
                    <span>·</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{r.servings} SERVINGS</span>
                 </div>
               </div>
             </div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderStockroom = () => (
    <div className="rs-card-flow">
      <div style={{ marginBottom: 16 }}>
        <button className="rs-btn-primary" style={{ width: '100%', height: 48, justifyContent: 'center', background: 'rgba(248,113,113,0.1)', color: '#f87171' }} onClick={() => setScannerMode('deplete')}>
          <span className="material-symbols-rounded">delete_sweep</span>
          DEPLETE ITEM SCAN
        </button>
      </div>
      {stock.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map(item => (
        <div key={item.id} className="rs-card is-wide animate-page-in" style={{ animationDuration: '400ms' }}>
           <div className="rs-card-inner">
             <div className="rs-card-head">
                <span className="rs-card-label" style={{ opacity: 1, color: item.quantity <= item.min_quantity ? '#f87171' : '#4ade80', fontWeight: 900 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>{item.quantity.toFixed(2)}</span> IN STOCK
                </span>
                <span className="rs-card-label" style={{ opacity: 0.4 }}>{item.brand?.toUpperCase()}</span>
             </div>
             <div className="rs-card-value" style={{ fontSize: '1.4rem' }}>{item.name}</div>
             <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                <button className="rs-pill is-active" style={{ flex: 1 }} onClick={() => setAdjustItem(item)}>ADJUST</button>
                <button className="rs-pill" onClick={() => {
                     localStorage.setItem('rs-chat-intent', JSON.stringify({ text: `River, status on ${item.name} levels.`, docId: null }));
                     window.dispatchEvent(new Event('rs-navigate-chat'));
                }}>ASK</button>
             </div>
           </div>
        </div>
      ))}
    </div>
  )

  const renderDinner = () => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
       <div className="rs-card is-wide is-elev" style={{ border: '1px solid var(--primary)', background: 'color-mix(in srgb, var(--primary) 4%, var(--bg-base))' }}>
          <div className="rs-card-inner">
             <div className="rs-card-head">
                <span className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>THIS WEEK</span>
                <button className="rs-pill" style={{ color: '#0071ce' }} onClick={async () => {
                    await api.post('/meal-plan/shop-this-week');
                    alert('Added missing ingredients to Procurement List!');
                }}><span className="material-symbols-rounded">shopping_cart</span> SHOP THIS WEEK</button>
                <button className="rs-pill" onClick={async () => {
                    const entryIds = mealPlan.filter(e => e.status === 'planned' && e.recipe_id).map(e => e.id);
                    if (entryIds.length === 0) return alert('No planned recipes this week.');
                    const res = await api.post('/meal-plan/create-prep-session', { entry_ids: entryIds });
                    if (res.status === 'ok') {
                        fetchData('prep');
                        setActiveTab('prep');
                    }
                }}><span className="material-symbols-rounded">kitchen</span> BATCH PREP</button>

             </div>
             
             <div style={{ display: 'flex', gap: 12, marginTop: 24, overflowX: 'auto', paddingBottom: 16 }}>
               {week.map(w => (
                 <div key={w.dateStr} style={{ 
                   flex: 1, minWidth: 120, 
                   background: w.entry ? 'var(--md-surface-container-high)' : 'var(--md-surface-container)', 
                   borderRadius: 16, padding: 16, border: '1px solid var(--md-outline-variant)' 
                 }}>
                   <div style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.5, marginBottom: 8 }}>{w.dayName.toUpperCase()}</div>
                   {w.entry ? (
                     <>
                       <div style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>{w.entry.recipe_title || w.entry.label || 'Planned'}</div>
                       <div style={{ fontSize: '0.7rem', color: w.entry.status === 'cooked' ? '#4ade80' : 'var(--primary)', marginTop: 8, fontWeight: 800 }}>{w.entry.status.toUpperCase()}</div>
                     </>
                   ) : (
                     <div style={{ opacity: 0.3, fontSize: '0.8rem', fontStyle: 'italic' }}>Open</div>
                   )}
                 </div>
               ))}
             </div>
          </div>
       </div>
       
       {proposals.length > 0 && (
         <div className="rs-card-head" style={{ marginTop: 16 }}>
            <span className="rs-card-label" style={{ fontWeight: 900 }}>DINNER PROPOSALS</span>
         </div>
       )}
       
       <div className="rs-card-flow">
          {proposals.map(p => (
            <div key={p.id} className={`rs-card is-wide animate-page-in ${p.status === 'approved' ? 'is-elev' : ''}`} style={{ borderColor: p.status === 'approved' ? 'var(--primary)' : 'var(--md-outline)', animationDuration: '400ms' }}>
               <div className="rs-card-inner">
                  <div className="rs-card-head">
                     <span className="rs-card-label" style={{ color: p.status === 'approved' ? 'var(--primary)' : 'inherit', fontWeight: 900 }}>{p.status.toUpperCase()} PROPOSAL</span>
                     <div style={{ display: 'flex', gap: 8 }}>
                        <span className="rs-pill" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>{p.votes_yes.length} YES</span>
                        <span className="rs-pill" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>{p.votes_no.length} NO</span>
                     </div>
                  </div>
                  <div className="rs-card-value" style={{ fontSize: '1.5rem', marginBottom: 20 }}>{p.recipe?.title}</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                     <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
                        await api.post(`/dinner/${p.id}/vote`, { vote: 'yes' });
                        fetchData('dinner');
                     }}>APPROVE</button>
                     <button className="rs-pill" style={{ flex: 1, color: 'var(--md-error)' }} onClick={async () => {
                        await api.post(`/dinner/${p.id}/vote`, { vote: 'no' });
                        fetchData('dinner');
                     }}>VETO</button>
                     <button className="rs-pill" onClick={async () => {
                        await api.delete(`/dinner/${p.id}`);
                        fetchData('dinner');
                     }}><span className="material-symbols-rounded">close</span></button>
                  </div>
               </div>
            </div>
          ))}
       </div>
    </div>
    )
  }

  const renderPrep = () => (
    <div className="rs-card-flow">
       {!activePrep ? (
         <div className="rs-card is-wide" style={{ textAlign: 'center', padding: 64 }}>
            <div className="rs-card-label" style={{ marginBottom: 16 }}>STAGING CLEAR</div>
            <button className="rs-btn-primary" onClick={async () => {
               await api.post('/prep', { label: 'New Session' });
               fetchData('prep');
            }}>START PREP SESSION</button>
         </div>
       ) : (
         <div className="rs-card is-wide animate-page-in" style={{ border: '1px solid var(--primary)', animationDuration: '400ms' }}>
            <div className="rs-card-inner">
               <div className="rs-card-head">
                  <span className="rs-card-label" style={{ color: 'var(--primary)', fontWeight: 900 }}>ACTIVE PREP: {activePrep.label?.toUpperCase()}</span>
                  <button className="rs-pill" onClick={async () => {
                     if(confirm('Complete this session?')) {
                       await api.post(`/prep/${activePrep.id}/complete`);
                       fetchData('prep');
                     }
                  }}>FINISH</button>
               </div>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
                  {activePrep.recipes.map((pr, i) => (
                    <div key={i} className="rs-card" style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--md-outline-variant)' }}>
                       <div className="rs-card-inner">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                             <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{pr.recipe_title}</div>
                             <button className="rs-pill" style={{ color: 'var(--md-error)' }} onClick={async () => {
                                await api.delete(`/prep/${activePrep.id}/recipes/${pr.entry_id}`);
                                fetchData('prep');
                             }}><span className="material-symbols-rounded">remove_circle</span></button>
                          </div>
                          <PrepAdjuster entry={pr} api={api} onUpdate={() => fetchData('prep')} />
                       </div>
                    </div>
                  ))}
               </div>
               <div style={{ marginTop: 40, display: 'flex', gap: 12 }}>
                  <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
                     const res = await api.get(`/prep/${activePrep.id}/shopping-list`);
                     setShowShoppingList(res.shopping_list);
                  }}>
                    <span className="material-symbols-rounded">shopping_cart</span>
                    SHOPPING LIST
                  </button>
                  <button className="rs-pill" style={{ flex: 1 }} onClick={async () => {
                     const res = await api.get(`/prep/${activePrep.id}/staging`);
                     setShowStagingArea(res.piles);
                  }}>
                    <span className="material-symbols-rounded">view_column</span>
                    STAGING AREA
                  </button>
               </div>
            </div>
         </div>
       )}
    </div>
  )

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Culinary</h1>
        <div className="rs-greeting-sub">Sector provisioning and autonomous culinary archives.</div>
      </div>

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
            <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>SECTOR ERROR</div>
            <div className="rs-card-meta">{error}</div>
          </div>
        </div>
      ) : loading && !['equipment', 'prep', 'dinner', 'library', 'banned'].includes(activeTab) ? (
        <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>ACCESSING {activeTab.toUpperCase()} ARCHIVES...</div>
      ) : (
        <div className="animate-page-in" style={{ animationDuration: '400ms' }}>
          {activeTab === 'library' && renderLibrary()}
          {activeTab === 'stockroom' && renderStockroom()}
          {activeTab === 'dinner' && renderDinner()}
          {activeTab === 'prep' && renderPrep()}
          {activeTab === 'grocery' && renderGrocery()}
          {activeTab === 'equipment' && (
             <div className="rs-card-flow">
               {equipment.map((eq, i) => (
                 <div key={i} className="rs-card animate-page-in" style={{ animationDuration: '400ms' }}>
                   <div className="rs-card-inner">
                     <div className="rs-card-head">
                       <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>{(eq.equipment_type || 'HARDWARE').toUpperCase()}</span>
                       <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>settings_input_component</span>
                     </div>
                     <div className="rs-card-value" style={{ fontSize: '1.2rem', fontWeight: 800 }}>{eq.make}</div>
                     <div className="rs-card-meta" style={{ marginTop: 6 }}>{eq.model}</div>
                   </div>
                 </div>
               ))}
             </div>
          )}
          {activeTab === 'banned' && (
            <div className="rs-card-flow">
               {banned.map(item => (
                 <div key={item.id} className="rs-card animate-page-in" style={{ animationDuration: '400ms', padding: 32 }}>
                    <div className="rs-card-inner">
                      <div className="rs-card-head">
                        <span className="rs-card-label" style={{ color: 'var(--md-error)', fontWeight: 900 }}>BANNED</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                           <button className="rs-pill" onClick={() => getRecommendations(item.id, item.name)} disabled={recLoading[item.id]}>
                             <span className="material-symbols-rounded">psychology</span>
                             {recLoading[item.id] ? 'REASONING...' : 'AI RECOMMEND'}
                           </button>
                           <button className="rs-pill" onClick={async () => { await api.delete(`/household/banned/${item.id}`); fetchData('banned'); }}>
                             <span className="material-symbols-rounded">delete</span>
                           </button>
                        </div>
                      </div>
                      <div className="rs-card-value" style={{ fontSize: '1.8rem' }}>{item.name}</div>
                      {item.substitute && <div className="rs-card-meta" style={{ marginTop: 8 }}>PREFEERED SUBSTITUTE: <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{item.substitute.toUpperCase()}</span></div>}
                      
                      {recommendations[item.id] && (
                        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                           <div className="rs-card-label">AI RECOMMENDATIONS</div>
                           {recommendations[item.id].map((rec, idx) => (
                             <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'rgba(0,0,0,0.1)', cursor: 'pointer' }} onClick={async () => {
                                await api.patch(`/household/banned/${item.id}`, { substitute: rec.name });
                                fetchData('banned');
                             }}>
                                <span style={{ fontWeight: 700, color: 'var(--primary)', marginRight: 12 }}>{rec.name}</span>
                                <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{rec.reason}</span>
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
      )}

      {activeRecipe && <RecipeDetailModal recipe={activeRecipe} onClose={() => setActiveRecipe(null)} onSave={(updated) => {
         setRecipes(recipes.map(r => r.id === updated.id ? updated : r))
         setActiveRecipe(updated)
      }} onDelete={async (id) => {
         await api.delete(`/recipes/${id}`)
         setRecipes(recipes.filter(r => r.id !== id))
         setActiveRecipe(null)
      }} api={api} />}
      {showStagingArea && <StagingAreaModal piles={showStagingArea} onClose={() => setShowStagingArea(null)} />}
      {showShoppingList && <ShoppingListModal items={showShoppingList} onClose={() => setShowShoppingList(null)} api={api} />}
      
      {adjustItem && (
        <div className="rs-modal-overlay">
          <div className="rs-modal" style={{ maxWidth: 400 }}>
            <div className="rs-card-label" style={{ marginBottom: 16 }}>ADJUST STOCK: {adjustItem.name.toUpperCase()}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', justifyContent: 'center' }}>
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: Math.max(0, adjustItem.quantity - 0.25)})}>-</button>
              <div style={{ flex: 1, textAlign: 'center', fontSize: '2rem', fontWeight: 800 }}>{adjustItem.quantity.toFixed(2)}</div>
              <button className="rs-pill" onClick={() => setAdjustItem({...adjustItem, quantity: adjustItem.quantity + 0.25})}>+</button>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="rs-btn-primary" style={{ flex: 1 }} onClick={async () => {
                await api.put(`/stockroom/${adjustItem.id}`, { quantity: adjustItem.quantity });
                setAdjustItem(null);
                fetchData('stockroom');
              }}>SAVE</button>
              <button className="rs-pill" onClick={() => setAdjustItem(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
