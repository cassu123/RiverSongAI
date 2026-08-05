// Vexa (autonomous vehicles) — bespoke driving dashboard.
import React from 'react'
import ProgramShell from '../shared/ProgramShell.jsx'
import { MetricStat, BatteryBar, Sparkline, MiniMap, CommandConsole, AlertsList } from '../shared/FleetUI.jsx'

const COMMANDS = [
  { command: 'unlock', label: 'Unlock', icon: 'lock_open' },
  { command: 'lock', label: 'Lock', icon: 'lock' },
  { command: 'summon', label: 'Summon', icon: 'navigation', params: { speed: 35 } },
  { command: 'return', label: 'Return', icon: 'u_turn_left', params: { speed: 35 } },
  { command: 'stop', label: 'Stop', icon: 'do_not_disturb_on', danger: true },
]

function Panel({ title, children }) {
  return (
    <div className="rs-card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="rs-card-label" style={{ marginBottom: 12 }}>{title}</div>{children}
    </div>
  )
}

function Dashboard({ unit, sendCmd, telemetry, latest, alerts, refresh, program }) {
  const t = latest || {}
  const mapItems = Number.isFinite(t.lat) ? [{ id: unit.unit_id, label: unit.name, lat: t.lat, lng: t.lng, online: true }] : []
  return (
    <div>
      <Panel title={`${unit.name || unit.unit_id} · ${(t.mode || 'parked').toUpperCase()}`}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-start' }}>
          <MetricStat label="SPEED" value={t.speed_kph ?? 0} unit="km/h" accent="#a78bfa" />
          <MetricStat label="GEAR" value={t.gear || 'P'} />
          <MetricStat label="ODOMETER" value={Math.round(t.odometer_km ?? 0)} unit="km" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="rs-card-label" style={{ fontSize: '0.58rem' }}>DOORS</div>
            <span className="rs-pill" style={{ fontSize: '0.7rem', padding: '3px 10px',
              color: t.locked ? 'var(--rs-status-nominal,#36d399)' : 'var(--rs-status-warning,#f4b740)',
              borderColor: t.locked ? 'var(--rs-status-nominal,#36d399)' : 'var(--rs-status-warning,#f4b740)' }}>
              {t.locked ? 'LOCKED' : 'UNLOCKED'}
            </span>
          </div>
        </div>
        <BatteryBar pct={t.battery_pct} />
        <div style={{ marginTop: 14 }}>
          <div className="rs-card-label" style={{ fontSize: '0.58rem', marginBottom: 4 }}>SPEED (km/h)</div>
          <Sparkline data={telemetry} field="speed_kph" color="#a78bfa" />
        </div>
      </Panel>

      <Panel title="LOCATION"><MiniMap items={mapItems} /></Panel>
      <Panel title="VEHICLE CONTROL"><CommandConsole spec={COMMANDS} onSend={sendCmd} /></Panel>
      <Panel title="ALERTS"><AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} /></Panel>
    </div>
  )
}

export default function VexaFleet() {
  return (
    <ProgramShell program="vexa" title="Vexa" subtitle="Autonomous vehicle fleet"
      icon="directions_car" accent="#a78bfa" renderDashboard={(p) => <Dashboard {...p} />} />
  )
}
