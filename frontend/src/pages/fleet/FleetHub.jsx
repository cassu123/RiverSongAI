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

      <div className="rs-fleet-grid">
        {PROGRAMS.map(p => {
          const c = counts[p.key] || { total: 0, online: 0 }
          const live = c.online > 0
          return (
            <Link
              key={p.key}
              to={p.to}
              className="rs-fleet-card"
              /* Per-program accent stays — it colour-codes the six programs —
                 but it now tints a chip instead of floating as a raw coloured
                 glyph, so six different hues read as a system. */
              style={{ '--rs-fleet-accent': p.accent }}
            >
              <span className="rs-fleet-icon" aria-hidden="true">
                <span className="material-symbols-rounded">{p.icon}</span>
              </span>

              <span className="rs-fleet-body">
                <span className="rs-fleet-title">{p.title}</span>
                <span className="rs-fleet-sub">{p.sub}</span>
              </span>

              <span className={`rs-fleet-status ${live ? 'is-live' : ''}`}>
                <span className="rs-fleet-dot" aria-hidden="true" />
                <span className="rs-fleet-count">
                  <strong>{c.online}</strong><span className="rs-fleet-total">/{c.total}</span>
                </span>
                <span className="rs-fleet-word">{c.err ? 'offline' : 'online'}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
