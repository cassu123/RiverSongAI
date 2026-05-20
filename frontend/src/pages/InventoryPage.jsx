import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/BarcodeScanner'

/**
 * InventoryPage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Asset tracking with 'Double-Bezel' architecture and 'Cockpit' density.
 */

export default function InventoryPage({ setAction }) {
  const { token } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/inventory/items', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setItems(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchItems() }, [fetchItems])

  const filtered = useMemo(() => (items || []).filter(i => 
    (i.name || '').toLowerCase().includes(query.toLowerCase()) || 
    (i.category || '').toLowerCase().includes(query.toLowerCase())
  ), [items, query])

  const stats = useMemo(() => ({
    total: items.length,
    low: items.filter(i => i.quantity > 0 && i.quantity <= 2).length,
    out: items.filter(i => i.quantity <= 0).length,
  }), [items])

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
          <div className="rs-chat-input-container" style={{ flex: 1, padding: '8px 16px', background: 'color-mix(in srgb, var(--md-surface-container-low) 60%, transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="material-symbols-rounded" style={{ opacity: 0.5 }}>search</span>
              <input 
                type="text" 
                style={{ all: 'unset', width: '100%', fontSize: '0.95rem', fontWeight: 600 }} 
                placeholder="IDENTIFY ASSET..." 
                value={query} 
                onChange={e => setQuery(e.target.value)} 
              />
              {query && (
                <button className="rs-pill" style={{ padding: 4 }} onClick={() => setQuery('')}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
                </button>
              )}
            </div>
          </div>
          <button className="rs-btn-primary" onClick={() => setScannerOpen(true)} style={{ height: 48, padding: '0 24px' }}>
            <span className="material-symbols-rounded">barcode_scanner</span>
            <span className="rs-speak-actions-label">SCAN</span>
          </button>
          <button className="rs-pill" onClick={fetchItems} title="Refresh Stash">
            <span className="material-symbols-rounded">sync</span>
          </button>
        </div>
      </div>
    )
    return () => setAction(null)
  }, [query, setAction, fetchItems])

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">The Stash</h1>
        <div className="rs-greeting-sub">Operational asset tracking and sector inventory.</div>
      </div>

      {scannerOpen && (
        <BarcodeScanner onDetected={(code) => { setScannerOpen(false) }} onClose={() => setScannerOpen(false)} />
      )}

      {/* Cockpit Analytics Slate */}
      <div className="rs-card-flow" style={{ marginBottom: 32 }}>
        <div className="rs-card is-wide is-elev">
           <div className="rs-card-inner">
             <div style={{ display: 'flex', gap: 64, flexWrap: 'wrap' }}>
               <div>
                 <div className="rs-card-label">TOTAL ASSETS</div>
                 <div className="rs-card-value" style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)' }}>{stats.total}</div>
               </div>
               <div>
                 <div className="rs-card-label" style={{ color: 'var(--warn)' }}>LOW THRESHOLD</div>
                 <div className="rs-card-value" style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)', color: stats.low > 0 ? 'var(--warn)' : 'inherit' }}>{stats.low}</div>
               </div>
               <div>
                 <div className="rs-card-label" style={{ color: 'var(--md-error)' }}>DEPLETED</div>
                 <div className="rs-card-value" style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)', color: stats.out > 0 ? 'var(--md-error)' : 'inherit' }}>{stats.out}</div>
               </div>
               <div style={{ flex: 1, minWidth: 200, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <div className="rs-status-strip">
                    <span className="rs-status-dot" style={{ background: '#4ade80' }} />
                    <span>STASH NOMINAL</span>
                  </div>
               </div>
             </div>
           </div>
        </div>
      </div>

      <div className="rs-card-flow">
        {loading && items.length === 0 ? (
          <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center' }}>INITIALIZING ASSET SCAN...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card is-wide" style={{ textAlign: 'center', padding: '64px 24px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.1, marginBottom: 16 }}>inventory_2</span>
            <div className="rs-card-value">Frequency clear</div>
            <div className="rs-card-meta">No assets identified with current query.</div>
          </div>
        ) : (
          filtered.map(item => (
            <div key={item.id} className="rs-card is-tappable animate-page-in">
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <span className="rs-card-label">{(item.category || 'ASSET').toUpperCase()}</span>
                  <div className="rs-status-strip" style={{ 
                    background: item.quantity <= 0 ? 'rgba(248,113,113,0.1)' : item.quantity <= 2 ? 'rgba(250,204,21,0.1)' : 'rgba(74,222,128,0.1)',
                    color: item.quantity <= 0 ? '#f87171' : item.quantity <= 2 ? '#facc15' : '#4ade80'
                  }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 900 }}>{item.quantity}</span>
                    <span style={{ fontSize: '0.6rem' }}>{(item.unit || 'UNIT').toUpperCase()}</span>
                  </div>
                </div>
                <div className="rs-card-value" style={{ fontSize: '1.3rem', marginBottom: 4 }}>{item.name}</div>
                <div className="rs-card-meta">
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', verticalAlign: 'middle', marginRight: 6 }}>location_on</span>
                  {item.location || 'SECTOR UNKNOWN'}
                </div>
                
                <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
                  <button className="rs-pill is-active" style={{ flex: 1 }}>ADJUST</button>
                  <button className="rs-pill" onClick={() => {
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
    </div>
  )
}
