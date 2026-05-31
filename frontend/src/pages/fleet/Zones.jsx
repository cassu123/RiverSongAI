import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { MapContainer, TileLayer, FeatureGroup, Polygon, Popup } from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'

export default function Zones() {
  const { token } = useAuth()
  const [zones, setZones] = useState([])
  const [units, setUnits] = useState([])
  const [teachingMode, setTeachingMode] = useState(false)
  const [selectedUnit, setSelectedUnit] = useState('')
  const [teachZoneName, setTeachZoneName] = useState('')
  const featureGroupRef = useRef(null)

  useEffect(() => {
    fetchZones()
    fetchUnits()
  }, [])

  const fetchZones = async () => {
    try {
      const res = await fetch('/api/vector/zones', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setZones(await res.json())
    } catch (err) {
      console.error("Failed to fetch zones", err)
    }
  }

  const fetchUnits = async () => {
    try {
      const res = await fetch('/api/vector/units', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setUnits(await res.json())
    } catch (err) {
      console.error("Failed to fetch units", err)
    }
  }

  const handleCreated = async (e) => {
    const layer = e.layer
    const latLngs = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng])
    
    // We remove the drawn layer because we will re-render it from state
    const fg = featureGroupRef.current
    if (fg) fg.removeLayer(layer)

    const name = prompt("Enter a name for this zone:") || "New Zone"

    try {
      const res = await fetch('/api/vector/zones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          boundary: latLngs,
          area_sqm: 0, // calculate if needed, or let backend
          capture_method: 'drawn'
        })
      })
      if (res.ok) {
        fetchZones()
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleEdited = async (e) => {
    const layers = e.layers
    layers.eachLayer(async (layer) => {
      // Find matching zone in state by some property? 
      // react-leaflet-draw editing existing state polygons is tricky if they aren't created by EditControl.
      // For simplicity, we assume EditControl manages new edits. If we render them as <Polygon>, they aren't easily editable by EditControl without attaching them.
    })
  }

  const handleDeleted = async (e) => {
    // Handling deletion of drawn layers.
  }

  const startTeach = async () => {
    if (!selectedUnit || !teachZoneName) return
    try {
      const res = await fetch(`/api/vector/units/${selectedUnit}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'teach.start', params: { zone_name: teachZoneName } })
      })
      if (res.ok) {
        setTeachingMode(true)
        alert("Teach mode started. Drive the unit to capture the boundary.")
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Zones Manager</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder="New Zone Name" 
            value={teachZoneName} 
            onChange={e => setTeachZoneName(e.target.value)} 
          />
          <select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)}>
            <option value="">Select Unit to Teach...</option>
            {units.map(u => <option key={u.unit_id} value={u.unit_id}>{u.name || u.unit_id}</option>)}
          </select>
          <button className="rs-btn-primary" onClick={startTeach}>Teach Boundary</button>
        </div>
      </div>

      <div style={{ height: '650px', marginTop: 20, borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
        <MapContainer center={[0, 0]} zoom={2} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={20}
          />
          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onCreated={handleCreated}
              onEdited={handleEdited}
              onDeleted={handleDeleted}
              draw={{
                polygon: { allowIntersection: false, showArea: true },
                polyline: false,
                rectangle: false,
                circle: false,
                marker: false,
                circlemarker: false,
              }}
            />
          </FeatureGroup>

          {zones.map(z => {
            // z.boundary might be stringified JSON from sqlite, parse if needed
            let boundary = z.boundary
            if (typeof boundary === 'string') {
              try { boundary = JSON.parse(boundary) } catch (e) { boundary = [] }
            }
            if (!Array.isArray(boundary) || boundary.length === 0) return null
            
            return (
              <Polygon key={z.zone_id || z.id} positions={boundary} color="blue">
                <Popup>
                  <strong>{z.name}</strong><br/>
                  Area: {z.area_sqm} m&sup2;<br/>
                  Capture: {z.capture_method}
                </Popup>
              </Polygon>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
