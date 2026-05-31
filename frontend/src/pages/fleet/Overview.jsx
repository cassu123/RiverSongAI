import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { Link } from 'react-router-dom'

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

  useEffect(() => {
    fetchUnits()
    const id = setInterval(fetchUnits, 5000)
    return () => clearInterval(id)
  }, [fetchUnits])

  return (
    <div>
      <h2>Overview</h2>
      <div style={{ display: 'grid', gap: 20 }}>
        {units.map(u => (
           <div key={u.unit_id} className="rs-card">
             <h3><Link to={`/fleet/units/${u.unit_id}`}>{u.name || u.unit_id}</Link></h3>
             <p>Platform: {u.platform} | Status: {u.online ? 'Online' : 'Offline'}</p>
           </div>
        ))}
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
