import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

const COMMANDS = [
  { key: 'mow_start',    label: 'Start Mowing',  icon: 'grass',          variant: 'primary' },
  { key: 'mow_stop',     label: 'Stop',           icon: 'stop_circle',    variant: 'secondary' },
  { key: 'return_home',  label: 'Return Home',    icon: 'home',           variant: 'secondary' },
  { key: 'estop',        label: 'E-STOP',         icon: 'emergency_home', variant: 'danger' },
  { key: 'estop_reset',  label: 'Reset E-Stop',   icon: 'restart_alt',    variant: 'ghost' },
]

const MODE_COLOR = {
  AUTO:   'var(--color-success, #4ade80)',
  MANUAL: 'var(--primary, #7c6fe0)',
  ESTOP:  'var(--color-danger,  #f87171)',
  FAULT:  'var(--color-warn,    #fbbf24)',
}

const SESSION_LABELS = {
  IDLE:             'Idle',
  STARTING_ENGINE:  'Starting Engine',
  ENGAGING_PTO:     'Engaging PTO',
  MOWING:           'Mowing',
  PAUSED_OBSTACLE:  'Paused — Obstacle',
  PAUSED_FAULT:     'Paused — Fault',
  COMPLETING:       'Completing',
  RETURNING_HOME:   'Returning Home',
  DONE:             'Done',
  ABORTED:          'Aborted',
  UNKNOWN:          '—',
}

function timeAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never'
  if (seconds < 5)   return 'just now'
  if (seconds < 60)  return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

function OnlineDot({ online }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: online ? 'var(--color-success, #4ade80)' : '#555',
      boxShadow: online ? '0 0 6px var(--color-success, #4ade80)' : 'none',
      flexShrink: 0,
    }} />
  )
}

function TelemetryGrid({ tel }) {
  if (!tel) return <p className="rs-card-meta" style={{ padding: '8px 0' }}>No telemetry received yet.</p>

  const gps    = tel.gps    || {}
  const batt   = tel.battery || {}
  const sess   = tel.session || {}

  const rows = [
    { label: 'GPS',      value: gps.lat != null ? `${gps.lat?.toFixed(6)}, ${gps.lon?.toFixed(6)}` : '—' },
    { label: 'Battery',  value: batt.voltage != null ? `${batt.voltage?.toFixed(1)} V` : '—' },
    { label: 'Fuel',     value: tel.fuel_pct != null ? `${Math.round(tel.fuel_pct)}%` : '—' },
    { label: 'Temp',     value: tel.temperature != null ? `${tel.temperature?.toFixed(1)} °C` : '—' },
    { label: 'RPM',      value: tel.rpm != null ? `${Math.round(tel.rpm)}` : '—' },
    { label: 'Progress', value: sess.waypoint_pct != null ? `${Math.round(sess.waypoint_pct)}%` : '—' },
    { label: 'Obstacles',value: sess.obstacles_avoided != null ? sess.obstacles_avoided : '—' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="rs-card-meta">{r.label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--on-surface)' }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function AlertFeed({ alerts }) {
  if (!alerts?.length) return <p className="rs-card-meta" style={{ padding: '8px 0' }}>No alerts.</p>
  const SEV_COLOR = { CRITICAL: '#f87171', WARNING: '#fbbf24', INFO: '#60a5fa' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
      {[...alerts].reverse().map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.78rem' }}>
          <span style={{ color: SEV_COLOR[a.severity] || '#aaa', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {a.severity}
          </span>
          <span style={{ color: 'var(--on-surface-variant)' }}>{a.message}</span>
        </div>
      ))}
    </div>
  )
}

function EventFeed({ events }) {
  if (!events?.length) return <p className="rs-card-meta" style={{ padding: '8px 0' }}>No events.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
      {[...events].reverse().map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: '0.78rem' }}>
          <span style={{ color: 'var(--primary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {e.event}
          </span>
          <span style={{ color: 'var(--on-surface-variant)' }}>
            {typeof e.data === 'object' ? JSON.stringify(e.data) : e.data}
          </span>
        </div>
      ))}
    </div>
  )
}

function UnitCard({ unit, onCommand, sending }) {
  const status  = unit.last_status  || {}
  const modeColor = MODE_COLOR[status.mode] || 'var(--on-surface-variant)'
  const faults  = status.faults || []

  return (
    <div className="rs-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <OnlineDot online={unit.online} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{unit.unit_name || unit.unit_id}</div>
          <div className="rs-card-meta">{unit.platform_type} · {unit.unit_id}</div>
        </div>
        <div className="rs-card-meta" style={{ textAlign: 'right' }}>
          {unit.online ? 'Online' : timeAgo(unit.last_seen_seconds_ago)}
        </div>
      </div>

      {/* Status badges */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className="rs-pill" style={{ color: modeColor, borderColor: modeColor }}>
          {status.mode || 'UNKNOWN'}
        </span>
        <span className="rs-pill">
          {SESSION_LABELS[status.session] || status.session || '—'}
        </span>
        {unit.pending_commands > 0 && (
          <span className="rs-pill" style={{ color: 'var(--primary)' }}>
            {unit.pending_commands} cmd queued
          </span>
        )}
      </div>

      {/* Active faults */}
      {faults.length > 0 && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, padding: '8px 10px' }}>
          <span className="rs-card-label" style={{ color: '#f87171', display: 'block', marginBottom: 4 }}>Active Faults</span>
          {faults.map((f, i) => (
            <div key={i} style={{ fontSize: '0.78rem', color: '#f87171', fontFamily: 'var(--font-mono)' }}>{f}</div>
          ))}
        </div>
      )}

      {/* Telemetry */}
      <div>
        <span className="rs-card-label">Telemetry</span>
        <div style={{ marginTop: 8 }}>
          <TelemetryGrid tel={unit.last_telemetry} />
        </div>
      </div>

      {/* Commands */}
      <div>
        <span className="rs-card-label">Commands</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {COMMANDS.map(cmd => (
            <button
              key={cmd.key}
              className={`rs-btn rs-btn--${cmd.variant}`}
              style={cmd.variant === 'danger' ? { background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.4)' } : {}}
              disabled={sending === cmd.key}
              onClick={() => onCommand(unit.unit_id, cmd.key)}
              title={cmd.key}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>{cmd.icon}</span>
              {cmd.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts + Events */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <span className="rs-card-label">Recent Alerts</span>
          <div style={{ marginTop: 6 }}><AlertFeed alerts={unit.recent_alerts} /></div>
        </div>
        <div>
          <span className="rs-card-label">Events</span>
          <div style={{ marginTop: 6 }}><EventFeed events={unit.recent_events} /></div>
        </div>
      </div>
    </div>
  )
}

export default function VectorFleetPage({ setAction }) {
  const { token } = useAuth()
  const [units,   setUnits]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [sending, setSending] = useState(null)  // command key currently in-flight
  const [toast,   setToast]   = useState(null)
  const pollRef = useRef(null)

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchUnits = useCallback(async () => {
    try {
      const res = await fetch('/api/vector/units', { headers: authHeaders })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setUnits(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  // Poll every 3 s while on this page — mower sends telemetry at 10 Hz but
  // we don't need to hammer the backend; 3 s is plenty for a dashboard.
  useEffect(() => {
    fetchUnits()
    pollRef.current = setInterval(fetchUnits, 3000)
    return () => clearInterval(pollRef.current)
  }, [fetchUnits])

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const handleCommand = useCallback(async (unitId, command) => {
    setSending(command)
    try {
      const res = await fetch(`/api/vector/units/${unitId}/command`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail || `HTTP ${res.status}`)
      }
      const label = COMMANDS.find(c => c.key === command)?.label || command
      showToast(`Command queued: ${label}`)
      // Refresh to show pending_commands count
      await fetchUnits()
    } catch (err) {
      showToast(err.message, false)
    } finally {
      setSending(null)
    }
  }, [token, fetchUnits])

  // Page action button — manual refresh
  useEffect(() => {
    if (setAction) {
      setAction({
        label: 'Refresh',
        icon: 'refresh',
        onClick: fetchUnits,
      })
    }
  }, [setAction, fetchUnits])

  return (
    <div className="rs-foyer" style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: toast.ok ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)'}`,
          color: toast.ok ? '#4ade80' : '#f87171',
          borderRadius: 8, padding: '10px 16px',
          fontSize: '0.85rem', fontFamily: 'var(--font-mono)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.05em' }}>
          VECTOR FLEET
        </h2>
        <p className="rs-card-meta" style={{ marginTop: 4 }}>
          Autonomous mower control · updates every 3 s
        </p>
      </div>

      {loading && (
        <div className="rs-card" style={{ textAlign: 'center', padding: 40, color: 'var(--on-surface-variant)' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, display: 'block', marginBottom: 8 }}>radar</span>
          SCANNING FOR UNITS...
        </div>
      )}

      {!loading && error && (
        <div className="rs-card" style={{ color: '#f87171', textAlign: 'center', padding: 32 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 28, display: 'block', marginBottom: 8 }}>error</span>
          {error}
        </div>
      )}

      {!loading && !error && units.length === 0 && (
        <div className="rs-card" style={{ textAlign: 'center', padding: 40 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 40, color: 'var(--on-surface-variant)', display: 'block', marginBottom: 12 }}>
            mower
          </span>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No units registered</div>
          <p className="rs-card-meta">
            Start Voyager and make sure it can reach River Song.<br />
            It will register automatically on boot.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {units.map(unit => (
          <UnitCard
            key={unit.unit_id}
            unit={unit}
            onCommand={handleCommand}
            sending={sending}
          />
        ))}
      </div>
    </div>
  )
}
