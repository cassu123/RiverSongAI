import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix default icon issue with webpack/vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

// Create custom colored icons based on mode
const getIconForMode = (mode) => {
  let color = 'grey'
  if (mode === 'auto') color = 'green'
  else if (mode === 'manual') color = 'blue'
  else if (mode === 'estop') color = 'red'
  else if (mode === 'fault') color = 'orange' // amber

  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  })
}

const COMMANDS = [
  { key: 'mow_start',    label: 'Start Mowing',  icon: 'grass',          primary: true },
  { key: 'mow_stop',     label: 'Stop',           icon: 'stop_circle',    primary: false },
  { key: 'return_home',  label: 'Return Home',    icon: 'home',           primary: false },
  { key: 'estop',        label: 'E-STOP',         icon: 'emergency_home', danger: true },
  { key: 'estop_reset',  label: 'Reset E-Stop',   icon: 'restart_alt',    ghost: true },
]

export default function Overview({ setAction }) {
  const { token } = useAuth()
  const [units,   setUnits]   = useState([])
  const [discovered, setDiscovered] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchUnits = useCallback(async () => {
    try {
      const res = await fetch('/api/vector/units', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setUnits(await res.json())
      const disc = await fetch('/api/vector/units/discovered', { headers: { Authorization: `Bearer ${token}` } })
      if (disc.ok) setDiscovered(await disc.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [token])

  const sendCommand = async (unitId, action, payload = {}) => {
    try {
      await fetch(`/api/vector/units/${unitId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, payload })
      })
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    fetchUnits()
    
    const eventSource = new EventSource('/api/vector/units/stream')
    
    eventSource.addEventListener('update', (e) => {
      try {
        const updatedUnits = JSON.parse(e.data)
        setUnits(updatedUnits)
      } catch (err) {
        console.error("Failed to parse SSE data", err)
      }
    })

    eventSource.onerror = (e) => {
      console.error("SSE Error:", e)
    }

    return () => eventSource.close()
  }, [fetchUnits])

  return (
    <div>
      <h2>Overview</h2>
      <div className="grid grid-cols-1 rail:grid-cols-[3fr_2fr] gap-5">
        <div className="rs-map">
          <MapContainer center={[0, 0]} zoom={2} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
              maxZoom={20}
            />
            {units.filter(u => u.last_lat !== undefined && u.last_lat !== null).map(u => (
              <Marker 
                key={u.unit_id} 
                position={[u.last_lat, u.last_lng]} 
                icon={getIconForMode(u.operating_mode)}
              >
                <Popup>
                  <strong>{u.name || u.unit_id}</strong><br/>
                  Mode: {u.operating_mode || 'idle'}<br/>
                  Battery: {u.last_battery_pct}%<br/>
                  <Link to={`/fleet/vector/units/${u.unit_id}`}>View Details</Link>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '600px', overflowY: 'auto' }}>
          {units.map(u => (
              <div key={u.unit_id} className="rs-card">
                <h3><Link to={`/fleet/vector/units/${u.unit_id}`}>{u.name || u.unit_id}</Link></h3>
                <p>Platform: {u.platform} | Status: {u.online ? 'Online' : 'Offline'}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                  <span style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>{u.operating_mode || 'idle'}</span>
                  <span>🔋 {u.last_battery_pct ?? '--'}%</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <Link to={`/fleet/vector/units/${u.unit_id}`} className="rs-btn-ghost" style={{textDecoration: 'none'}}>Details</Link>
                  <Link to={`/fleet/vector/units/${u.unit_id}/setup`} className="rs-btn-ghost" style={{textDecoration: 'none'}}>Configure</Link>
                  <button className="rs-btn-primary" onClick={() => sendCommand(u.unit_id, 'mow_start')}>Start</button>
                </div>
              </div>
          ))}
        </div>
        {discovered.length > 0 && (
          <div className="rs-card">
            <h3>Discovered Unclaimed Units</h3>
            {discovered.map(d => (
              <div key={d.unit_id}>
                {d.unit_id} ({d.ip_address})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
