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
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="rs-card-label" style={{ fontSize: '0.58rem' }}>{label}</span>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color }}>{v}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--md-surface-container-high,#2a2a2a)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${v}%`, background: color, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="rs-card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="rs-card-label" style={{ marginBottom: 12 }}>{title}</div>{children}
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
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 16 }}>
          <MetricStat label="DEVICES" value={t.connected_devices ?? 0} accent="#22d3ee" />
          <MetricStat label="UPTIME" value={fmtUptime(t.uptime_s)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="rs-card-label" style={{ fontSize: '0.58rem' }}>CASTING</div>
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.casting ? (t.cast_target || 'on') : '—'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          <Gauge label="CPU" pct={t.cpu_pct} color="#22d3ee" />
          <Gauge label="MEMORY" pct={t.mem_pct} color="#818cf8" />
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="rs-card-label" style={{ fontSize: '0.58rem', marginBottom: 4 }}>CPU LOAD</div>
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
