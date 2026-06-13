// =============================================================================
// pages/fleet/FleetHub.jsx
//
// Ecosystem landing: a card per embodiment program with live online/total
// counts, linking into each program's bespoke console.
// =============================================================================

import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/api.js'
import { useInterval } from '../../hooks/useInterval.js'

const PROGRAMS = [
  { key: 'vector', title: 'River Vector', sub: 'Autonomous mowers', icon: 'grass', accent: '#36d399', to: '/fleet/vector', api: '/api/vector/units' },
  { key: 'vexa', title: 'River Vexa', sub: 'Autonomous vehicles', icon: 'directions_car', accent: '#a78bfa', to: '/fleet/vexa', api: '/api/vexa/units' },
  { key: 'kova', title: 'River Kova', sub: 'Household chore robots', icon: 'cleaning_services', accent: '#34d399', to: '/fleet/kova', api: '/api/kova/units' },
  { key: 'horizon', title: 'River Horizon', sub: 'Aerial drones', icon: 'paragliding', accent: '#6ea8fe', to: '/fleet/horizon', api: '/api/horizon/units' },
  { key: 'vortex', title: 'River Vortex', sub: 'Home hub network', icon: 'hub', accent: '#22d3ee', to: '/fleet/vortex', api: '/api/vortex/units' },
  { key: 'sentinel', title: 'River Sentinel', sub: 'Patrol robot dogs', icon: 'pets', accent: '#f59e0b', to: '/fleet/sentinel', api: '/api/sentinel/units' },
]

function unitsOf(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.units)) return data.units
  return []
}

export default function FleetHub() {
  const [counts, setCounts] = useState({})

  const refresh = async () => {
    const entries = await Promise.all(PROGRAMS.map(async p => {
      try {
        const data = await apiFetch(p.api, { silent: true })
        const units = unitsOf(data)
        return [p.key, { total: units.length, online: units.filter(u => u.online).length }]
      } catch {
        return [p.key, { total: 0, online: 0, err: true }]
      }
    }))
    setCounts(Object.fromEntries(entries))
  }

  React.useEffect(() => { refresh() }, [])
  useInterval(refresh, 5000)

  return (
    <div className="rs-foyer animate-fade-in" style={{ maxWidth: '100%' }}>
      <header className="rs-foyer-head">
        <div className="rs-card-label">COMMAND / ECOSYSTEM</div>
        <h1 className="rs-greeting">Embodiment Fleet</h1>
        <div className="rs-greeting-sub">River's physical programs. Open one to claim units, stream live telemetry, and issue commands.</div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginTop: 20 }}>
        {PROGRAMS.map(p => {
          const c = counts[p.key] || { total: 0, online: 0 }
          return (
            <Link key={p.key} to={p.to} className="rs-card is-tappable" style={{ padding: 20, textDecoration: 'none', display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.8rem', color: p.accent }}>{p.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{p.title}</div>
                  <div className="rs-card-meta" style={{ fontSize: '0.72rem' }}>{p.sub}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%',
                  background: c.online ? 'var(--rs-status-nominal,#36d399)' : 'var(--md-outline,#555)',
                  boxShadow: c.online ? '0 0 8px var(--rs-status-nominal,#36d399)' : 'none' }} />
                <span style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                  <strong>{c.online}</strong> online <span style={{ opacity: 0.5 }}>/ {c.total} total</span>
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
