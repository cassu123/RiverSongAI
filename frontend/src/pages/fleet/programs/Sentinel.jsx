// Sentinel (patrol robot dogs) — bespoke patrol dashboard.
import React from 'react'
import ProgramShell from '../shared/ProgramShell.jsx'
import { MetricStat, BatteryBar, MiniMap, CommandConsole, AlertsList } from '../shared/FleetUI.jsx'

const COMMANDS = [
  { command: 'patrol', label: 'Patrol', icon: 'pets' },
  { command: 'stand', label: 'Stand', icon: 'accessibility_new' },
  { command: 'sit', label: 'Sit', icon: 'chair' },
  { command: 'return', label: 'Return', icon: 'home' },
  { command: 'estop', label: 'E-STOP', icon: 'report', danger: true },
]

function Panel({ title, children }) {
  return (
    <div className="rs-card rs-p-4 rs-mb-4">
      <div className="rs-card-label rs-mb-3">{title}</div>{children}
    </div>
  )
}

function Dashboard({ unit, sendCmd, latest, alerts, refresh, program }) {
  const t = latest || {}
  const mapItems = Number.isFinite(t.lat) ? [{ id: unit.unit_id, label: unit.name, lat: t.lat, lng: t.lng, online: true }] : []
  return (
    <div>
      <Panel title={`${unit.name || unit.unit_id} · ${t.patrolling ? 'PATROLLING' : 'STANDBY'}`}>
        <div className="rs-flex rs-gap-6 rs-flex-wrap rs-mb-4">
          <MetricStat label="POSTURE" value={t.posture || 'stand'} accent="#f59e0b" />
          <MetricStat label="WAYPOINT" value={`#${t.waypoint ?? 0}`} />
          <MetricStat label="STATE" value={t.patrolling ? 'patrol' : 'idle'} />
        </div>
        <BatteryBar pct={t.battery_pct} />
      </Panel>

      <Panel title="PATROL MAP"><MiniMap items={mapItems} /></Panel>
      <Panel title="DOG CONTROL"><CommandConsole spec={COMMANDS} onSend={sendCmd} /></Panel>
      <Panel title="ALERTS"><AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} /></Panel>
    </div>
  )
}

export default function SentinelFleet() {
  return (
    <ProgramShell program="sentinel" title="Sentinel" subtitle="Patrol robot dogs"
      icon="pets" accent="#f59e0b" renderDashboard={(p) => <Dashboard {...p} />} />
  )
}
