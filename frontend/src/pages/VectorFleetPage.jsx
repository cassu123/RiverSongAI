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
      <header className="rs-foyer-head" style={{ padding: '24px 24px 0 24px' }}>
        <div className="rs-card-label">COMMAND / ENVIRONMENT</div>
        <h1 className="rs-greeting">Environment</h1>
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{ background: 'var(--secondary)' }} />
          <span>FLEET ACTIVE</span>
        </div>
      </header>

      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 24, paddingBottom: 8 }}>
          <Link to="/environment" style={{ fontWeight: 400, color: 'var(--text-secondary)', textDecoration: 'none' }}>Property / Home</Link>
          <Link to="/fleet" style={{ fontWeight: 400, color: 'var(--text-secondary)', textDecoration: 'none' }}>Ecosystem</Link>
          <Link to="/fleet/vector" style={{ fontWeight: 600, color: 'var(--accent-primary)', textDecoration: 'none', borderBottom: '2px solid var(--accent-primary)', paddingBottom: 8, marginBottom: -9 }}>Vector</Link>
        </div>

        <div style={{ marginBottom: 24, display: 'flex', gap: 16, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
          <Link to="/fleet/vector" style={{ fontWeight: loc.pathname === '/fleet/vector' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Overview</Link>
          <Link to="/fleet/vector/zones" style={{ fontWeight: loc.pathname === '/fleet/vector/zones' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Zones</Link>
          <Link to="/fleet/vector/programs" style={{ fontWeight: loc.pathname === '/fleet/vector/programs' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Programs</Link>
          <Link to="/fleet/vector/schedules" style={{ fontWeight: loc.pathname === '/fleet/vector/schedules' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Schedules</Link>
          <Link to="/fleet/vector/sessions" style={{ fontWeight: loc.pathname === '/fleet/vector/sessions' ? 700 : 400, color: 'var(--text-primary)', textDecoration: 'none' }}>Sessions</Link>
        </div>



      <Routes>
        <Route path="/fleet/vector" element={<Overview setAction={setAction} />} />
        <Route path="/fleet/vector/units/:id" element={<UnitDetail setAction={setAction} />} />
        <Route path="/fleet/vector/units/:id/setup" element={<SetupWizard />} />
        <Route path="/fleet/vector/zones" element={<Zones />} />
        <Route path="/fleet/vector/programs" element={<Programs />} />
        <Route path="/fleet/vector/schedules" element={<Schedules />} />
        <Route path="/fleet/vector/sessions" element={<Sessions />} />
        <Route path="*" element={<Navigate to="/fleet/vector" replace />} />
      </Routes>
      </div>
    </div>
  )
}
