// Vortex (home hubs) — bespoke hub panel.
import React from 'react'
import ProgramShell from '../shared/ProgramShell.jsx'
import { MetricStat, Sparkline, CommandConsole, AlertsList } from '../shared/FleetUI.jsx'

const COMMANDS = [
  { command: 'cast', label: 'Cast', icon: 'cast', params: { target: 'Living Room TV' } },
  { command: 'stop_cast', label: 'Stop cast', icon: 'cast_pause' },
  { command: 'run_scene', label: 'Run scene', icon: 'auto_awesome' },
  { command: 'restart', label: 'Restart hub', icon: 'restart_alt', danger: true },
]

function Gauge({ label, pct, color }) {
  const v = Math.max(0, Math.min(100, pct || 0))
  return (
    <div className="rs-grow" style={{ minWidth: 120 }}>
      <div className="rs-flex rs-justify-between rs-mb-1">
        <span className="rs-card-label rs-type-nano">{label}</span>
        <span style={{ fontSize: 'var(--rs-fs-micro)', fontWeight: 700, color }}>{v}%</span>
      </div>
      <div className="rs-clip" style={{ height: 8, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-surface-container-high,#2a2a2a)' }}>
        <div className="rs-h-full" style={{ width: `${v}%`, background: color, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="rs-card rs-p-4 rs-mb-4">
      <div className="rs-card-label rs-mb-3">{title}</div>{children}
    </div>
  )
}

function fmtUptime(s) {
  s = Number(s) || 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

function Dashboard({ unit, sendCmd, telemetry, latest, alerts, refresh, program }) {
  const t = latest || {}
  return (
    <div>
      <Panel title={`${unit.name || unit.unit_id} · ${t.casting ? 'CASTING' : 'IDLE'}`}>
        <div className="rs-flex rs-gap-6 rs-flex-wrap rs-mb-4">
          <MetricStat label="DEVICES" value={t.connected_devices ?? 0} accent="#22d3ee" />
          <MetricStat label="UPTIME" value={fmtUptime(t.uptime_s)} />
          <div className="rs-flex rs-flex-col" style={{ gap: 2 }}>
            <div className="rs-card-label rs-type-nano">CASTING</div>
            <span className="rs-type-tiny" style={{ fontWeight: 600 }}>{t.casting ? (t.cast_target || 'on') : '—'}</span>
          </div>
        </div>
        <div className="rs-flex rs-gap-5">
          <Gauge label="CPU" pct={t.cpu_pct} color="#22d3ee" />
          <Gauge label="MEMORY" pct={t.mem_pct} color="#818cf8" />
        </div>
        <div className="rs-mt-4">
          <div className="rs-card-label rs-mb-1 rs-type-nano">CPU LOAD</div>
          <Sparkline data={telemetry} field="cpu_pct" color="#22d3ee" />
        </div>
      </Panel>

      <Panel title="HUB CONTROL"><CommandConsole spec={COMMANDS} onSend={sendCmd} /></Panel>
      <Panel title="ALERTS"><AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} /></Panel>
    </div>
  )
}

export default function VortexFleet() {
  return (
    <ProgramShell program="vortex" title="Vortex" subtitle="Home hub network"
      icon="hub" accent="#22d3ee" renderDashboard={(p) => <Dashboard {...p} />} />
  )
}
