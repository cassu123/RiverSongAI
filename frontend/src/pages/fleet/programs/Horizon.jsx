// Horizon (drones) — bespoke flight dashboard.
import React from 'react'
import ProgramShell from '../shared/ProgramShell.jsx'
import { MetricStat, BatteryBar, Sparkline, MiniMap, CommandConsole, AlertsList } from '../shared/FleetUI.jsx'

const COMMANDS = [
  { command: 'takeoff', label: 'Take off', icon: 'flight_takeoff', params: { altitude: 30 } },
  { command: 'orbit', label: 'Orbit', icon: 'sync' },
  { command: 'rth', label: 'Return home', icon: 'home' },
  { command: 'land', label: 'Land', icon: 'flight_land' },
  { command: 'estop', label: 'E-STOP', icon: 'report', danger: true },
]

function Panel({ title, children, action }) {
  return (
    <div className="rs-card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="rs-card-label">{title}</div>{action}
      </div>
      {children}
    </div>
  )
}

function Dashboard({ unit, sendCmd, telemetry, latest, alerts, commands, refresh, program }) {
  const t = latest || {}
  const mapItems = (Number.isFinite(t.lat)) ? [{ id: unit.unit_id, label: unit.name, lat: t.lat, lng: t.lng, online: true }] : []
  return (
    <div>
      <Panel title={`${unit.name || unit.unit_id} · ${(t.mode || 'idle').toUpperCase()}`}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
          <MetricStat label="ALTITUDE" value={t.altitude_m ?? 0} unit="m" accent="var(--primary)" />
          <MetricStat label="SPEED" value={t.speed_mps ?? 0} unit="m/s" />
          <MetricStat label="MODE" value={t.mode || 'idle'} />
        </div>
        <BatteryBar pct={t.battery_pct} />
        <div style={{ marginTop: 14 }}>
          <div className="rs-card-label" style={{ fontSize: '0.58rem', marginBottom: 4 }}>ALTITUDE (m)</div>
          <Sparkline data={telemetry} field="altitude_m" color="var(--primary)" />
        </div>
      </Panel>

      <Panel title="POSITION"><MiniMap items={mapItems} /></Panel>

      <Panel title="FLIGHT CONTROL">
        <CommandConsole spec={COMMANDS} onSend={sendCmd} />
      </Panel>

      <Panel title="ALERTS">
        <AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} />
      </Panel>

      <Panel title="FLIGHT LOG">
        {commands?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {commands.slice(0, 8).map(c => (
              <div key={c.command_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                <span>{c.payload?.command}</span>
                <span style={{ opacity: 0.55 }}>{c.status} · {new Date(c.issued_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        ) : <div className="rs-card-meta">No commands yet.</div>}
      </Panel>
    </div>
  )
}

export default function HorizonFleet() {
  return (
    <ProgramShell program="horizon" title="Horizon" subtitle="Aerial drone fleet"
      icon="paragliding" accent="#6ea8fe" renderDashboard={(p) => <Dashboard {...p} />} />
  )
}
