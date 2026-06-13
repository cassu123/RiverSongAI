// =============================================================================
// pages/fleet/shared/useFleet.js
//
// Data hooks + action helpers for the generic fleet programs (Horizon, Kova,
// Sentinel, Vortex, Vexa), all wired to /api/{program}/* via apiFetch.
// Live polling uses useInterval (pauses when the tab is hidden).
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, toast } from '../../../lib/api.js'
import { useInterval } from '../../../hooks/useInterval.js'

// ---- Live unit list for a program ------------------------------------------
export function useUnits(program, intervalMs = 3000) {
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/${program}/units`, { silent: true })
      setUnits(data?.units || [])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [program])

  useEffect(() => { setLoading(true); refresh() }, [refresh])
  useInterval(refresh, intervalMs)

  return { units, loading, error, refresh }
}

// ---- Live detail for one unit (telemetry + alerts + commands) ---------------
export function useUnitDetail(program, unitId, intervalMs = 2000) {
  const [unit, setUnit] = useState(null)
  const [telemetry, setTelemetry] = useState([])
  const [alerts, setAlerts] = useState([])
  const [commands, setCommands] = useState([])

  const refresh = useCallback(async () => {
    if (!unitId) return
    try {
      const [u, t, a, c] = await Promise.all([
        apiFetch(`/api/${program}/units/${unitId}`, { silent: true }).catch(() => null),
        apiFetch(`/api/${program}/units/${unitId}/telemetry?limit=120`, { silent: true }).catch(() => ({ telemetry: [] })),
        apiFetch(`/api/${program}/units/${unitId}/alerts?limit=50`, { silent: true }).catch(() => ({ alerts: [] })),
        apiFetch(`/api/${program}/units/${unitId}/commands?limit=30`, { silent: true }).catch(() => ({ commands: [] })),
      ])
      if (u) setUnit(u)
      setTelemetry(t?.telemetry || [])
      setAlerts(a?.alerts || [])
      setCommands(c?.commands || [])
    } catch { /* transient; keep last good */ }
  }, [program, unitId])

  useEffect(() => { refresh() }, [refresh])
  useInterval(refresh, intervalMs)

  const latest = telemetry.length ? telemetry[telemetry.length - 1] : null
  return { unit, telemetry, latest, alerts, commands, refresh }
}

// ---- Actions ----------------------------------------------------------------
export async function claimUnit(program, name) {
  return apiFetch(`/api/${program}/units/claim`, { method: 'POST', body: { name } })
}

export async function simulateUnit(program) {
  const res = await apiFetch(`/api/${program}/units/simulate`, { method: 'POST', body: {} })
  toast(`Simulated unit ${res.unit_id} is coming online`, 'success')
  return res
}

export async function sendCommand(program, unitId, command, params = {}) {
  const res = await apiFetch(`/api/${program}/units/${unitId}/command`, {
    method: 'POST', body: { command, params },
  })
  toast(`Sent: ${command}`, 'success')
  return res
}

export async function deleteUnit(program, unitId, simulated = false) {
  const path = simulated
    ? `/api/${program}/units/${unitId}/simulate`
    : `/api/${program}/units/${unitId}`
  return apiFetch(path, { method: 'DELETE' })
}

export async function ackAlert(program, unitId, alertId) {
  return apiFetch(`/api/${program}/units/${unitId}/alerts/${alertId}/ack`, { method: 'POST' })
}

export async function rotateToken(program, unitId) {
  return apiFetch(`/api/${program}/units/${unitId}/rotate-token`, { method: 'POST' })
}

// Helper: is a unit considered live? (online flag + recent last_seen)
export function isOnline(unit) {
  if (!unit) return false
  if (!unit.online) return false
  if (!unit.last_seen) return true
  const age = Date.now() - new Date(unit.last_seen).getTime()
  return age < 15000
}
