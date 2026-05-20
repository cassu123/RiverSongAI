import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import Sheet, { SheetRow } from '../chrome/Sheet'
import BarcodeScanner from '../components/BarcodeScanner.jsx'

/**
 * CulinaryPage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Gourmet Logistics & Recipe Archives.
 * Full Double-Bezel and Cockpit density transformation.
 */

// -- Helpers --
function StarRating({ value, size = 14 }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ fontSize: size, color: value >= n ? 'var(--primary)' : 'var(--md-outline-variant)' }}>★</span>
      ))}
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
    del: (p) => fetch(`/api/culinary${p}`, { method: 'DELETE', headers: headers() }),
  }), [headers])
}

export default function CulinaryPage({ setAction }) {
  const { token } = useAuth()
  const api = useApi(token)
  
  const [activeTab, setActiveTab] = useState('library') // library, stockroom, grocery, equipment, banned
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  const [recipes, setRecipes] = useState([])
  const [stock, setStock] = useState([])
  const [grocery, setGrocery] = useState([])
  const [equipment, setEquipment] = useState([])
  const [banned, setBanned] = useState([])
  
  const [search, setSearch] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState(null)
  const [showScanner, setShowScanner] = useState(false)

  // Fetch Logic
  const fetchData = useCallback(async (tab) => {
    setLoading(true)
    try {
      if (tab === 'library') setRecipes(await api.get('/recipes'))
      if (tab === 'stockroom') setStock(await api.get('/stockroom'))
      if (tab === 'grocery') {
        const homes = await fetch('/api/inventory/homes', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
        if (homes[0]) {
          const manifest = await fetch(`/api/inventory/homes/${homes[0].id}/manifest`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
          setGrocery(manifest.filter(i => i.status === 'low' || i.quantity <= i.min_quantity))
        }
      }
      if (tab === 'equipment') {
        const raw = localStorage.getItem('rs-culinary-equipment')
        setEquipment(raw ? JSON.parse(raw) : [])
      }
      if (tab === 'banned') setBanned(await api.get('/household/banned'))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [api, token])

  useEffect(() => { fetchData(activeTab) }, [activeTab, fetchData])

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
          {[
            { key: 'library', icon: 'menu_book', label: 'MENU' },
            { key: 'stockroom', icon: 'warehouse', label: 'STOCK' },
            { key: 'grocery', icon: 'shopping_cart', label: 'LIST' },
            { key: 'equipment', icon: 'kitchen', label: 'HARDWARE' },
            { key: 'banned', icon: 'block', label: 'BANNED' }
          ].map(t => (
            <button key={t.key} className={`rs-pill ${activeTab === t.key ? 'is-active' : ''}`} onClick={() => setActiveTab(t.key)}>
              <span className="material-symbols-rounded">{t.icon}</span>
              <span className="rs-speak-actions-label">{t.label}</span>
            </button>
          ))}
          <div style={{ width: 1, height: 24, background: 'var(--md-outline-variant)', margin: '0 4px' }} />
          {(activeTab === 'library' || activeTab === 'stockroom') && (
            <div className="rs-chat-input-container" style={{ flex: 1, padding: '4px 12px', minWidth: 160, background: 'color-mix(in srgb, var(--md-surface-container-low) 40%, transparent)' }}>
               <input 
                 style={{ all: 'unset', width: '100%', fontSize: '0.85rem', fontWeight: 600 }} 
                 placeholder={activeTab === 'library' ? "FILTER RECIPES..." : "IDENTIFY STOCK..."}
                 value={search}
                 onChange={e => setSearch(e.target.value)}
               />
            </div>
          )}
          {activeTab === 'stockroom' && (
            <button className="rs-pill" onClick={() => setShowScanner(true)}>
              <span className="material-symbols-rounded">barcode_scanner</span>
            </button>
          )}
          <button className="rs-pill" onClick={() => fetchData(activeTab)}>
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
    return () => setAction(null)
  }, [activeTab, setAction, fetchData, search])

  const renderLibrary = () => (
    <div className="rs-card-flow" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
      {recipes.filter(r => r.title.toLowerCase().includes(search.toLowerCase())).map(r => (
        <div key={r.id} className="rs-card is-tappable animate-page-in" style={{ padding: 0, overflow: 'hidden' }} onClick={() => setSelectedRecipe(r)}>
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
  )

  const renderStockroom = () => (
    <div className="rs-card-flow">
      {stock.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map(item => (
        <div key={item.id} className="rs-card is-wide animate-page-in">
           <div className="rs-card-inner">
             <div className="rs-card-head">
                <span className="rs-card-label" style={{ opacity: 1, color: item.quantity <= item.min_quantity ? '#f87171' : '#4ade80', fontWeight: 900 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>{item.quantity.toFixed(2)}</span> IN STOCK
                </span>
                <span className="rs-card-label" style={{ opacity: 0.4 }}>{item.brand?.toUpperCase()}</span>
             </div>
             <div className="rs-card-value" style={{ fontSize: '1.4rem' }}>{item.name}</div>
             <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                <button className="rs-pill is-active" style={{ flex: 1 }}>ADJUST</button>
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

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Gourmet Logistics</h1>
        <div className="rs-greeting-sub">Sector provisioning and autonomous culinary archives.</div>
      </div>

      {showScanner && (
        <BarcodeScanner onDetected={v => setShowScanner(false)} onClose={() => setShowScanner(false)} />
      )}

      {error ? (
        <div className="rs-card is-wide" style={{ borderColor: 'var(--md-error)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>SECTOR ERROR</div>
            <div className="rs-card-meta">{error}</div>
          </div>
        </div>
      ) : loading && activeTab !== 'equipment' ? (
        <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>ACCESSING {activeTab.toUpperCase()} ARCHIVES...</div>
      ) : (
        <div className="animate-page-in">
          {activeTab === 'library' && renderLibrary()}
          {activeTab === 'stockroom' && renderStockroom()}
          {activeTab === 'grocery' && (
             <div className="rs-card-flow">
               <div className="rs-card is-wide is-elev" style={{ border: '1px solid var(--md-error)', background: 'color-mix(in srgb, var(--md-error) 4%, var(--bg-base))' }}>
                  <div className="rs-card-inner">
                    <div className="rs-card-head">
                       <span className="rs-card-label" style={{ color: 'var(--md-error)', fontWeight: 900 }}>PROCUREMENT REQUIRED</span>
                       <span className="material-symbols-rounded" style={{ color: 'var(--md-error)' }}>shopping_cart</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
                       {grocery.length === 0 ? (
                         <div className="rs-card-meta">All sectors fully provisioned.</div>
                       ) : grocery.map((it, idx) => (
                         <div key={idx} className="rs-pill" style={{ justifyContent: 'flex-start', background: 'rgba(0,0,0,0.2)' }}>
                           <span style={{ flex: 1, fontWeight: 700 }}>{it.name}</span>
                           <span className="rs-card-label" style={{ fontSize: '0.6rem', color: 'var(--md-error)' }}>CRITICAL</span>
                         </div>
                       ))}
                    </div>
                  </div>
               </div>
             </div>
          )}
          {activeTab === 'equipment' && (
             <div className="rs-card-flow">
               {equipment.map((eq, i) => (
                 <div key={i} className="rs-card">
                   <div className="rs-card-inner">
                     <div className="rs-card-head">
                       <span className="rs-card-label" style={{ fontWeight: 900, color: 'var(--primary)' }}>{(eq.type || 'HARDWARE').toUpperCase()}</span>
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
                 <div key={item.id} className="rs-card">
                    <div className="rs-card-inner">
                      <div className="rs-card-head"><span className="rs-card-label" style={{ color: 'var(--md-error)', fontWeight: 900 }}>BANNED</span></div>
                      <div className="rs-card-value">{item.name}</div>
                    </div>
                 </div>
               ))}
            </div>
          )}
        </div>
      )}

      <Sheet open={!!selectedRecipe} onClose={() => setSelectedRecipe(null)} title={selectedRecipe?.title}>
         {selectedRecipe && (
           <div style={{ padding: '0 16px 32px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 40 }}>
                <div>
                  <div className="rs-card-label" style={{ marginBottom: 16 }}>PROVISIONS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {selectedRecipe.ingredients?.map((ing, i) => (
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
                    {selectedRecipe.steps?.map((s, i) => (
                      <div key={i} style={{ fontSize: '0.95rem', lineHeight: 1.6, display: 'flex', gap: 16 }}>
                         <span style={{ fontWeight: 900, color: 'var(--primary)', opacity: 0.4, fontFamily: 'var(--font-mono)' }}>{String(i+1).padStart(2,'0')}</span>
                         <span style={{ opacity: 0.9 }}>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 48, display: 'flex', gap: 12 }}>
                 <button className="rs-btn-primary" style={{ flex: 1 }} onClick={() => setSelectedRecipe(null)}>INITIATE PREP</button>
                 <button className="rs-pill" onClick={() => {
                    localStorage.setItem('rs-chronos-open', JSON.stringify({ title: `Recipes/${selectedRecipe.title}`, root: 'household' }));
                    window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }));
                    setSelectedRecipe(null);
                 }}>ARCHIVE</button>
              </div>
           </div>
         )}
      </Sheet>
    </div>
  )
}
