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
    <div className="rs-card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="rs-card-label" style={{ marginBottom: 12 }}>{title}</div>{children}
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
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 14 }}>
          <MetricStat label="CHORE" value={chore} accent="#34d399" />
          <MetricStat label="ROOM" value={(t.room || 'dock').replace('_', ' ')} />
          <MetricStat label="STATE" value={t.docked ? 'docked' : 'active'} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div className="rs-card-label" style={{ fontSize: '0.58rem', marginBottom: 4 }}>CHORE PROGRESS</div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--md-surface-container-high,#2a2a2a)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#34d399', transition: 'width .4s ease' }} />
          </div>
          <div className="rs-card-meta" style={{ fontSize: '0.66rem', marginTop: 4 }}>{progress}%</div>
        </div>
        <BatteryBar pct={t.battery_pct} />
      </Panel>

      <Panel title="CHORE CONTROL"><CommandConsole spec={COMMANDS} onSend={sendCmd} /></Panel>
      <Panel title="ALERTS"><AlertsList program={program} unitId={unit.unit_id} alerts={alerts} onChange={refresh} /></Panel>

      <Panel title="ACTIVITY">
        {commands?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {commands.slice(0, 8).map(c => (
              <div key={c.command_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
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
