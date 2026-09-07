import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import MaintenancePulse from '../components/MaintenancePulse.jsx'
import Sheet from '../chrome/Sheet.jsx'
import ChatInterface from '../components/ChatInterface.jsx'

/**
 * VehiclePage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Two-Tier Hangar Fleet Hub & Telemetry Cockpit.
 * Tier 1: Normal Hangar Landing Hub with Fleet Overview Cards.
 * Tier 2: Focused Vehicle Telemetry Cockpit (entered on card tap).
 */

export default function VehiclePage({ setAction, onNavigate }) {
  const { token } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
  const [activeAskVehicle, setActiveAskVehicle] = useState(null)
  const [showAskRiverAll, setShowAskRiverAll] = useState(false)

  // New vehicle form state
  const [newVehicle, setNewVehicle] = useState({
    make: '', model: '', year: '', trim: '', nickname: '',
    vehicle_type: 'auto', color: '', vin: '', license_plate: ''
  })
  const [savingNew, setSavingNew] = useState(false)
  const [newError, setNewError] = useState('')

  const fetchVehicles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/vehicles/', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setVehicles(data)
      } else {
        setError('Failed to load fleet')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchVehicles()
  }, [fetchVehicles])

  const getTypeIcon = (type) => {
    switch (type) {
      case 'moto': return 'motorcycle'
      case 'truck': return 'truck'
      case 'atv': return 'agriculture'
      default: return 'directions_car'
    }
  }

  // Fleet overview calculations
  const fleetStats = useMemo(() => {
    let totalMiles = 0
    let overdueCount = 0
    let motos = 0
    let autos = 0

    vehicles.forEach(v => {
      const odo = v.usage_readings?.[0]?.value || 0
      totalMiles += odo
      if (v.vehicle_type === 'moto') motos++
      else autos++

      // Check if any checkpoints are due or overdue
      const checkPoints = v.check_points || []
      const hasOverdue = checkPoints.some(cp => {
        if (cp.due_at_miles && odo >= cp.due_at_miles) return true
        if (cp.interval_miles && (odo % cp.interval_miles <= 500 && odo >= cp.interval_miles)) return true
        return false
      })
      if (hasOverdue) overdueCount++
    })

    return {
      activeCount: vehicles.length,
      motos,
      autos,
      totalMiles,
      overdueCount,
      indexedCount: vehicles.length // All dossiers stored in RAG
    }
  }, [vehicles])

  // Contextual Action Bar for Landing View
  useEffect(() => {
    if (!selectedVehicleId) {
      setAction(
        <div className="rs-chat-input-controls" style={{ width: '100%', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="rs-btn-primary" onClick={() => setSelectedVehicleId('NEW')}>
              <span className="material-symbols-rounded">add</span>
              <span className="rs-speak-actions-label">REGISTER VEHICLE</span>
            </button>
            <button className="rs-pill is-active" onClick={() => setShowAskRiverAll(true)}>
              <span className="material-symbols-rounded">psychology</span>
              <span className="rs-speak-actions-label">ASK RIVER</span>
            </button>
          </div>
        </div>
      )
    }
    return () => setAction(null)
  }, [selectedVehicleId, setAction])

  const handleCreateVehicle = async (e) => {
    e.preventDefault()
    if (!newVehicle.make.trim() || !newVehicle.model.trim()) {
      setNewError('Make and Model are required.')
      return
    }
    setSavingNew(true)
    setNewError('')
    try {
      const res = await fetch('/api/vehicles/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...newVehicle,
          year: newVehicle.year ? Number(newVehicle.year) : null
        })
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.detail || 'Creation failed')
      }
      const created = await res.json()
      await fetchVehicles()
      setSelectedVehicleId(created.id)
      setNewVehicle({
        make: '', model: '', year: '', trim: '', nickname: '',
        vehicle_type: 'auto', color: '', vin: '', license_plate: ''
      })
    } catch (err) {
      setNewError(err.message)
    } finally {
      setSavingNew(false)
    }
  }

  // ---------------------------------------------------------------------------
  // STATE 1: REGISTER NEW ASSET FORM
  // ---------------------------------------------------------------------------
  if (selectedVehicleId === 'NEW') {
    return (
      <div className="rs-foyer animate-page-in rs-mode-hangar">
        <div className="rs-foyer-head" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button className="rs-pill" onClick={() => setSelectedVehicleId(null)}>
            <span className="material-symbols-rounded">arrow_back</span>
            <span>HANGAR</span>
          </button>
          <span className="rs-header-sep" style={{ opacity: 0.3 }}>/</span>
          <h1 className="rs-greeting" style={{ margin: 0 }}>Register New Asset</h1>
        </div>

        <div className="rs-card is-wide is-elev" style={{ borderTop: '2px solid var(--primary)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-head" style={{ marginBottom: 20 }}>
              <span className="rs-card-label" style={{ color: 'var(--primary)' }}>ASSET SPECIFICATIONS &amp; HARDWARE TELEMETRY</span>
            </div>

            {newError && (
              <div className="mp-error" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,139,139,0.1)', color: 'var(--rs-status-critical, #ff8b8b)', border: '1px solid rgba(255,139,139,0.3)' }}>
                {newError}
              </div>
            )}

            <form onSubmit={handleCreateVehicle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">MAKE *</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. Honda, Buick, CFMoto"
                    value={newVehicle.make}
                    onChange={e => setNewVehicle({ ...newVehicle, make: e.target.value })}
                    required
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">MODEL *</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. Rebel 500, Verano, Papio XO-1"
                    value={newVehicle.model}
                    onChange={e => setNewVehicle({ ...newVehicle, model: e.target.value })}
                    required
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">YEAR</span>
                  <input
                    className="cockpit-input-raw"
                    type="number"
                    placeholder="e.g. 2026"
                    value={newVehicle.year}
                    onChange={e => setNewVehicle({ ...newVehicle, year: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">TRIM</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. SE, Convenience"
                    value={newVehicle.trim}
                    onChange={e => setNewVehicle({ ...newVehicle, trim: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">NICKNAME</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. The Rebel, Clara, Papo"
                    value={newVehicle.nickname}
                    onChange={e => setNewVehicle({ ...newVehicle, nickname: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">TYPE</span>
                  <select
                    className="cockpit-input-raw"
                    style={{ background: 'transparent', cursor: 'pointer' }}
                    value={newVehicle.vehicle_type}
                    onChange={e => setNewVehicle({ ...newVehicle, vehicle_type: e.target.value })}
                  >
                    <option value="moto" style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>Motorcycle</option>
                    <option value="auto" style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>Automobile</option>
                    <option value="truck" style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>Truck</option>
                    <option value="atv" style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>ATV / UTV</option>
                    <option value="other" style={{ background: 'var(--bg-base)', color: 'var(--fg)' }}>Other</option>
                  </select>
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">COLORWAY</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="e.g. Matte Black, Summit White"
                    value={newVehicle.color}
                    onChange={e => setNewVehicle({ ...newVehicle, color: e.target.value })}
                  />
                </div>
                <div className="cockpit-input-box">
                  <span className="card-metric-label">VIN</span>
                  <input
                    className="cockpit-input-raw"
                    placeholder="17-character VIN (optional)"
                    value={newVehicle.vin}
                    onChange={e => setNewVehicle({ ...newVehicle, vin: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button type="button" className="rs-pill" onClick={() => setSelectedVehicleId(null)}>
                  CANCEL
                </button>
                <button type="submit" className="rs-btn-primary" disabled={savingNew}>
                  <span className="material-symbols-rounded">check</span>
                  <span>{savingNew ? 'SAVING...' : 'REGISTER ASSET'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // STATE 2: ACTIVE VEHICLE TELEMETRY COCKPIT
  // ---------------------------------------------------------------------------
  if (selectedVehicleId) {
    return (
      <div className="rs-mode-workshop">
        <MaintenancePulse
          preselectedId={selectedVehicleId}
          onBack={() => {
            setSelectedVehicleId(null)
            fetchVehicles()
          }}
          onVehicleChange={(id) => setSelectedVehicleId(id)}
          vehicles={vehicles}
          onRefreshVehicles={fetchVehicles}
          setAction={setAction}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // DEFAULT STATE: THE HANGAR LANDING HUB (No vehicle pre-selected)
  // ---------------------------------------------------------------------------
  return (
    <div className="rs-foyer rs-mode-hangar animate-page-in">
      {/* Foyer Header */}
      <div className="rs-foyer-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 className="rs-greeting">The Hangar</h1>
          <div className="rs-greeting-sub">Sector fleet management and maintenance telemetry.</div>
        </div>
        <button className="rs-pill is-active" onClick={() => setSelectedVehicleId('NEW')} title="Register new asset">
          <span className="material-symbols-rounded">add</span>
          <span>REGISTER VEHICLE</span>
        </button>
      </div>

      {/* Fleet Summary Stat Strip */}
      <div className="cockpit-stats-grid">
        <div className="cockpit-stat-tile">
          <span className="card-metric-label">ACTIVE UNITS</span>
          <div className="stat-num">{fleetStats.activeCount} <span className="stat-unit">ASSETS</span></div>
          <div className="stat-sub">{fleetStats.motos} Motos · {fleetStats.autos} Autos</div>
        </div>
        <div className="cockpit-stat-tile">
          <span className="card-metric-label">FLEET HEALTH</span>
          <div className="stat-num" style={{ color: fleetStats.overdueCount > 0 ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }}>
            {fleetStats.overdueCount > 0 ? `${fleetStats.overdueCount} SERVICE DUE` : 'ALL NOMINAL'}
          </div>
          <div className="stat-sub">{fleetStats.overdueCount > 0 ? 'Milestone inspection pending' : 'All systems operating nominally'}</div>
        </div>
        <div className="cockpit-stat-tile">
          <span className="card-metric-label">CUMULATIVE MILEAGE</span>
          <div className="stat-num">{fleetStats.totalMiles.toLocaleString()} <span className="stat-unit">MI</span></div>
          <div className="stat-sub">Combined sector travel</div>
        </div>
        <div className="cockpit-stat-tile">
          <span className="card-metric-label">TECHNICAL DOSSIERS</span>
          <div className="stat-num">{fleetStats.indexedCount} <span className="stat-unit">INDEXED</span></div>
          <div className="stat-sub">Service manuals linked to RAG</div>
        </div>
      </div>

      {/* Sector Vehicles Grid */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
        <span className="card-metric-label" style={{ fontSize: '0.72rem', letterSpacing: '0.12em' }}>
          SECTOR VEHICLES ({vehicles.length})
        </span>
      </div>

      {loading && vehicles.length === 0 ? (
        <div className="rs-card is-wide" style={{ padding: 64, textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '3rem', color: 'var(--primary)', opacity: 0.6, animation: 'spin 2s linear infinite' }}>sync</span>
          <div className="card-metric-label" style={{ marginTop: 16 }}>SCANNING HANGAR TRANSPONDERS...</div>
        </div>
      ) : (
        <div className="hangar-fleet-cards-grid">
          {vehicles.map(v => {
            const odo = v.usage_readings?.[0]?.value || 0
            const checkPoints = v.check_points || []
            const isDue = checkPoints.some(cp => {
              if (cp.due_at_miles && odo >= cp.due_at_miles) return true
              if (cp.interval_miles && (odo >= cp.interval_miles && odo % cp.interval_miles <= 500)) return true
              return false
            })

            // Calculate next milestone label
            let nextMilestone = 'NOMINAL'
            const upcoming = checkPoints
              .map(cp => cp.due_at_miles || cp.interval_miles)
              .filter(m => m && m > 0)
              .sort((a, b) => a - b)
            const nextVal = upcoming.find(m => m > odo) || (upcoming[0] ? upcoming[0] : null)
            if (nextVal) {
              nextMilestone = `${nextVal.toLocaleString()} MI`
            }

            return (
              <div
                key={v.id}
                className="hangar-vehicle-card"
                onClick={() => setSelectedVehicleId(v.id)}
                title={`Open ${v.nickname || v.model} Telemetry Cockpit`}
              >
                <div className="hangar-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div className="vehicle-icon-badge">
                      <span className="material-symbols-rounded">{getTypeIcon(v.vehicle_type)}</span>
                    </div>
                    <div className="vehicle-card-titles">
                      <div className="vehicle-card-name">{v.nickname || `${v.make} ${v.model}`}</div>
                      <div className="vehicle-card-sub">{v.year || ''} {v.make} {v.model} {v.trim || ''}</div>
                    </div>
                  </div>
                  <div
                    className="rs-status-strip"
                    style={isDue ? {
                      color: 'var(--rs-status-critical, #ff8b8b)',
                      borderColor: 'rgba(255,139,139,0.3)',
                      background: 'rgba(255,139,139,0.1)'
                    } : {
                      color: 'var(--rs-status-nominal, #4ade80)',
                      borderColor: 'rgba(74,222,128,0.3)',
                      background: 'rgba(74,222,128,0.1)'
                    }}
                  >
                    <span
                      className="rs-status-dot"
                      style={{ background: isDue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }}
                    />
                    <span style={{ fontSize: '0.62rem', fontWeight: 900 }}>
                      {isDue ? 'SERVICE DUE' : 'NOMINAL'}
                    </span>
                  </div>
                </div>

                <div className="hangar-card-metrics">
                  <div className="card-metric-col">
                    <span className="card-metric-label">CURRENT ODOMETER</span>
                    <div className="card-metric-val">{odo.toLocaleString()} <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>MI</span></div>
                  </div>
                  <div className="card-metric-col">
                    <span className="card-metric-label">NEXT MILESTONE</span>
                    <div className="card-metric-val" style={{ color: isDue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--fg)' }}>
                      {nextMilestone}
                    </div>
                  </div>
                </div>

                <div className="hangar-card-footer">
                  <span className="hangar-card-scope-hint">
                    <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>tune</span>
                    <span>{checkPoints.length} Checkpoints Configured</span>
                  </span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>INSPECT</span>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>arrow_forward</span>
                  </span>
                </div>
              </div>
            )
          })}

          {/* Register New Asset Card */}
          <div
            className="hangar-vehicle-card add-vehicle-card"
            onClick={() => setSelectedVehicleId('NEW')}
            title="Register another vehicle to your hangar"
          >
            <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', color: 'var(--primary)', opacity: 0.8 }}>
              add_circle
            </span>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--fg)' }}>REGISTER NEW ASSET</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--md-on-surface-variant)', maxWidth: 220 }}>
              Add a motorcycle, car, truck, or recreational unit to your sector hangar.
            </div>
          </div>
        </div>
      )}

      {/* Ask River Fleet Drawer */}
      <Sheet open={showAskRiverAll} onClose={() => setShowAskRiverAll(false)}>
        {showAskRiverAll && (
          <div style={{ height: '70vh' }}>
            <ChatInterface
              embedded={true}
              onClose={() => setShowAskRiverAll(false)}
              initialIntent={{
                text: 'River, provide an overview of our entire fleet maintenance readiness and pending service.',
                docId: 'fleet_overview'
              }}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
