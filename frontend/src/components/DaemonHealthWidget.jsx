/**
 * DaemonHealthWidget — background worker health for the system dashboard.
 *
 * Replaces the Market & News Pulse panel, which duplicated the Feeds page
 * (NewsTab, StocksTab) and was the one panel on a telemetry dashboard that
 * reported content rather than machine state.
 *
 * Reads GET /api/daemon/status, which returns the daemon registry:
 *
 *   { "daemons": { "<name>": { status, port, last_seen, alive } } }
 *
 * `alive` is computed server-side in daemons/registry.py as a heartbeat within
 * the last 60 seconds, so a worker that has stopped reporting goes stale here
 * about a minute after it dies.
 *
 * KNOWN LIMIT, deliberately not papered over: the registry only contains
 * daemons that have sent at least one heartbeat since the app started. A worker
 * that never came up at all is absent rather than red, and this component
 * cannot tell that apart from "never existed". Hardcoding an expected roster
 * would be worse — config/settings.py defines ports for chemist and navigator,
 * which have no implementation under daemons/, while vector_discovery and
 * vector_scheduler exist without a port setting. Any fixed list would raise
 * false alarms. The reporting count is shown instead so a shrinking number is
 * visible.
 */

import React, { useState, useEffect, useCallback } from 'react'

const C = {
  text:    'oklch(86% 0.01 265)',
  dim:     'oklch(38% 0.01 265)',
  divider: 'oklch(26% 0.01 265)',
  green:   'oklch(71% 0.17 145)',
  amber:   'oklch(76% 0.15 78)',
  red:     'oklch(64% 0.17 22)',
}

const POLL_MS = 30_000

/** Compact relative age: 4s, 90s -> 1m, 3h. Empty for unparseable input. */
function relativeAge(iso) {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  if (secs < 86400) return `${Math.round(secs / 3600)}h`
  return `${Math.round(secs / 86400)}d`
}

export default function DaemonHealthWidget({ token }) {
  const [daemons, setDaemons] = useState(null)
  const [loading, setLoading] = useState(true)
  // The endpoint is admin-only (_require_admin). A viewer hitting it gets 403,
  // which is an expected outcome for that role rather than a fault to report.
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/daemon/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403 || res.status === 401) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error()
      const json = await res.json()
      setDaemons(json.daemons || {})
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, POLL_MS)
    return () => clearInterval(id)
  }, [fetchStatus])

  if (loading) return <Note>Reading registry…</Note>
  if (forbidden) return <Note>Administrator access required.</Note>
  if (error) return <Note tone={C.red}>Registry unreachable.</Note>

  const names = Object.keys(daemons || {}).sort()

  if (names.length === 0) {
    return <Note tone={C.amber}>No daemons have reported a heartbeat.</Note>
  }

  const liveCount = names.filter((n) => daemons[n]?.alive).length

  return (
    <div>
      {names.map((name, i) => {
        const d = daemons[name] || {}
        const alive = Boolean(d.alive)
        return (
          <DaemonRow
            key={name}
            name={name}
            alive={alive}
            port={d.port}
            status={d.status}
            age={relativeAge(d.last_seen)}
            first={i === 0}
          />
        )
      })}
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: `1px solid ${C.divider}`,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.55rem',
          letterSpacing: '0.06em',
          color: liveCount === names.length ? C.dim : C.amber,
          opacity: liveCount === names.length ? 0.7 : 1,
        }}
      >
        {liveCount} / {names.length} REPORTING
      </div>
    </div>
  )
}

function DaemonRow({ name, alive, port, status, age, first }) {
  const tone = alive ? C.green : C.red
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 0',
        borderTop: first ? 'none' : `1px solid ${C.divider}`,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          inlineSize: 7,
          blockSize: 7,
          borderRadius: '50%',
          background: tone,
          boxShadow: alive ? `0 0 8px ${tone}` : 'none',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: '0.58rem',
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: alive ? C.text : C.dim,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name.replace(/_/g, ' ')}
      </span>
      {/* Status only when it is not the ordinary "alive" -- an unusual value is
          worth surfacing, the expected one is noise next to the dot. */}
      {status && status !== 'alive' && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.52rem',
            letterSpacing: '0.04em',
            color: C.amber,
            flexShrink: 0,
          }}
        >
          {String(status).toUpperCase()}
        </span>
      )}
      {port != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.52rem',
            letterSpacing: '0.04em',
            color: C.dim,
            opacity: 0.6,
            flexShrink: 0,
          }}
        >
          :{port}
        </span>
      )}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.58rem',
          letterSpacing: '0.04em',
          color: alive ? C.dim : C.red,
          opacity: alive ? 0.75 : 1,
          flexShrink: 0,
        }}
        title={alive ? 'Last heartbeat' : 'No heartbeat in over 60 seconds'}
      >
        {age}
      </span>
    </div>
  )
}

function Note({ children, tone = C.dim }) {
  return (
    <div
      style={{
        padding: '14px 0',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.58rem',
        letterSpacing: '0.05em',
        color: tone,
      }}
    >
      {children}
    </div>
  )
}
