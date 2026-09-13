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
    <div className="rs-foyer animate-fade-in" style={{ padding: '0', maxWidth: '100%' }}>
      <header className="rs-foyer-head" style={{ padding: 'var(--rs-space-5) var(--rs-space-5) 0 var(--rs-space-5)' }}>
        <div className="rs-card-label">COMMAND / ENVIRONMENT</div>
        <h1 className="rs-greeting">Environment</h1>
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{ background: 'var(--secondary)' }} />
          <span>FLEET ACTIVE</span>
        </div>
      </header>

      <div style={{ padding: '0 var(--rs-space-5)' }}>
        <div className="rs-flex rs-gap-5 rs-mb-5" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--rs-space-2)' }}>
          <Link to="/environment" className="rs-fw-400" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Property / Home</Link>
          <Link to="/fleet" className="rs-fw-400" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Ecosystem</Link>
          <Link to="/fleet/vector" className="rs-fw-600" style={{ color: 'var(--accent-primary)', textDecoration: 'none', borderBottom: '2px solid var(--accent-primary)', paddingBottom: 'var(--rs-space-2)', marginBottom: -9 }}>Vector</Link>
        </div>

        <div className="rs-mb-5 rs-flex rs-gap-4" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 'var(--rs-space-4)' }}>
          <Link to="/fleet/vector" style={{ fontWeight: loc.pathname === '/fleet/vector' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Overview</Link>
          <Link to="/fleet/vector/zones" style={{ fontWeight: loc.pathname === '/fleet/vector/zones' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Zones</Link>
          <Link to="/fleet/vector/programs" style={{ fontWeight: loc.pathname === '/fleet/vector/programs' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Programs</Link>
          <Link to="/fleet/vector/schedules" style={{ fontWeight: loc.pathname === '/fleet/vector/schedules' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Schedules</Link>
          <Link to="/fleet/vector/sessions" style={{ fontWeight: loc.pathname === '/fleet/vector/sessions' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Sessions</Link>
        </div>



      <Routes>
        <Route index element={<Overview setAction={setAction} />} />
        <Route path="units/:id" element={<UnitDetail setAction={setAction} />} />
        <Route path="units/:id/setup" element={<SetupWizard />} />
        <Route path="zones" element={<Zones />} />
        <Route path="programs" element={<Programs />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="*" element={<Navigate to="/fleet/vector" replace />} />
      </Routes>
      </div>
    </div>
  )
}
