import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/BarcodeScanner'

/**
 * InventoryPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Asset tracking and stash management.
 */

export default function InventoryPage({ setAction }) {
  const { token } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [selectedItem, setSelectedVehicle] = useState(null) // reuse same name as other pages for consistency? no.

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/items', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setItems(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchItems() }, [fetchItems])

  const filtered = (items || []).filter(i => 
    (i.name || '').toLowerCase().includes(query.toLowerCase()) || 
    (i.category || '').toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    setAction(
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="rs-card" style={{ flex: 1, padding: '8px 16px', background: 'var(--md-surface-container-low)' }}>
          <input 
            type="text" 
            style={{ all: 'unset', width: '100%', fontSize: '0.9rem' }} 
            placeholder="FILTER STASH..." 
            value={query} 
            onChange={e => setQuery(e.target.value)} 
          />
        </div>
        <button className="rs-pill" onClick={() => setScannerOpen(true)}>
          <span className="material-symbols-rounded">barcode_scanner</span>
          SCAN
        </button>
      </div>
    )
  }, [query, setAction])

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">The Stash</h1>
        <div className="rs-greeting-sub">Manage household assets, consumables, and gear.</div>
      </div>

      {scannerOpen && (
        <BarcodeScanner 
          onDetected={(code) => { console.log(code); setScannerOpen(false); }} 
          onClose={() => setScannerOpen(false)} 
        />
      )}


      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">INVENTORYING ASSETS...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card-meta">No assets found in sector.</div>
        ) : (
          filtered.map(item => (
            <div key={item.id} className="rs-card">
              <div className="rs-card-head">
                <span className="rs-card-label">{(item.category || 'ASSET').toUpperCase()}</span>
                <span className="rs-card-label" style={{ opacity: 1, color: item.quantity > 0 ? '#4ade80' : 'var(--md-error)' }}>
                  {item.quantity} {(item.unit || '').toUpperCase()}
                </span>
              </div>
              <div className="rs-card-value" style={{ fontSize: '1.2rem' }}>{item.name}</div>
              <div className="rs-card-meta">{item.location || 'UNASSIGNED'}</div>
              
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button className="rs-pill" onClick={() => alert('Update locked.')}>ADJUST</button>
                <button className="rs-pill" onClick={() => {
                   localStorage.setItem('rs-chat-intent', JSON.stringify({ 
                      text: `Do we have enough ${item.name}?`, 
                      docId: null 
                    }));
                    window.dispatchEvent(new Event('rs-navigate-chat'));
                }}>ASK</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
