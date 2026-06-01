import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix default icon issue with Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function MapSelector({ position, onChange }) {
  const MapEvents = () => {
    useMapEvents({
      click(e) {
        onChange(e.latlng.lat, e.latlng.lng)
      }
    })
    return null
  }

  const defaultCenter = [40.7128, -74.0060] // Default NYC
  const center = position.lat && position.lng ? [position.lat, position.lng] : defaultCenter

  return (
    <div className="rs-map" style={{ marginBottom: 16 }}>
      <MapContainer center={center} zoom={18} style={{ height: '100%', width: '100%', borderRadius: 8 }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
          maxZoom={22}
          maxNativeZoom={19}
        />
        <MapEvents />
        {position.lat && position.lng && <Marker position={[position.lat, position.lng]} />}
      </MapContainer>
    </div>
  )
}

export default function SetupWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token } = useAuth()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [formData, setFormData] = useState({
    name: '',
    platform: 'robot',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hardware: {
      drive: { type: 'differential', gears: 1, max_speed_kmh: 5.0, turn_radius_m: 0, speed_control: 'pwm' },
      deck: { width_inches: 22, engagement: 'electric', height_adjustable: false },
      cameras: { count: 0, config: [] },
      sensors: {
        gps: 'none',
        imu: false,
        obstacle: 'none',
        fuel: false,
        temperature: false,
        rpm: false,
        operator_presence: false
      },
      pico_bridge: { port: '/dev/ttyACM0', baud_rate: 115200 },
      power: { type: 'electric', nominal_voltage_v: 24, battery_cells: 6, min_voltage_v: 20, min_battery_v: null },
      rtk: { ntrip_host: '', port: 2101, mountpoint: '', user: '', password: '' }
    },
    safety_floors: {
      min_obstacle_clearance_m: 0.20,
      imu_tilt_cutoff_deg: 15,
      watchdog_timeout_ms: 500,
      min_battery_v_cutoff: 20,
      operator_presence_required_for_auto: false
    },
    home_position: {
      lat: null,
      lng: null,
      heading_deg: 0
    }
  })

  useEffect(() => {
    fetch(`/api/vector/units/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(r => {
      if (r.ok) return r.json()
      throw new Error("Unit not found")
    })
    .then(unit => {
      setFormData(prev => ({
        ...prev,
        name: unit.name || prev.name,
        platform: unit.platform || prev.platform,
        timezone: unit.timezone || prev.timezone,
        hardware: unit.hardware ? (typeof unit.hardware === 'string' ? JSON.parse(unit.hardware) : unit.hardware) : prev.hardware,
        safety_floors: unit.safety_floors ? (typeof unit.safety_floors === 'string' ? JSON.parse(unit.safety_floors) : unit.safety_floors) : prev.safety_floors,
        home_position: unit.home_position ? (typeof unit.home_position === 'string' ? JSON.parse(unit.home_position) : unit.home_position) : prev.home_position
      }))
      setLoading(false)
    })
    .catch(e => {
      console.error(e)
      setLoading(false)
    })
  }, [id, token])

  const updateField = (path, value) => {
    setFormData(prev => {
      const copy = { ...prev }
      let current = copy
      const parts = path.split('.')
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {}
        current[parts[i]] = { ...current[parts[i]] }
        current = current[parts[i]]
      }
      current[parts[parts.length - 1]] = value
      return copy
    })
  }

  const handleNext = (e) => {
    if (e) e.preventDefault()
    setStep(s => Math.min(s + 1, 8))
  }

  const handleBack = () => {
    setStep(s => Math.max(s - 1, 1))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/vector/units/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })
      if (!res.ok) throw new Error(await res.text())
      navigate(`/fleet/units/${id}`)
    } catch(err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading unit data...</div>

  return (
    <div className="rs-card p-5 md:p-8" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 8 }}>Setup Wizard: {id}</h2>
      <div style={{ marginBottom: 24, fontSize: '0.9rem', opacity: 0.7 }}>Step {step} of 8</div>

      <form onSubmit={step === 8 ? (e)=>{e.preventDefault();handleSave()} : handleNext}>
        {step === 1 && (
          <div>
            <h3>Identity</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Name</label>
              <input type="text" className="rs-input" required value={formData.name} onChange={e => updateField('name', e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Platform</label>
              <select className="rs-input" value={formData.platform} onChange={e => updateField('platform', e.target.value)}>
                <option value="robot">Robot Mower</option>
                <option value="riding">Riding Mower</option>
                <option value="push">Push Mower</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Timezone</label>
              <input type="text" className="rs-input" required value={formData.timezone} onChange={e => updateField('timezone', e.target.value)} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3>Drive System</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Type</label>
              <select className="rs-input" value={formData.hardware.drive.type} onChange={e => updateField('hardware.drive.type', e.target.value)}>
                <option value="clutch">Clutch</option>
                <option value="differential">Differential</option>
                <option value="direct_electric">Direct Electric</option>
                <option value="hydrostatic">Hydrostatic</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Gears</label>
              <input type="number" className="rs-input" value={formData.hardware.drive.gears} onChange={e => updateField('hardware.drive.gears', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Max Speed (km/h)</label>
              <input type="number" step="0.1" className="rs-input" value={formData.hardware.drive.max_speed_kmh} onChange={e => updateField('hardware.drive.max_speed_kmh', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Turn Radius (m)</label>
              <input type="number" step="0.1" className="rs-input" value={formData.hardware.drive.turn_radius_m} onChange={e => updateField('hardware.drive.turn_radius_m', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Speed Control</label>
              <input type="text" className="rs-input" value={formData.hardware.drive.speed_control} onChange={e => updateField('hardware.drive.speed_control', e.target.value)} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3>Deck</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Width (inches)</label>
              <input type="number" className="rs-input" value={formData.hardware.deck.width_inches} onChange={e => updateField('hardware.deck.width_inches', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Engagement</label>
              <select className="rs-input" value={formData.hardware.deck.engagement} onChange={e => updateField('hardware.deck.engagement', e.target.value)}>
                <option value="electric">Electric PTO</option>
                <option value="manual">Manual</option>
                <option value="always_on">Always On</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Height Adjustable</label>
              <input type="checkbox" checked={formData.hardware.deck.height_adjustable} onChange={e => updateField('hardware.deck.height_adjustable', e.target.checked)} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h3>Hardware & Sensors</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Cameras Count</label>
              <input type="number" className="rs-input" value={formData.hardware.cameras.count} onChange={e => updateField('hardware.cameras.count', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">GPS Type</label>
              <select className="rs-input" value={formData.hardware.sensors.gps} onChange={e => updateField('hardware.sensors.gps', e.target.value)}>
                <option value="none">None</option>
                <option value="standard">Standard GPS</option>
                <option value="rtk">RTK GPS</option>
              </select>
            </div>
            
            {formData.hardware.sensors.gps === 'rtk' && (
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <h4>RTK NTRIP Config</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label>Host</label><input type="text" className="rs-input" value={formData.hardware.rtk.ntrip_host} onChange={e => updateField('hardware.rtk.ntrip_host', e.target.value)} /></div>
                  <div><label>Port</label><input type="number" className="rs-input" value={formData.hardware.rtk.port} onChange={e => updateField('hardware.rtk.port', Number(e.target.value))} /></div>
                  <div><label>Mountpoint</label><input type="text" className="rs-input" value={formData.hardware.rtk.mountpoint} onChange={e => updateField('hardware.rtk.mountpoint', e.target.value)} /></div>
                  <div><label>User</label><input type="text" className="rs-input" value={formData.hardware.rtk.user} onChange={e => updateField('hardware.rtk.user', e.target.value)} /></div>
                  <div><label>Password</label><input type="password" className="rs-input" value={formData.hardware.rtk.password} onChange={e => updateField('hardware.rtk.password', e.target.value)} /></div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginBottom: 16 }}>
              <div><label><input type="checkbox" checked={formData.hardware.sensors.imu} onChange={e => updateField('hardware.sensors.imu', e.target.checked)} /> IMU Installed</label></div>
              <div>
                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 4 }}>Obstacle Sensors</label>
                <select className="rs-input" value={formData.hardware.sensors.obstacle} onChange={e => updateField('hardware.sensors.obstacle', e.target.value)}>
                  <option value="none">None</option>
                  <option value="ultrasonic">Ultrasonic</option>
                  <option value="lidar">Lidar</option>
                  <option value="camera_based">Camera Based</option>
                </select>
              </div>
              <div><label><input type="checkbox" checked={formData.hardware.sensors.fuel} onChange={e => updateField('hardware.sensors.fuel', e.target.checked)} /> Fuel Sensor</label></div>
              <div><label><input type="checkbox" checked={formData.hardware.sensors.temperature} onChange={e => updateField('hardware.sensors.temperature', e.target.checked)} /> Temperature Sensor</label></div>
              <div><label><input type="checkbox" checked={formData.hardware.sensors.rpm} onChange={e => updateField('hardware.sensors.rpm', e.target.checked)} /> RPM Sensor</label></div>
              <div><label><input type="checkbox" checked={formData.hardware.sensors.operator_presence} onChange={e => updateField('hardware.sensors.operator_presence', e.target.checked)} /> Operator Presence</label></div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Pico Bridge</label>
              <div style={{ display: 'flex', gap: 16 }}>
                <input type="text" className="rs-input" placeholder="Port" value={formData.hardware.pico_bridge.port} onChange={e => updateField('hardware.pico_bridge.port', e.target.value)} />
                <input type="number" className="rs-input" placeholder="Baud Rate" value={formData.hardware.pico_bridge.baud_rate} onChange={e => updateField('hardware.pico_bridge.baud_rate', Number(e.target.value))} />
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div>
            <h3>Power</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Type</label>
              <select className="rs-input" value={formData.hardware.power.type} onChange={e => updateField('hardware.power.type', e.target.value)}>
                <option value="electric">Electric (Battery)</option>
                <option value="gas">Gas (Internal Combustion)</option>
              </select>
            </div>
            
            {formData.hardware.power.type === 'electric' ? (
              <>
                <div style={{ marginBottom: 16 }}><label className="rs-card-label">Nominal Voltage (V)</label><input type="number" className="rs-input" value={formData.hardware.power.nominal_voltage_v} onChange={e => updateField('hardware.power.nominal_voltage_v', Number(e.target.value))} /></div>
                <div style={{ marginBottom: 16 }}><label className="rs-card-label">Battery Cells</label><input type="number" className="rs-input" value={formData.hardware.power.battery_cells} onChange={e => updateField('hardware.power.battery_cells', Number(e.target.value))} /></div>
                <div style={{ marginBottom: 16 }}><label className="rs-card-label">Min Voltage (V)</label><input type="number" className="rs-input" value={formData.hardware.power.min_voltage_v} onChange={e => updateField('hardware.power.min_voltage_v', Number(e.target.value))} /></div>
              </>
            ) : (
              <div style={{ marginBottom: 16 }}><label className="rs-card-label">Min Battery Voltage (V)</label><input type="number" className="rs-input" value={formData.hardware.power.min_battery_v || ''} onChange={e => updateField('hardware.power.min_battery_v', Number(e.target.value))} /></div>
            )}
          </div>
        )}

        {step === 6 && (
          <div>
            <h3>Safety Floors</h3>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Min Obstacle Clearance (m)</label>
              <input type="number" step="0.01" className="rs-input" value={formData.safety_floors.min_obstacle_clearance_m} onChange={e => updateField('safety_floors.min_obstacle_clearance_m', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">IMU Tilt Cutoff (deg)</label>
              <input type="number" step="1" className="rs-input" value={formData.safety_floors.imu_tilt_cutoff_deg} onChange={e => updateField('safety_floors.imu_tilt_cutoff_deg', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Watchdog Timeout (ms)</label>
              <input type="number" step="1" className="rs-input" value={formData.safety_floors.watchdog_timeout_ms} onChange={e => updateField('safety_floors.watchdog_timeout_ms', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Min Battery V Cutoff</label>
              <input type="number" step="0.1" className="rs-input" value={formData.safety_floors.min_battery_v_cutoff} onChange={e => updateField('safety_floors.min_battery_v_cutoff', Number(e.target.value))} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">
                <input type="checkbox" checked={formData.safety_floors.operator_presence_required_for_auto} onChange={e => updateField('safety_floors.operator_presence_required_for_auto', e.target.checked)} /> 
                Operator Presence Required for Auto
              </label>
            </div>
          </div>
        )}

        {step === 7 && (
          <div>
            <h3>Home Position</h3>
            <p style={{ opacity: 0.7, marginBottom: 16 }}>Click the map to set the home coordinate for the unit.</p>
            <MapSelector 
              position={formData.home_position} 
              onChange={(lat, lng) => {
                updateField('home_position.lat', lat)
                updateField('home_position.lng', lng)
              }} 
            />
            <div style={{ marginBottom: 16 }}>
              <label className="rs-card-label">Heading (deg)</label>
              <input type="range" min="0" max="359" style={{ width: '100%' }} value={formData.home_position.heading_deg} onChange={e => updateField('home_position.heading_deg', Number(e.target.value))} />
              <div style={{ textAlign: 'center', marginTop: 8 }}>{formData.home_position.heading_deg}°</div>
            </div>
          </div>
        )}

        {step === 8 && (
          <div>
            <h3>Review & Save</h3>
            <pre style={{ background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 8, fontSize: '0.85rem', overflowX: 'auto' }}>
              {JSON.stringify(formData, null, 2)}
            </pre>
            {error && <div style={{ color: 'var(--md-error)', marginTop: 16 }}>{error}</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 32, justifyContent: 'space-between' }}>
          <button type="button" className="rs-btn" disabled={step === 1} onClick={handleBack}>
            BACK
          </button>
          
          {step < 8 ? (
            <button type="submit" className="rs-btn-primary">
              NEXT
            </button>
          ) : (
            <button type="button" className="rs-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'SAVING...' : 'SAVE CONFIGURATION'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
