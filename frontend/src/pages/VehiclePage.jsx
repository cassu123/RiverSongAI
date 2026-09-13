import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@context/AuthContext'
import MaintenancePulse from '@components/MaintenancePulse.jsx'
import Sheet from '../chrome/Sheet.jsx'
import ChatInterface from '@components/ChatInterface.jsx'

/**
 * VehiclePage — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * Two-Tier Hangar Fleet Hub & Telemetry Cockpit.
 * Tier 1: Normal Hangar Landing Hub with Fleet Overview Cards.
 * Tier 2: Focused Vehicle Telemetry Cockpit (entered on card tap).
 */

// Vehicle types metered in engine hours rather than road miles.
export const HOUR_METERED_TYPES = new Set(['atv', 'mower', 'tractor', 'generator'])

export const odometerUnit = (vehicleType) =>
  HOUR_METERED_TYPES.has(vehicleType) ? 'HRS' : 'MI'

// A checkpoint is due once its fixed target is reached, or when the odometer
// sits within 500 units of an interval multiple.
export const isServiceDue = (odo, checkPoints) => odo > 0 && checkPoints.some(cp => {
  if (cp.due_at_miles && odo >= cp.due_at_miles) return true
  if (cp.interval_miles && odo >= cp.interval_miles) {
    const past = odo % cp.interval_miles
    return past <= 500 || past >= cp.interval_miles - 500
  }
  return false
})

/**
 * Label for a vehicle's next service target. Past the final configured target
 * there is nothing upcoming — say so rather than pointing at one already gone by.
 */
export const nextMilestoneLabel = (odo, checkPoints, unit = 'MI') => {
  const upcoming = checkPoints
    .map(cp => cp.due_at_miles || cp.interval_miles)
    .filter(m => m && m > 0)
    .sort((a, b) => a - b)
  if (upcoming.length === 0) return 'NONE SET'
  const nextVal = upcoming.find(m => m > odo) ?? null
  return nextVal != null ? `${nextVal.toLocaleString()} ${unit}` : 'ALL PASSED'
}

export default function VehiclePage({ setAction, onNavigate }) {
  const { token } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)
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
    setError(null)
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
      const odo = v.current_odometer ?? (v.usage_readings?.[0]?.value || 0)
      // Hour-metered units (ATV, mower, tractor) don't contribute road miles.
      if (!HOUR_METERED_TYPES.has(v.vehicle_type)) totalMiles += odo
      if (v.vehicle_type === 'moto') motos++
      else autos++

      // Check if any checkpoints are due or overdue (only if vehicle has recorded mileage)
      if (isServiceDue(odo, v.check_points || [])) overdueCount++
    })

    return {
      activeCount: vehicles.length,
      motos,
      autos,
      totalMiles,
      overdueCount,
      checkpointCount: vehicles.reduce((n, v) => n + (v.check_points?.length || 0), 0)
    }
  }, [vehicles])

  // Ensure landing view leaves the global dock clean and unclipped
  useEffect(() => {
    if (!selectedVehicleId && setAction) {
      setAction(null)
    }
    return () => {
      if (setAction) setAction(null)
    }
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
      <div className="rs-hangar-page rs-mode-hangar animate-page-in">
        <div className="rs-foyer-head rs-flex rs-items-center rs-gap-3 rs-mb-5">
          <button className="rs-pill" onClick={() => setSelectedVehicleId(null)}>
            <span className="material-symbols-rounded">arrow_back</span>
            <span>HANGAR</span>
          </button>
          <span className="rs-header-sep" style={{ opacity: 0.3 }}>/</span>
          <h1 className="rs-greeting rs-m-0">Register New Asset</h1>
        </div>

        <div className="rs-card is-wide is-elev" style={{ borderTop: '2px solid var(--primary)' }}>
          <div className="rs-card-inner">
            <div className="rs-card-head rs-mb-5">
              <span className="rs-card-label rs-c-accent">ASSET SPECIFICATIONS &amp; HARDWARE TELEMETRY</span>
            </div>

            {newError && (
              <div className="mp-error rs-mb-4" style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', borderRadius: 'var(--md-shape-sm)', background: 'color-mix(in srgb, var(--rs-status-critical) 10%, transparent)', color: 'var(--rs-status-critical, #ff8b8b)', border: '1px solid color-mix(in srgb, var(--rs-status-critical) 30%, transparent)' }}>
                {newError}
              </div>
            )}

            <form onSubmit={handleCreateVehicle}>
              <div className="rs-gap-4 rs-mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
                    className="cockpit-input-raw rs-pointer"
                    style={{ background: 'transparent' }}
                    value={newVehicle.vehicle_type}
                    onChange={e => setNewVehicle({ ...newVehicle, vehicle_type: e.target.value })}
                  >
                    <option value="moto" className="rs-c-fg" style={{ background: 'var(--bg-base)' }}>Motorcycle</option>
                    <option value="auto" className="rs-c-fg" style={{ background: 'var(--bg-base)' }}>Automobile</option>
                    <option value="truck" className="rs-c-fg" style={{ background: 'var(--bg-base)' }}>Truck</option>
                    <option value="atv" className="rs-c-fg" style={{ background: 'var(--bg-base)' }}>ATV / UTV</option>
                    <option value="other" className="rs-c-fg" style={{ background: 'var(--bg-base)' }}>Other</option>
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

              <div className="rs-flex rs-gap-3 rs-justify-end" style={{ paddingTop: 'var(--rs-space-4)', borderTop: '1px solid var(--rs-hairline)' }}>
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
    <div className="rs-hangar-page rs-mode-hangar animate-fade-in">
      {/* Hangar Header with Primary Actions */}
      <div className="rs-foyer-head hangar-header">
        <div>
          <div className="rs-card-label rs-mb-2 rs-c-accent" style={{ letterSpacing: '0.2em', opacity: 0.9 }}>
            SECTOR GARAGE · FLEET TELEMETRY
          </div>
          <h1 className="rs-greeting">The Hangar</h1>
          <div className="rs-greeting-sub">Sector fleet management and maintenance telemetry.</div>
        </div>
        <div className="hangar-header-actions">
          <button className="rs-pill" onClick={() => setShowAskRiverAll(true)} title="Ask River about fleet readiness">
            <span className="material-symbols-rounded">psychology</span>
            <span>ASK RIVER</span>
          </button>
          <button className="rs-btn-primary" onClick={() => setSelectedVehicleId('NEW')} title="Register new asset">
            <span className="material-symbols-rounded">add</span>
            <span>REGISTER VEHICLE</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mp-error rs-flex rs-items-center rs-justify-between rs-gap-3 rs-flex-wrap rs-mb-4" role="alert">
          <span>Could not load the fleet: {error}</span>
          <button className="rs-pill" onClick={fetchVehicles}>RETRY</button>
        </div>
      )}

      {/* Fleet Summary Stat Strip — Balanced Responsive Grid */}
      <div className="cockpit-stats-grid">
        <div className="cockpit-stat-tile">
          <div className="cockpit-stat-tile-head">
            <span className="card-metric-label">ACTIVE UNITS</span>
            <span className="material-symbols-rounded cockpit-stat-icon">garage</span>
          </div>
          <div className="stat-num">{fleetStats.activeCount} <span className="stat-unit">ASSETS</span></div>
          <div className="stat-sub">{fleetStats.motos} Motos · {fleetStats.autos} Autos</div>
        </div>

        <div className="cockpit-stat-tile">
          <div className="cockpit-stat-tile-head">
            <span className="card-metric-label">FLEET HEALTH</span>
            <span
              className="material-symbols-rounded cockpit-stat-icon"
              style={{ color: fleetStats.overdueCount > 0 ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }}
            >
              {fleetStats.overdueCount > 0 ? 'warning' : 'verified'}
            </span>
          </div>
          <div className="stat-num" style={{ color: fleetStats.overdueCount > 0 ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }}>
            {fleetStats.activeCount === 0 ? 'NO FLEET' : fleetStats.overdueCount > 0 ? `${fleetStats.overdueCount} SERVICE DUE` : 'ALL NOMINAL'}
          </div>
          <div className="stat-sub">
            {fleetStats.activeCount === 0
              ? 'Register a vehicle to begin tracking'
              : fleetStats.overdueCount > 0 ? 'Milestone inspection pending' : 'All systems operating nominally'}
          </div>
        </div>

        <div className="cockpit-stat-tile">
          <div className="cockpit-stat-tile-head">
            <span className="card-metric-label">CUMULATIVE MILEAGE</span>
            <span className="material-symbols-rounded cockpit-stat-icon">speed</span>
          </div>
          <div className="stat-num">{fleetStats.totalMiles.toLocaleString()} <span className="stat-unit">MI</span></div>
          <div className="stat-sub">Combined sector travel</div>
        </div>

        <div className="cockpit-stat-tile">
          <div className="cockpit-stat-tile-head">
            <span className="card-metric-label">TRACKED CHECKPOINTS</span>
            <span className="material-symbols-rounded cockpit-stat-icon">menu_book</span>
          </div>
          <div className="stat-num">{fleetStats.checkpointCount} <span className="stat-unit">ITEMS</span></div>
          <div className="stat-sub">Service items configured across the fleet</div>
        </div>
      </div>

      {/* Sector Vehicles Grid */}
      <div className="rs-flex rs-justify-between rs-items-center rs-mt-3 rs-mb-2">
        <span className="card-metric-label rs-type-micro" style={{ letterSpacing: '0.12em' }}>
          SECTOR VEHICLES ({vehicles.length})
        </span>
      </div>

      {loading && vehicles.length === 0 ? (
        <div className="rs-card is-wide rs-text-center" style={{ padding: 64 }}>
          <span className="material-symbols-rounded rs-c-accent" style={{ fontSize: '3rem', opacity: 0.6, animation: 'spin 2s linear infinite' }}>sync</span>
          <div className="card-metric-label rs-mt-4">SCANNING HANGAR TRANSPONDERS...</div>
        </div>
      ) : (
        <div className="hangar-fleet-cards-grid">
          {vehicles.map(v => {
            const odo = v.current_odometer ?? (v.usage_readings?.[0]?.value || 0)
            const checkPoints = v.check_points || []
            const isDue = isServiceDue(odo, checkPoints)
            const unit = odometerUnit(v.vehicle_type)
            const nextMilestone = nextMilestoneLabel(odo, checkPoints, unit)

            return (
              <div
                key={v.id}
                className="hangar-vehicle-card"
                role="button"
                tabIndex={0}
                onClick={() => setSelectedVehicleId(v.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedVehicleId(v.id)
                  }
                }}
                aria-label={`Open ${v.nickname || `${v.make} ${v.model}`} telemetry cockpit`}
                title={`Open ${v.nickname || v.model} Telemetry Cockpit`}
              >
                <div className="hangar-card-header">
                  <div className="hangar-card-left">
                    <div className="vehicle-icon-badge">
                      <span className="material-symbols-rounded">{getTypeIcon(v.vehicle_type)}</span>
                    </div>
                    <div className="vehicle-card-titles">
                      <div className="vehicle-card-name">{v.nickname || `${v.make} ${v.model}`}</div>
                      <div className="vehicle-card-sub">{v.year || ''} {v.make} {v.model} {v.trim || ''}</div>
                    </div>
                  </div>
                  <div
                    className="hangar-status-badge"
                    style={isDue ? {
                      color: 'var(--rs-status-critical, #ff8b8b)',
                      borderColor: 'color-mix(in srgb, var(--rs-status-critical) 30%, transparent)',
                      background: 'color-mix(in srgb, var(--rs-status-critical) 10%, transparent)'
                    } : {
                      color: 'var(--rs-status-nominal, #4ade80)',
                      borderColor: 'color-mix(in srgb, var(--rs-status-nominal) 30%, transparent)',
                      background: 'color-mix(in srgb, var(--rs-status-nominal) 10%, transparent)'
                    }}
                  >
                    <span
                      className="rs-status-dot"
                      style={{ background: isDue ? 'var(--rs-status-critical, #ff8b8b)' : 'var(--rs-status-nominal, #4ade80)' }}
                    />
                    <span>{isDue ? 'SERVICE DUE' : 'NOMINAL'}</span>
                  </div>
                </div>

                <div className="hangar-card-metrics">
                  <div className="card-metric-col">
                    <span className="card-metric-label">CURRENT ODOMETER</span>
                    <div className="card-metric-val">
                      {odo > 0 ? (
                        <>{odo.toLocaleString()} <span className="card-metric-unit">{unit}</span></>
                      ) : (
                        <span className="rs-muted rs-type-small">Not set</span>
                      )}
                    </div>
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
                    <span className="material-symbols-rounded rs-c-accent" style={{ fontSize: '1rem' }}>tune</span>
                    <span>{checkPoints.length} Checkpoints Configured</span>
                  </span>
                  <span className="hangar-card-inspect-btn">
                    <span>INSPECT</span>
                    <span className="material-symbols-rounded">arrow_forward</span>
                  </span>
                </div>
              </div>
            )
          })}

          {/* Register New Asset Card */}
          <div
            className="hangar-vehicle-card add-vehicle-card"
            role="button"
            tabIndex={0}
            onClick={() => setSelectedVehicleId('NEW')}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelectedVehicleId('NEW')
              }
            }}
            aria-label="Register a new asset"
            title="Register another vehicle to your hangar"
          >
            <div className="add-vehicle-icon-ring">
              <span className="material-symbols-rounded">add</span>
            </div>
            <div className="add-vehicle-title">REGISTER NEW ASSET</div>
            <div className="add-vehicle-desc">
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
                text: 'River, provide an overview of our entire fleet maintenance readiness and pending service.'
              }}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
