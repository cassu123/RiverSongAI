// =============================================================================
// pages/fleet/shared/ProgramShell.jsx
//
// Common chrome for a generic fleet program: header, Simulate/Claim toolbar,
// selectable unit list, and a delete control. The bespoke per-program
// dashboard is supplied via renderDashboard() and gets live detail data.
// =============================================================================

import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUnits, useUnitDetail, deleteUnit, sendCommand } from './useFleet.js'
import { UnitStatusPill, BatteryBar, SimulateButton, ClaimUnitModal } from './FleetUI.jsx'

function DetailHost({ program, unit, renderDashboard }) {
  const detail = useUnitDetail(program, unit.unit_id)
  const sendCmd = (command, params) =>
    sendCommand(program, unit.unit_id, command, params).then(detail.refresh).catch(() => {})
  // detail.unit is null until the first fetch lands — keep the list unit as a fallback.
  return renderDashboard({ program, sendCmd, ...detail, unit: detail.unit || unit })
}

export default function ProgramShell({ program, title, subtitle, icon, accent, renderDashboard }) {
  const { units, loading, refresh } = useUnits(program)
  const [selectedId, setSelectedId] = useState(null)
  const [showClaim, setShowClaim] = useState(false)

  const selected = useMemo(() => {
    if (!units.length) return null
    return units.find(u => u.unit_id === selectedId) || units[0]
  }, [units, selectedId])

  const onlineCount = units.filter(u => u.online).length

  const remove = async (u) => {
    const simulated = u.metadata?.simulated || String(u.unit_id).startsWith('sim-')
    await deleteUnit(program, u.unit_id, simulated)
    refresh()
  }

  return (
    <div className="rs-foyer animate-fade-in" style={{ maxWidth: '100%' }}>
      <header className="rs-foyer-head" style={{ marginBottom: 16 }}>
        <Link to="/fleet" className="rs-card-label" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>arrow_back</span> ECOSYSTEM
        </Link>
        <h1 className="rs-greeting" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.8rem', color: accent }}>{icon}</span>
          {title}
        </h1>
        <div className="rs-greeting-sub">{subtitle}</div>
        <div className="rs-status-strip" style={{ marginTop: 6 }}>
          <span className="rs-status-dot" style={{ background: onlineCount ? 'var(--rs-status-nominal,#36d399)' : 'var(--md-error)' }} />
          <span>{onlineCount} / {units.length} ONLINE</span>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <SimulateButton program={program} onDone={refresh} />
        <button className="rs-btn-ghost" style={{ fontSize: '0.78rem', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={() => setShowClaim(true)}>
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>add_link</span>
          Claim real unit
        </button>
      </div>

      {loading && !units.length ? (
        <div className="rs-card-meta">Loading units…</div>
      ) : !units.length ? (
        <div className="rs-card" style={{ padding: 40, textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.4rem', color: accent, opacity: 0.8 }}>{icon}</span>
          <h3 style={{ margin: '12px 0 6px' }}>No {title} units yet</h3>
          <p className="rs-card-meta" style={{ marginBottom: 16 }}>Add a simulated unit to watch it come online and stream live telemetry.</p>
          <SimulateButton program={program} onDone={refresh} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 20, alignItems: 'start' }}>
          {/* Unit list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {units.map(u => (
              <div key={u.unit_id}
                onClick={() => setSelectedId(u.unit_id)}
                className={`rs-card is-tappable ${selected?.unit_id === u.unit_id ? 'is-elev' : ''}`}
                style={{ padding: 12, cursor: 'pointer', borderColor: selected?.unit_id === u.unit_id ? accent : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name || u.unit_id}
                  </span>
                  <UnitStatusPill unit={u} />
                </div>
                {(u.metadata?.simulated || String(u.unit_id).startsWith('sim-')) && (
                  <span className="rs-pill" style={{ fontSize: '0.55rem', padding: '1px 6px', marginTop: 6, display: 'inline-block' }}>SIM</span>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="rs-btn-ghost" style={{ fontSize: '0.62rem', padding: '3px 8px', color: 'var(--md-error)', borderColor: 'var(--md-error)' }}
                    onClick={(e) => { e.stopPropagation(); remove(u) }}>Remove</button>
                </div>
              </div>
            ))}
          </div>

          {/* Bespoke dashboard for the selected unit */}
          <div>
            {selected && (
              <DetailHost key={selected.unit_id} program={program} unit={selected} renderDashboard={renderDashboard} />
            )}
          </div>
        </div>
      )}

      {showClaim && (
        <ClaimUnitModal program={program} onClose={() => setShowClaim(false)} onDone={refresh} />
      )}
    </div>
  )
}
