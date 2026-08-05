// =============================================================================
// pages/fleet/shared/FleetUI.jsx
//
// Presentational building blocks the bespoke program pages compose. Built on
// the existing chrome (rs-card / rs-pill / design tokens) so each program page
// stays on the established visual quality bar.
// =============================================================================

import React, { useState } from 'react'
import { claimUnit, simulateUnit, ackAlert, isOnline } from './useFleet.js'

// ---- Status pill -----------------------------------------------------------
export function UnitStatusPill({ unit }) {
  const live = isOnline(unit)
  return (
    <span className="rs-pill" style={{
      fontSize: '0.62rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 5,
      background: live ? 'color-mix(in srgb, var(--rs-status-nominal, #36d399) 16%, transparent)'
                       : 'color-mix(in srgb, var(--md-error) 14%, transparent)',
      color: live ? 'var(--rs-status-nominal, #36d399)' : 'var(--md-error)',
      border: `1px solid ${live ? 'var(--rs-status-nominal, #36d399)' : 'var(--md-error)'}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor',
        boxShadow: live ? '0 0 6px currentColor' : 'none' }} />
      {live ? 'ONLINE' : 'OFFLINE'}
    </span>
  )
}

// ---- Big metric stat -------------------------------------------------------
export function MetricStat({ label, value, unit, accent }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 86 }}>
      <div className="rs-card-label" style={{ fontSize: '0.58rem' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '1.25rem', fontVariantNumeric: 'tabular-nums',
        color: accent || 'var(--text-primary, inherit)' }}>
        {value}{unit && <span style={{ fontSize: '0.72rem', opacity: 0.55, fontWeight: 500 }}> {unit}</span>}
      </div>
    </div>
  )
}

// ---- Battery bar -----------------------------------------------------------
export function BatteryBar({ pct }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0))
  const color = v < 20 ? 'var(--md-error)' : v < 45 ? 'var(--rs-status-warning, #f4b740)' : 'var(--rs-status-nominal, #36d399)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--md-surface-container-high, #2a2a2a)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${v}%`, background: color, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.8rem', color }}>{v}%</span>
    </div>
  )
}

// ---- Inline SVG sparkline (no external dep, always renders) -----------------
export function Sparkline({ data, field, height = 44, color = 'var(--primary, #6ea8fe)' }) {
  const pts = (data || []).map(d => Number(d?.[field])).filter(v => Number.isFinite(v))
  if (pts.length < 2) {
    return <div className="rs-card-meta" style={{ fontSize: '0.7rem', opacity: 0.5 }}>waiting for telemetry…</div>
  }
  const w = 240, h = height
  const min = Math.min(...pts), max = Math.max(...pts)
  const span = max - min || 1
  const step = w / (pts.length - 1)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: 'absolute', top: 0, right: 0, fontSize: '0.7rem', fontWeight: 700,
        color, fontVariantNumeric: 'tabular-nums' }}>{last}</span>
    </div>
  )
}

// ---- Position mini-map (SVG radar; plots units by lat/lng, no tiles needed) -
export function MiniMap({ items, height = 220, selectedId }) {
  const pts = (items || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng)
  const pad = 0.0008
  const minLat = (lats.length ? Math.min(...lats) : 40) - pad
  const maxLat = (lats.length ? Math.max(...lats) : 40) + pad
  const minLng = (lngs.length ? Math.min(...lngs) : -83) - pad
  const maxLng = (lngs.length ? Math.max(...lngs) : -83) + pad
  const nx = (lng) => ((lng - minLng) / (maxLng - minLng || 1)) * 100
  const ny = (lat) => (1 - (lat - minLat) / (maxLat - minLat || 1)) * 100
  return (
    <div style={{ position: 'relative', height, borderRadius: 12, overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 70%), var(--md-surface-container-low, #161616)',
      border: '1px solid var(--md-outline-variant, #333)' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {[20, 40, 60, 80].map(g => <line key={`h${g}`} x1="0" y1={g} x2="100" y2={g} stroke="var(--md-outline-variant,#333)" strokeWidth="0.2" />)}
        {[20, 40, 60, 80].map(g => <line key={`v${g}`} x1={g} y1="0" x2={g} y2="100" stroke="var(--md-outline-variant,#333)" strokeWidth="0.2" />)}
      </svg>
      {pts.map(p => {
        const sel = p.id === selectedId
        return (
          <div key={p.id} title={p.label} style={{
            position: 'absolute', left: `${nx(p.lng)}%`, top: `${ny(p.lat)}%`,
            transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          }}>
            <span style={{ width: sel ? 14 : 10, height: sel ? 14 : 10, borderRadius: '50%',
              background: p.online ? 'var(--rs-status-nominal,#36d399)' : 'var(--md-error)',
              boxShadow: p.online ? '0 0 10px var(--rs-status-nominal,#36d399)' : 'none',
              border: '2px solid rgba(0,0,0,0.4)' }} />
            <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary,#aaa)', whiteSpace: 'nowrap' }}>{p.label}</span>
          </div>
        )
      })}
      {pts.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-secondary,#888)', fontSize: '0.8rem' }}>
          No positioned units
        </div>
      )}
    </div>
  )
}

// ---- Command console: renders buttons from a spec --------------------------
// spec: [{ command, label, icon?, params?, danger? }]
export function CommandConsole({ spec, onSend, disabled }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {spec.map(c => (
        <button
          key={c.command}
          disabled={disabled}
          className={c.danger ? 'rs-btn-ghost' : 'rs-btn-primary'}
          onClick={() => onSend(c.command, c.params || {})}
          style={{
            fontSize: '0.78rem', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6,
            opacity: disabled ? 0.45 : 1,
            ...(c.danger ? { color: 'var(--md-error)', borderColor: 'var(--md-error)' } : {}),
          }}
        >
          {c.icon && <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>{c.icon}</span>}
          {c.label}
        </button>
      ))}
    </div>
  )
}

// ---- Alerts list with ack --------------------------------------------------
export function AlertsList({ program, unitId, alerts, onChange }) {
  if (!alerts?.length) {
    return <div className="rs-card-meta" style={{ opacity: 0.6 }}>No active alerts.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.map(a => {
        const crit = (a.level || '').toLowerCase() === 'critical' || (a.level || '').toLowerCase() === 'emergency'
        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
            background: crit ? 'color-mix(in srgb, var(--md-error) 12%, transparent)' : 'color-mix(in srgb, var(--rs-status-warning,#f4b740) 12%, transparent)',
            border: `1px solid ${crit ? 'var(--md-error)' : 'var(--rs-status-warning,#f4b740)'}`,
          }}>
            <span className="material-symbols-rounded" style={{ color: crit ? 'var(--md-error)' : 'var(--rs-status-warning,#f4b740)' }}>
              {crit ? 'error' : 'warning'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{a.message}</div>
              <div className="rs-card-meta" style={{ fontSize: '0.62rem' }}>{a.level} · {new Date(a.timestamp).toLocaleString()}</div>
            </div>
            <button className="rs-btn-ghost" style={{ fontSize: '0.7rem', padding: '4px 10px' }}
              onClick={async () => { await ackAlert(program, unitId, a.id); onChange && onChange() }}>
              ACK
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---- Simulate button -------------------------------------------------------
export function SimulateButton({ program, onDone }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className="rs-btn-primary" disabled={busy}
      style={{ fontSize: '0.78rem', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      onClick={async () => {
        setBusy(true)
        try { await simulateUnit(program); onDone && onDone() } finally { setBusy(false) }
      }}>
      <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>smart_toy</span>
      {busy ? 'Spinning up…' : 'Add simulated unit'}
    </button>
  )
}

// ---- Claim modal (real device): shows the one-time unit token --------------
export function ClaimUnitModal({ program, onClose, onDone }) {
  const [name, setName] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await claimUnit(program, name.trim())
      setResult(r)
      onDone && onDone()
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} className="rs-card" style={{ width: 'min(460px, 92vw)', padding: 22 }}>
        <div className="rs-card-label" style={{ marginBottom: 8 }}>CLAIM A {program.toUpperCase()} UNIT</div>
        {!result ? (
          <>
            <p className="rs-card-meta">Name the unit, then flash the returned token into the device firmware.</p>
            <input className="rs-input" autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Front-yard unit" style={{ width: '100%', margin: '12px 0' }}
              onKeyDown={e => e.key === 'Enter' && submit()} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="rs-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="rs-btn-primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Claiming…' : 'Claim'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="rs-card-meta">Unit <strong>{result.unit_id}</strong> claimed. Copy this token into the device — it is shown only once.</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
              <code style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--md-surface-container-lowest,#0e0e0e)',
                border: '1px solid var(--md-outline-variant,#333)', fontSize: '0.72rem', wordBreak: 'break-all' }}>
                {result.unit_token}
              </code>
              <button className="rs-btn-ghost" onClick={() => { navigator.clipboard?.writeText(result.unit_token); setCopied(true) }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="rs-card-meta" style={{ fontSize: '0.66rem', marginBottom: 12 }}>
              Headless test: <code>python scripts/fleet_sim.py --program {program} --unit-id {result.unit_id} --token &lt;token&gt;</code>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="rs-btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
