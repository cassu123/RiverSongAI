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
    <span className="rs-pill rs-items-center rs-type-nano" style={{
      padding: '2px 8px',
      display: 'inline-flex',
      gap: 5,
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
    <div className="rs-flex rs-flex-col" style={{ gap: 2, minWidth: 86 }}>
      <div className="rs-card-label rs-type-nano">{label}</div>
      <div className="rs-type-h3 rs-fw-700" style={{
        fontVariantNumeric: 'tabular-nums',
        color: accent || 'var(--text-primary, inherit)',
      }}>
        {value}{unit && <span className="rs-muted rs-type-micro rs-fw-500"> {unit}</span>}
      </div>
    </div>
  )
}

// ---- Battery bar -----------------------------------------------------------
export function BatteryBar({ pct }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0))
  const color = v < 20 ? 'var(--md-error)' : v < 45 ? 'var(--rs-status-warning, #f4b740)' : 'var(--rs-status-nominal, #36d399)'
  return (
    <div className="rs-flex rs-items-center rs-gap-2">
      <div className="rs-grow rs-clip" style={{ height: 8, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-surface-container-high, #2a2a2a)' }}>
        <div className="rs-h-full" style={{ width: `${v}%`, background: color, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 'var(--rs-fs-tiny)', color }}>{v}%</span>
    </div>
  )
}

// ---- Inline SVG sparkline (no external dep, always renders) -----------------
export function Sparkline({ data, field, height = 44, color = 'var(--primary, #6ea8fe)' }) {
  const pts = (data || []).map(d => Number(d?.[field])).filter(v => Number.isFinite(v))
  if (pts.length < 2) {
    return <div className="rs-card-meta rs-muted rs-type-nano">waiting for telemetry…</div>
  }
  const w = 240, h = height
  const min = Math.min(...pts), max = Math.max(...pts)
  const span = max - min || 1
  const step = w / (pts.length - 1)
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <div className="rs-relative">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 'var(--rs-fs-nano)', fontWeight: 700,
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
    <div style={{ position: 'relative', height, borderRadius: 'var(--md-shape-md)', overflow: 'hidden',
      background: 'radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 70%), var(--md-surface-container-low, #161616)',
      border: '1px solid var(--md-outline-variant, #333)' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rs-w-full rs-h-full" style={{ position: 'absolute', inset: 0 }}>
        {[20, 40, 60, 80].map(g => <line key={`h${g}`} x1="0" y1={g} x2="100" y2={g} stroke="var(--md-outline-variant,#333)" strokeWidth="0.2" />)}
        {[20, 40, 60, 80].map(g => <line key={`v${g}`} x1={g} y1="0" x2={g} y2="100" stroke="var(--md-outline-variant,#333)" strokeWidth="0.2" />)}
      </svg>
      {pts.map(p => {
        const sel = p.id === selectedId
        return (
          <div key={p.id} title={p.label} className="rs-flex rs-flex-col rs-items-center" style={{
            position: 'absolute',
            left: `${nx(p.lng)}%`,
            top: `${ny(p.lat)}%`,
            transform: 'translate(-50%,-50%)',
            gap: 2,
          }}>
            <span style={{ width: sel ? 14 : 10, height: sel ? 14 : 10, borderRadius: '50%',
              background: p.online ? 'var(--rs-status-nominal,#36d399)' : 'var(--md-error)',
              boxShadow: p.online ? '0 0 10px var(--rs-status-nominal,#36d399)' : 'none',
              border: '2px solid rgba(0,0,0,0.4)' }} />
            <span className="rs-type-nano rs-nowrap" style={{ color: 'var(--text-secondary,#aaa)' }}>{p.label}</span>
          </div>
        )
      })}
      {pts.length === 0 && (
        <div className="rs-type-tiny" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-secondary,#888)' }}>
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
    <div className="rs-flex rs-flex-wrap rs-gap-2">
      {spec.map(c => (
        <button
          key={c.command}
          disabled={disabled}
          className={c.danger ? 'rs-btn-ghost' : 'rs-btn-primary'}
          onClick={() => onSend(c.command, c.params || {})}
          style={{
            fontSize: 'var(--rs-fs-micro)', padding: 'var(--rs-space-2) var(--rs-space-4)', display: 'inline-flex', alignItems: 'center', gap: 'var(--rs-space-2)',
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
    <div className="rs-flex rs-flex-col rs-gap-2">
      {alerts.map(a => {
        const crit = (a.level || '').toLowerCase() === 'critical' || (a.level || '').toLowerCase() === 'emergency'
        return (
          <div key={a.id} className="rs-flex rs-items-center rs-gap-3" style={{
            padding: 'var(--rs-space-3) var(--rs-space-3)',
            borderRadius: 'var(--md-shape-sm)',
            background: crit ? 'color-mix(in srgb, var(--md-error) 12%, transparent)' : 'color-mix(in srgb, var(--rs-status-warning,#f4b740) 12%, transparent)',
            border: `1px solid ${crit ? 'var(--md-error)' : 'var(--rs-status-warning,#f4b740)'}`,
          }}>
            <span className="material-symbols-rounded" style={{ color: crit ? 'var(--md-error)' : 'var(--rs-status-warning,#f4b740)' }}>
              {crit ? 'error' : 'warning'}
            </span>
            <div className="rs-grow">
              <div className="rs-type-tiny rs-fw-600">{a.message}</div>
              <div className="rs-card-meta rs-type-nano">{a.level} · {new Date(a.timestamp).toLocaleString()}</div>
            </div>
            <button className="rs-btn-ghost rs-type-nano" style={{ padding: 'var(--rs-space-1) var(--rs-space-3)' }}
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
    <button className="rs-btn-primary rs-items-center rs-gap-2 rs-type-micro" disabled={busy}
      style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', display: 'inline-flex' }}
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--rs-scrim-2)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} className="rs-card" style={{ width: 'min(460px, 92vw)', padding: 22 }}>
        <div className="rs-card-label rs-mb-2">CLAIM A {program.toUpperCase()} UNIT</div>
        {!result ? (
          <>
            <p className="rs-card-meta">Name the unit, then flash the returned token into the device firmware.</p>
            <input className="rs-input rs-w-full" autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Front-yard unit" style={{ margin: 'var(--rs-space-3) 0' }}
              onKeyDown={e => e.key === 'Enter' && submit()} />
            <div className="rs-flex rs-gap-2 rs-justify-end">
              <button className="rs-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="rs-btn-primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Claiming…' : 'Claim'}</button>
            </div>
          </>
        ) : (
          <>
            <p className="rs-card-meta">Unit <strong>{result.unit_id}</strong> claimed. Copy this token into the device — it is shown only once.</p>
            <div className="rs-flex rs-gap-2 rs-items-center" style={{ margin: 'var(--rs-space-3) 0' }}>
              <code className="rs-grow rs-type-micro" style={{
                padding: 'var(--rs-space-3) var(--rs-space-3)',
                borderRadius: 'var(--md-shape-sm)',
                background: 'var(--md-surface-container-lowest,#0e0e0e)',
                border: '1px solid var(--md-outline-variant,#333)',
                wordBreak: 'break-all',
              }}>
                {result.unit_token}
              </code>
              <button className="rs-btn-ghost" onClick={() => { navigator.clipboard?.writeText(result.unit_token); setCopied(true) }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="rs-card-meta rs-mb-3 rs-type-nano">
              Headless test: <code>python scripts/fleet_sim.py --program {program} --unit-id {result.unit_id} --token &lt;token&gt;</code>
            </div>
            <div className="rs-flex rs-justify-end">
              <button className="rs-btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
