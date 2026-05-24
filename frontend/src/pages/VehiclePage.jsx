import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import MaintenancePulse from '../components/MaintenancePulse.jsx'
import Sheet from '../chrome/Sheet.jsx'
import ChatInterface from '../components/ChatInterface.jsx'

/**
 * VehiclePage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Hangar Telemetry & Fleet Management.
 * Implements 'Double-Bezel' spec sheets and Cockpit density.
 */

export default function VehiclePage({ setAction }) {
  const { token } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [activeAskVehicle, setActiveAskVehicle] = useState(null)

  const fetchVehicles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/vehicles/', { headers: { 'Authorization': `Bearer ${token}` } })
      if (res.ok) setVehicles(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchVehicles() }, [fetchVehicles])

  const getTypeIcon = (type) => {
    switch (type) {
      case 'moto': return 'motorcycle'
      case 'truck': return 'truck'
      case 'atv': return 'agriculture'
      default: return 'directions_car'
    }
  }

  // Contextual Action Bar
  useEffect(() => {
    setAction(
      <div className="rs-chat-input-controls" style={{ width: '100%', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
           <button className="rs-btn-primary" onClick={() => setSelectedVehicleId('NEW')}>
             <span className="material-symbols-rounded">add</span>
             <span className="rs-speak-actions-label">{selectedVehicleId ? 'REGISTER NEW' : 'ADD VEHICLE'}</span>
           </button>
           <button className="rs-pill" onClick={fetchVehicles}>
             <span className="material-symbols-rounded">sync</span>
           </button>
           {selectedVehicleId && (
             <button className="rs-pill is-active" onClick={() => setSelectedVehicleId(null)}>
               <span className="material-symbols-rounded">close</span>
               <span className="rs-speak-actions-label">EXIT TELEMETRY</span>
             </button>
           )}
        </div>
      </div>
    )
    return () => setAction(null)
  }, [selectedVehicleId, setAction, fetchVehicles])

  if (selectedVehicleId) {
    return (
      <div className="rs-foyer animate-page-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">{selectedVehicleId === 'NEW' ? 'New Asset' : 'Vehicle Telemetry'}</h1>
          <div className="rs-greeting-sub">{selectedVehicleId === 'NEW' ? 'Register a new unit to the fleet.' : 'Detailed diagnostic data and maintenance history.'}</div>
        </div>
        <div className="rs-card is-wide is-elev" style={{ padding: 0, overflow: 'hidden', marginTop: 32 }}>
          <div className="rs-card-inner" style={{ padding: 0, border: 'none', background: 'transparent' }}>
            <MaintenancePulse 
              preselectedId={selectedVehicleId} 
              onBack={() => { setSelectedVehicleId(null); fetchVehicles(); }} 
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">The Hangar</h1>
        <div className="rs-greeting-sub">Sector fleet management and maintenance telemetry.</div>
      </div>

      <div className="rs-card-flow">
        {loading && vehicles.length === 0 ? (
          <div className="rs-card-meta" style={{ padding: 64, textAlign: 'center' }}>SCANNING HANGAR TRANSPONDERS...</div>
        ) : vehicles.length === 0 ? (
          <div className="rs-card is-wide" style={{ textAlign: 'center', padding: '64px 24px' }}>
             <span className="material-symbols-rounded" style={{ fontSize: '4rem', opacity: 0.1, marginBottom: 20 }}>garage</span>
             <div className="rs-card-value">Hangar clear</div>
             <div className="rs-card-meta">No active units detected in this sector.</div>
          </div>
        ) : (
          vehicles.map(v => (
            <div key={v.id} className="rs-card is-wide is-tappable animate-page-in" onClick={() => setSelectedVehicleId(v.id)}>
              <div className="rs-card-inner">
                <div className="rs-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'color-mix(in srgb, var(--primary) 10%, var(--bg-base))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '2.5rem' }}>{getTypeIcon(v.vehicle_type)}</span>
                    </div>
                    <div>
                      <div className="rs-card-value" style={{ fontSize: '1.6rem', fontWeight: 800 }}>{v.nickname || 'UNNAMED UNIT'}</div>
                      <div className="rs-card-label" style={{ fontSize: '0.7rem', opacity: 0.5, letterSpacing: '0.1em' }}>{v.year} {v.make} {v.model}</div>
                    </div>
                  </div>
                  <div className="rs-status-strip" style={{ background: 'rgba(74, 222, 128, 0.1)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
                    <span className="rs-status-dot" style={{ background: '#4ade80' }} />
                    <span style={{ fontSize: '0.6rem', fontWeight: 900 }}>NOMINAL</span>
                  </div>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 40, margin: '32px 0', background: 'rgba(255,255,255,0.02)', padding: '24px 32px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>COLORWAY</div>
                    <div className="rs-card-value" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{v.color?.toUpperCase() || '—'}</div>
                  </div>
                  <div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>VIN TELEMETRY</div>
                    <div className="rs-card-value" style={{ fontSize: '1.1rem', fontFamily: 'var(--font-mono)' }}>{v.vin ? `...${v.vin.slice(-8)}` : '—'}</div>
                  </div>
                  <div>
                    <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>SERVICE CLEARANCE</div>
                    <div className="rs-card-value" style={{ fontSize: '1.1rem', color: '#4ade80', fontWeight: 800 }}>GRANTED</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, borderTop: '1px solid var(--md-outline-variant)', paddingTop: 24 }}>
                  <button className="rs-pill is-active" onClick={(e) => { e.stopPropagation(); setSelectedVehicleId(v.id); }}>
                    <span className="material-symbols-rounded">monitor_heart</span>
                    DIAGNOSTICS
                  </button>
                  <label className="rs-pill" style={{ cursor: 'pointer' }} onClick={e => e.stopPropagation()}>
                    <span className="material-symbols-rounded">description</span>
                    {uploadingDoc ? 'INDEXING...' : 'TECH MANUAL'}
                    <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setUploadingDoc(true)
                        const fd = new FormData(); fd.append('file', file)
                        try {
                          await fetch(`/api/rag/ingest?doc_id=vehicle_${v.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
                        } finally { setUploadingDoc(false) }
                    }} />
                  </label>
                  <button 
                    className="rs-pill" 
                    style={{ marginLeft: 'auto', background: 'color-mix(in srgb, var(--primary) 10%, transparent)', border: '1px solid var(--primary)' }}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setActiveAskVehicle(v);
                    }}
                  >
                    <span className="material-symbols-rounded">psychology</span>
                    ASK RIVER
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {/* Ask Vehicle Drawer */}
      <Sheet 
        open={!!activeAskVehicle} 
        onClose={() => setActiveAskVehicle(null)} 
      >
        {activeAskVehicle && (
          <div style={{ height: '70vh' }}>
            <ChatInterface 
              embedded={true} 
              onClose={() => setActiveAskVehicle(null)}
              initialIntent={{ 
                text: `River, status on the ${activeAskVehicle.nickname || activeAskVehicle.model}.`, 
                docId: `vehicle_${activeAskVehicle.id}` 
              }} 
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
