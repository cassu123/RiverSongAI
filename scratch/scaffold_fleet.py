import os

files = {
    "frontend/src/pages/fleet/Overview.jsx": """import React, { useState, useEffect, useCallback, useRef } from 'react'
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
""",
    "frontend/src/pages/fleet/UnitDetail.jsx": """import React from 'react'
import { useParams } from 'react-router-dom'
export default function UnitDetail() {
  const { id } = useParams()
  return <div className="rs-card"><h3>Unit Detail: {id}</h3><p>Live telemetry and SSE status goes here.</p></div>
}
""",
    "frontend/src/pages/fleet/SetupWizard.jsx": """import React from 'react'
import { useParams } from 'react-router-dom'
export default function SetupWizard() {
  const { id } = useParams()
  return <div className="rs-card"><h3>Setup Wizard: {id}</h3><p>8-step configuration wizard.</p></div>
}
""",
    "frontend/src/pages/fleet/Zones.jsx": """import React from 'react'
export default function Zones() {
  return <div className="rs-card"><h3>Zones</h3><p>Leaflet-based polygon editor will mount here.</p></div>
}
""",
    "frontend/src/pages/fleet/Programs.jsx": """import React from 'react'
export default function Programs() {
  return <div className="rs-card"><h3>Programs</h3><p>Program builder and validation.</p></div>
}
""",
    "frontend/src/pages/fleet/Schedules.jsx": """import React from 'react'
export default function Schedules() {
  return <div className="rs-card"><h3>Schedules</h3><p>Cron schedule manager.</p></div>
}
""",
    "frontend/src/pages/fleet/Sessions.jsx": """import React from 'react'
export default function Sessions() {
  return <div className="rs-card"><h3>Sessions</h3><p>History table of all mowing sessions.</p></div>
}
"""
}

for path, content in files.items():
    with open(path, "w") as f:
        f.write(content)

