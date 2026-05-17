import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import MaintenancePulse from '../components/MaintenancePulse.jsx'

/**
 * VehiclePage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Heavy-duty fleet management.
 */

export default function VehiclePage({ onNavigate }) {
  const { token } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles/', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) setVehicles(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchVehicles() }, [fetchVehicles])

  const handleManualUpload = async (e, vehicleId) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingDoc(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/rag/ingest?doc_id=vehicle_${vehicleId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      })
      if (res.ok) alert('MANUAL INDEXED')
    } catch {
      alert('UPLOAD FAILED')
    } finally {
      setUploadingDoc(false)
    }
  }

  const getTypeIcon = (type) => {
    switch (type) {
      case 'moto': return 'motorcycle'
      case 'truck': return 'truck'
      case 'atv': return 'agriculture'
      default: return 'directions_car'
    }
  }

  if (selectedVehicleId) {
    return (
      <div className="rs-foyer">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Maintenance Pulse</h1>
          <button className="rs-pill" onClick={() => setSelectedVehicleId(null)}>← BACK TO FLEET</button>
        </div>
        <div className="rs-card is-wide" style={{ padding: 0, overflow: 'hidden' }}>
          <MaintenancePulse 
            preselectedId={selectedVehicleId} 
            onBack={() => { setSelectedVehicleId(null); fetchVehicles(); }} 
          />
        </div>
      </div>
    )
  }

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">The Garage</h1>
        <div className="rs-greeting-sub">Monitor fleet status and maintenance telemetry.</div>
      </div>

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">SCANNING TRANSPONDERS...</div>
        ) : vehicles.length === 0 ? (
          <div className="rs-card is-wide" style={{ textAlign: 'center', padding: 48 }}>
             <span className="material-symbols-rounded" style={{ fontSize: '3rem', opacity: 0.2 }}>garage</span>
             <p className="rs-card-meta">No vehicles detected in sector.</p>
             <button className="rs-btn-primary" style={{ marginTop: 24 }} onClick={() => setSelectedVehicleId('NEW')}>+ ADD VEHICLE</button>
          </div>
        ) : (
          vehicles.map(v => (
            <div key={v.id} className="rs-card is-wide is-tappable" onClick={() => setSelectedVehicleId(v.id)}>
              <div className="rs-card-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '2rem', color: 'var(--primary)' }}>{getTypeIcon(v.vehicle_type)}</span>
                  <div>
                    <div className="rs-card-value">{v.nickname || 'UNNAMED'}</div>
                    <div className="rs-card-label" style={{ fontSize: '0.65rem' }}>{v.year} {v.make} {v.model}</div>
                  </div>
                </div>
                <div className="rs-status-dot" style={{ background: '#4ade80' }} />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, margin: '20px 0' }}>
                <div>
                  <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>COLOR</div>
                  <div style={{ fontSize: '0.9rem' }}>{v.color || '—'}</div>
                </div>
                <div>
                  <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>VIN</div>
                  <div style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{v.vin ? `...${v.vin.slice(-6)}` : '—'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--md-outline-variant)', paddingTop: 16 }}>
                <button className="rs-pill" onClick={(e) => { e.stopPropagation(); setSelectedVehicleId(v.id); }}>TELEMETRY</button>
                <label className="rs-pill" style={{ cursor: 'pointer' }}>
                  {uploadingDoc ? '...' : 'MANUAL'}
                  <input type="file" style={{ display: 'none' }} onChange={(e) => handleManualUpload(e, v.id)} onClick={e => e.stopPropagation()} />
                </label>
                <button 
                  className="rs-pill is-active" 
                  style={{ marginLeft: 'auto' }}
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    localStorage.setItem('rs-chat-intent', JSON.stringify({ 
                      text: `Status report for the ${v.nickname || v.model}?`, 
                      docId: `vehicle_${v.id}` 
                    }));
                    window.dispatchEvent(new Event('rs-navigate-chat'));
                  }}
                >
                  ASK ASSISTANT
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
