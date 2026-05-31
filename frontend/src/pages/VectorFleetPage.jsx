import React from 'react'
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom'
import Overview from './fleet/Overview.jsx'
import UnitDetail from './fleet/UnitDetail.jsx'
import SetupWizard from './fleet/SetupWizard.jsx'
import Zones from './fleet/Zones.jsx'
import Programs from './fleet/Programs.jsx'
import Schedules from './fleet/Schedules.jsx'
import Sessions from './fleet/Sessions.jsx'

export default function VectorFleetPage({ setAction }) {
  const loc = useLocation()

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 24, display: 'flex', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 16 }}>
        <Link to="/fleet" style={{ fontWeight: loc.pathname === '/fleet' ? 700 : 400, color: 'var(--on-surface)' }}>Overview</Link>
        <Link to="/fleet/zones" style={{ fontWeight: loc.pathname === '/fleet/zones' ? 700 : 400, color: 'var(--on-surface)' }}>Zones</Link>
        <Link to="/fleet/programs" style={{ fontWeight: loc.pathname === '/fleet/programs' ? 700 : 400, color: 'var(--on-surface)' }}>Programs</Link>
        <Link to="/fleet/schedules" style={{ fontWeight: loc.pathname === '/fleet/schedules' ? 700 : 400, color: 'var(--on-surface)' }}>Schedules</Link>
        <Link to="/fleet/sessions" style={{ fontWeight: loc.pathname === '/fleet/sessions' ? 700 : 400, color: 'var(--on-surface)' }}>Sessions</Link>
      </div>

      <Routes>
        <Route path="/fleet" element={<Overview setAction={setAction} />} />
        <Route path="/fleet/units/:id" element={<UnitDetail setAction={setAction} />} />
        <Route path="/fleet/units/:id/setup" element={<SetupWizard />} />
        <Route path="/fleet/zones" element={<Zones />} />
        <Route path="/fleet/programs" element={<Programs />} />
        <Route path="/fleet/schedules" element={<Schedules />} />
        <Route path="/fleet/sessions" element={<Sessions />} />
        <Route path="*" element={<Navigate to="/fleet" replace />} />
      </Routes>
    </div>
  )
}
