// Kova (chore robots) — bespoke task dashboard.
import React from 'react'
import ProgramShell from '../shared/ProgramShell.jsx'
import { MetricStat, BatteryBar, CommandConsole, AlertsList } from '../shared/FleetUI.jsx'

const COMMANDS = [
  { command: 'start_chore', label: 'Vacuum', icon: 'cleaning_services', params: { chore: 'vacuum' } },
  { command: 'start_chore', label: 'Mop', icon: 'water_drop', params: { chore: 'mop' } },
  { command: 'pause', label: 'Pause', icon: 'pause' },
  { command: 'resume', label: 'Resume', icon: 'play_arrow' },
  { command: 'dock', label: 'Dock', icon: 'dock', danger: true },
]

function Panel({ title, children }) {
  return (
    <div className="rs-card rs-p-4 rs-mb-4">
      <div className="rs-card-label rs-mb-3">{title}</div>{children}
    </div>
  )
}

function Dashboard({ unit, sendCmd, latest, alerts, commands, refresh, program }) {
  const t = latest || {}
  const chore = t.current_chore || 'idle'
  const progress = Math.max(0, Math.min(100, t.progress_pct || 0))
  return (
    <div>
      <Panel title={`${unit.name || unit.unit_id} · ${t.docked ? 'DOCKED' : 'WORKING'}`}>
        <div className="rs-flex rs-gap-6 rs-flex-wrap rs-mb-4">
          <MetricStat label="CHORE" value={chore} accent="#34d399" />
          <MetricStat label="ROOM" value={(t.room || 'dock').replace('_', ' ')} />
          <MetricStat label="STATE" value={t.docked ? 'docked' : 'active'} />
        </div>
        <div className="rs-mb-3">
          <div className="rs-card-label rs-mb-1" style={{ fontSize: 'var(--rs-fs-nano)' }}>CHORE PROGRESS</div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--md-surface-container-high,#2a2a2a)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#34d399', transition: 'width .4s ease' }} />
          </div>
          <div className="rs-card-meta rs-mt-1" style={{ fontSize: 'var(--rs-fs-nano)' }}>{progress}%</div>
        </div>
        <BatteryBar pct={t.battery_pct} />
      </Panel>

      <Panel title="CHORE CONTROL"><CommandConsole spec={COMMANDS} onSend={sendCmd} /></Panel>
      <Panel title="ALERTS"><AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} /></Panel>

      <Panel title="ACTIVITY">
        {commands?.length ? (
          <div className="rs-flex rs-flex-col rs-gap-1">
            {commands.slice(0, 8).map(c => (
              <div key={c.command_id} className="rs-flex rs-justify-between" style={{ fontSize: 'var(--rs-fs-micro)' }}>
                <span>{c.payload?.command} {c.payload?.params?.chore ? `(${c.payload.params.chore})` : ''}</span>
                <span style={{ opacity: 0.55 }}>{new Date(c.issued_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        ) : <div className="rs-card-meta">No tasks yet.</div>}
      </Panel>
    </div>
  )
}

export default function KovaFleet() {
  return (
    <ProgramShell program="kova" title="Kova" subtitle="Household chore robots"
      icon="cleaning_services" accent="#34d399" renderDashboard={(p) => <Dashboard {...p} />} />
  )
}
