import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@context/AuthContext'
import BarcodeScanner from '@components/BarcodeScanner'
import AssetDetailModal from '@components/AssetDetailModal'
import HomeAuditModal from '@components/HomeAuditModal'
import RoomSweepModal from '@components/RoomSweepModal'
import ReassignHomeModal from '@components/ReassignHomeModal'

/**
 * InventoryPage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Asset tracking with 'Double-Bezel' architecture and 'Cockpit' density.
 */

export default function InventoryPage({ setAction }) {
  const { token, user } = useAuth()
  const [homeId, setHomeId] = useState(null)
  const [homes, setHomes] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [auditModalOpen, setAuditModalOpen] = useState(false)
  const [sweepModalOpen, setSweepModalOpen] = useState(false)
  const [reassignModalOpen, setReassignModalOpen] = useState(false)
  const [activeItem, setActiveItem] = useState(null)

  const fetchItems = useCallback(async (activeId = null) => {
    setLoading(true)
    setError(null)
    try {
      const homesRes = await fetch('/api/inventory/homes', { headers: { Authorization: `Bearer ${token}` } })
      if (!homesRes.ok) throw new Error('Failed to fetch homes')
      const fetchedHomes = await homesRes.json()
      setHomes(fetchedHomes)
      
      if (fetchedHomes.length === 0) {
        setItems([])
        setHomeId(null)
        return
      }
      
      const targetHomeId = activeId || fetchedHomes[0].id
      setHomeId(targetHomeId)

      const res = await fetch(`/api/inventory/homes/${targetHomeId}/items`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setItems(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchItems() }, [fetchItems])

  const createHome = async (e) => {
    e.preventDefault();
    const name = e.target.elements.homeName.value;
    try {
      const res = await fetch('/api/inventory/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        fetchItems();
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const filtered = useMemo(() => (items || []).filter(i => 
    (i.name || '').toLowerCase().includes(query.toLowerCase()) || 
    (i.category || '').toLowerCase().includes(query.toLowerCase())
  ), [items, query])

  const stats = useMemo(() => {
    let value = 0;
    let missingDocs = 0;
    items.forEach(i => {
      value += (i.replacement_cost || i.purchase_price || 0);
      if (!i.serial_number || !i.replacement_cost) missingDocs++;
    });
    return {
      total: items.length,
      value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value),
      missingDocs
    };
  }, [items]);

  const handleScanDetected = async (code) => {
    setScannerOpen(false)
    try {
      const res = await fetch(`/api/inventory/scan/${code}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const item = await res.json()
        setActiveItem(item)
      } else if (res.status === 404) {
        if (window.confirm('Asset not found in Stash. Look up product details via UPC?')) {
          setLoading(true);
          try {
            const upcRes = await fetch(`/api/inventory/lookup/upc/${code}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (upcRes.ok) {
              const product = await upcRes.json();
              setActiveItem({
                 _isNew: true,
                 name: product.name,
                 manufacturer: product.manufacturer || '',
                 category: product.category || 'OTHER',
                 model_number: product.model_number || '',
                 description: product.description || ''
              });
            } else {
              alert('Product lookup failed. You can add it manually.');
              setActiveItem({ _isNew: true, serial_number: code }); // Use as serial/identifier just in case
            }
          } finally {
            setLoading(false);
          }
        }
      } else {
        alert('Item not found for barcode: ' + code)
      }
    } catch (err) {
      alert('Error scanning item: ' + err.message)
    }
  }

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls rs-w-full">
        <div className="rs-flex rs-gap-3 rs-items-center rs-w-full">
          <div className="rs-chat-input-container rs-grow" style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', background: 'color-mix(in srgb, var(--md-surface-container-low) 60%, transparent)' }}>
            <div className="rs-flex rs-items-center rs-gap-3">
              <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>search</span>
              <input 
                type="text" 
                className="rs-w-full rs-type-small rs-fw-600" style={{ all: 'unset' }} 
                placeholder="IDENTIFY ASSET..." 
                value={query} 
                onChange={e => setQuery(e.target.value)} 
              />
              {query && (
                <button className="rs-pill rs-p-1" onClick={() => setQuery('')}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
                </button>
              )}
            </div>
          </div>
          <button className="rs-btn-primary" onClick={() => setScannerOpen(true)} style={{ height: 48, padding: '0 var(--rs-space-5)' }}>
            <span className="material-symbols-rounded">barcode_scanner</span>
            <span className="rs-speak-actions-label">SCAN</span>
          </button>
          <button className="rs-btn-primary rs-c-warning" onClick={() => setAuditModalOpen(true)} style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'rgba(250,204,21,0.2)' }} disabled={!homeId}>
            <span className="material-symbols-rounded">fact_check</span>
            <span className="rs-speak-actions-label">AUDIT</span>
          </button>
          <button className="rs-btn-primary" onClick={() => setSweepModalOpen(true)} style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-tertiary)', color: 'var(--md-on-tertiary)' }} disabled={!homeId}>
            <span className="material-symbols-rounded">360</span>
            <span className="rs-speak-actions-label">ROOM SWEEP</span>
          </button>
          <button className="rs-btn-primary" onClick={() => setActiveItem({ _isNew: true })} style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-primary)', color: 'var(--md-on-primary)' }} disabled={!homeId}>
            <span className="material-symbols-rounded">add</span>
            <span className="rs-speak-actions-label">ADD ASSET</span>
          </button>
          <a href={homeId ? `/api/inventory/homes/${homeId}/labels.pdf?token=${token}` : '#'} target="_blank" rel="noreferrer" className="rs-btn-primary rs-flex rs-items-center rs-gap-2" style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', textDecoration: 'none' }} disabled={!homeId} title="Print QR Labels">
            <span className="material-symbols-rounded">print</span>
            <span className="rs-speak-actions-label">LABELS</span>
          </a>
          <a href={homeId ? `/api/inventory/homes/${homeId}/manifest?format=pdf&token=${token}` : '#'} target="_blank" rel="noreferrer" className="rs-btn-primary rs-flex rs-items-center rs-gap-2" style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', textDecoration: 'none' }} disabled={!homeId} title="Download PDF Dossier">
            <span className="material-symbols-rounded">picture_as_pdf</span>
            <span className="rs-speak-actions-label">DOSSIER</span>
          </a>
          <a href={homeId ? `/api/inventory/homes/${homeId}/manifest?format=csv&token=${token}` : '#'} target="_blank" rel="noreferrer" className="rs-btn-primary rs-flex rs-items-center rs-gap-2" style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)', textDecoration: 'none' }} disabled={!homeId} title="Download CSV Manifest">
            <span className="material-symbols-rounded">csv</span>
            <span className="rs-speak-actions-label">CSV</span>
          </a>
          <button className="rs-btn-primary" onClick={() => setReassignModalOpen(true)} style={{ height: 48, padding: '0 var(--rs-space-5)', background: 'var(--md-error-container)', color: 'var(--md-on-error-container)' }} disabled={!homeId || homes.length < 2} title="Move All Assets (PCS)">
            <span className="material-symbols-rounded">local_shipping</span>
            <span className="rs-speak-actions-label">MOVE</span>
          </button>
          <button className="rs-pill" onClick={fetchItems} title="Refresh Stash">
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
    return () => setAction(null)
  }, [query, setAction, fetchItems, homeId])

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head rs-flex rs-justify-between rs-items-start">
        <div>
          <h1 className="rs-greeting">The Stash</h1>
          <div className="rs-greeting-sub">Operational asset tracking and sector inventory.</div>
        </div>
        {homes && homes.length > 1 && (
          <select 
            className="rs-input" 
            style={{ width: 'auto', background: 'var(--md-surface-container)' }} 
            value={homeId || ''} 
            onChange={(e) => fetchItems(e.target.value)}
          >
            {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        )}
      </div>

      {homes && homes.length === 0 && (
        <div className="rs-card is-wide rs-mt-6 rs-p-7 rs-text-center">
          <span className="material-symbols-rounded rs-mb-4 rs-c-primary" style={{ fontSize: '3rem' }}>home</span>
          <h2 style={{ margin: '0 0 var(--rs-space-2) 0', fontSize: '1.5rem' }}>Welcome to The Stash</h2>
          <div className="rs-card-meta rs-mb-5">Before you can track assets, you need to create a Home or Location.</div>
          <form onSubmit={createHome} className="rs-flex rs-gap-3 rs-justify-center" style={{ maxWidth: 400, margin: '0 auto' }}>
            <input type="text" name="homeName" className="rs-input rs-grow" placeholder="e.g. River's House, Storage Unit" autoFocus required />
            <button type="submit" className="rs-btn-primary">CREATE</button>
          </form>
        </div>
      )}

      {homes && homes.length > 0 && <>

      {scannerOpen && (
        <BarcodeScanner onDetected={handleScanDetected} onClose={() => setScannerOpen(false)} />
      )}

      {auditModalOpen && homeId && (
        <HomeAuditModal 
          homeId={homeId} 
          token={token} 
          onClose={() => setAuditModalOpen(false)} 
        />
      )}

      {reassignModalOpen && homeId && (
        <ReassignHomeModal
          homeId={homeId}
          homes={homes}
          token={token}
          onClose={() => setReassignModalOpen(false)}
          onComplete={() => {
            setReassignModalOpen(false);
            fetchItems(homeId); // Refresh after move
          }}
        />
      )}

      {activeItem && (
        <AssetDetailModal 
          item={activeItem._isNew ? null : activeItem} 
          homeId={homeId}
          token={token} 
          onUpdate={(updatedItem) => {
            setActiveItem(updatedItem)
            if (activeItem._isNew) {
               setItems(prev => [...prev, updatedItem])
            } else {
               setItems(items.map(i => i.id === updatedItem.id ? updatedItem : i))
            }
          }} 
          onClose={() => setActiveItem(null)} 
        />
      )}

      {sweepModalOpen && homeId && (
        <RoomSweepModal 
          homeId={homeId} 
          onClose={() => setSweepModalOpen(false)} 
          onComplete={fetchItems} 
        />
      )}

      {/* Cockpit Analytics Slate */}
      <div className="rs-card-flow rs-mb-6">
        <div className="rs-card is-wide is-elev">
           <div className="rs-card-inner">
             <div className="rs-flex rs-flex-wrap" style={{ gap: 64 }}>
               <div>
                 <div className="rs-card-label">TOTAL ASSETS</div>
                 <div className="rs-card-value rs-mono" style={{ fontSize: '2.5rem' }}>{stats.total}</div>
               </div>
               <div>
                 <div className="rs-card-label rs-c-primary">REPLACEMENT VALUE</div>
                 <div className="rs-card-value rs-mono" style={{ fontSize: '2.5rem' }}>{stats.value}</div>
               </div>
               <div>
                 <div className="rs-card-label" style={{ color: 'var(--warn)' }}>MISSING INFO</div>
                 <div className="rs-card-value rs-mono" style={{ fontSize: '2.5rem', color: stats.missingDocs > 0 ? 'var(--warn)' : 'inherit' }}>{stats.missingDocs}</div>
               </div>
               <div className="rs-grow rs-flex rs-items-center rs-justify-end" style={{ minWidth: 200 }}>
                  <div className="rs-status-strip">
                    <span className="rs-status-dot" style={{ background: stats.missingDocs === 0 ? '#4ade80' : 'var(--warn)' }} />
                    <span>{stats.missingDocs === 0 ? 'CLAIM READY' : 'NEEDS ATTENTION'}</span>
                  </div>
               </div>
             </div>
           </div>
        </div>
      </div>

      <div className="rs-card-flow">
        {loading && items.length === 0 ? (
          <div className="rs-card-meta rs-p-7 rs-text-center">INITIALIZING ASSET SCAN...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card is-wide rs-text-center" style={{ padding: '64px 24px' }}>
            <span className="material-symbols-rounded rs-mb-4" style={{ fontSize: '3rem', opacity: 0.1 }}>inventory_2</span>
            <div className="rs-card-value">Frequency clear</div>
            <div className="rs-card-meta">No assets identified with current query.</div>
          </div>
        ) : (
          filtered.map(item => (
            <div key={item.id} className="rs-card is-tappable animate-page-in" onClick={() => setActiveItem(item)}>
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <span className="rs-card-label">{(item.category || 'ASSET').toUpperCase()}</span>
                  <div className="rs-status-strip" style={{ background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface)' }}>
                    <span className="rs-mono rs-fw-900">{item.quantity}</span>
                    <span className="rs-type-nano">{(item.unit || 'UNIT').toUpperCase()}</span>
                  </div>
                </div>
                <div className="rs-card-value rs-mb-1 rs-type-h3">{item.name}</div>
                <div className="rs-card-meta rs-mb-3">
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', verticalAlign: 'middle', marginRight: 'var(--rs-space-2)' }}>location_on</span>
                  {item.location || 'SECTOR UNKNOWN'}
                </div>
                
                {(item.receipt_url || item.warranty_url) && (
                  <div className="rs-flex rs-gap-2 rs-mb-3">
                    {item.receipt_url && <span className="rs-card-meta rs-c-nominal"><span className="material-symbols-rounded" style={{ fontSize: '1rem', verticalAlign: 'middle' }}>receipt</span> Receipt</span>}
                    {item.warranty_url && <span className="rs-card-meta rs-c-nominal"><span className="material-symbols-rounded" style={{ fontSize: '1rem', verticalAlign: 'middle' }}>verified</span> Warranty</span>}
                  </div>
                )}
                
                <div className="rs-flex rs-gap-3" style={{ marginTop: 'auto' }}>
                  <button className="rs-pill is-active rs-grow" onClick={(e) => { e.stopPropagation(); setActiveItem(item); }}>ADJUST</button>
                  <button className="rs-pill" onClick={(e) => {
                     e.stopPropagation();
                     localStorage.setItem('rs-chat-intent', JSON.stringify({ text: `River, status brief on ${item.name}.`, docId: null }));
                     window.dispatchEvent(new Event('rs-navigate-chat'));
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>psychology</span>
                    ASK
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      </>}
    </div>
  )
}
