// =============================================================================
// src/pages/VehiclePage.jsx
//
// Garage page: Lightweight overview of the user's vehicle fleet.
// Deeper maintenance logs and inspections are handled by MaintenancePulse.jsx.
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import MaintenancePulse from '../components/MaintenancePulse.jsx'
import './VehiclePage.css'

export default function VehiclePage() {
  const { token } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles/', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch vehicles')
      const data = await res.json()
      setVehicles(data)
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

  if (selectedVehicleId) {
    return (
      <div className="page-wrap vehicle-page">
        <div className="page-header-row">
          <div>
            <div className="page-breadcrumb">
              <span>◢</span><span>ASSETS</span>
              <span className="page-breadcrumb-sep">/</span>
              <span>GARAGE</span>
              <span className="page-breadcrumb-sep">/</span>
              <span>MAINTENANCE</span>
            </div>
            <h1 className="page-title">Vehicle Pulse</h1>
          </div>
        </div>
        <MaintenancePulse 
          preselectedId={selectedVehicleId} 
          onBack={() => { setSelectedVehicleId(null); fetchVehicles(); }} 
        />
      </div>
    )
  }

  return (
    <div className="page-wrap vehicle-page">
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>ASSETS</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>GARAGE</span>
          </div>
          <h1 className="page-title">The Garage</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            Manage your fleet and service status.
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setSelectedVehicleId('NEW')}>
          + ADD VEHICLE
        </button>
      </div>

      {loading ? (
        <div className="vh-loading">SCANNING TRANSPONDERS...</div>
      ) : error ? (
        <div className="vh-error">{error}</div>
      ) : vehicles.length === 0 ? (
        <div className="card vh-empty">
          <span className="material-symbols-rounded">garage</span>
          <p>Your garage is empty. Add your first vehicle to start tracking maintenance.</p>
          <button className="btn btn--secondary" onClick={() => setSelectedVehicleId('NEW')}>ADD VEHICLE</button>
        </div>
      ) : (
        <div className="vh-grid">
          {vehicles.map(v => (
            <div key={v.id} className="card vh-card" onClick={() => setSelectedVehicleId(v.id)}>
              <div className="vh-card-header">
                <span className="material-symbols-rounded vh-type-icon">{getTypeIcon(v.vehicle_type)}</span>
                <div className="vh-card-meta">
                  <div className="vh-nickname">{v.nickname || 'UNNAMED'}</div>
                  <div className="vh-id">{v.year} {v.make} {v.model}</div>
                </div>
              </div>
              
              <div className="vh-stats">
                <div className="vh-stat">
                  <label>COLOR</label>
                  <span>{v.color || '—'}</span>
                </div>
                <div className="vh-stat">
                  <label>VIN</label>
                  <span>{v.vin ? `...${v.vin.slice(-6)}` : '—'}</span>
                </div>
              </div>

              <div className="vh-footer">
                <button className="btn btn--ghost btn--xs">VIEW SPECS</button>
                <button className="btn btn--primary btn--xs">LOG SERVICE</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
