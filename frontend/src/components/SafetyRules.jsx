import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * The built-in safety pack and anything authored on top of it.
 *
 * Each rule can be muted, retuned, and — the point of this panel — tripped
 * with a synthetic event so you can find out whether an alert actually lands
 * without staging the emergency it watches for.
 */

const SEVERITY_TONE = {
  critical: 'var(--md-error)',
  warning:  'var(--warn)',
  info:     'var(--md-primary)',
}

/** Plain-English description of what a rule is watching. */
function watching(rule) {
  const w = rule.watches || {}
  const what =
    w.device_class ? `any ${w.device_class.replace(/_/g, ' ')} sensor` :
    w.entity_id    ? w.entity_id :
    w.domain       ? `any ${w.domain}` :
    w.area         ? `anything in ${w.area}` : 'nothing'
  const to = w.to_state ? ` turning ${w.to_state}` : ''
  const held = rule.for_seconds ? ` for ${Math.round(rule.for_seconds / 60)} min` : ''
  const win = rule.time_window
    ? ` between ${rule.time_window.start} and ${rule.time_window.end}` : ''
  return `${what}${to}${held}${win}`
}

/** A synthetic event that should satisfy this rule's own selectors. */
function sampleEventFor(rule) {
  const w = rule.watches || {}
  const domain = w.domain || (w.entity_id ? w.entity_id.split('.')[0] : 'binary_sensor')
  return {
    entity_id: w.entity_id || `${domain}.river_test`,
    state: w.to_state || 'on',
    device_class: w.device_class || undefined,
    area: w.area || undefined,
    friendly_name: `${rule.name} (test)`,
  }
}

export default function SafetyRules() {
  const { token } = useAuth()
  const [rules,   setRules]   = useState(null)
  const [busy,    setBusy]    = useState(null)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token])

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/home/triggers', { headers: headers() })
      setRules(r.ok ? await r.json() : [])
    } catch {
      setRules([])
    }
  }, [headers])

  useEffect(() => { if (token) load() }, [token, load])

  const toggle = async (rule) => {
    setBusy(rule.id)
    setRules(prev => prev.map(r =>
      r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
    try {
      await fetch(`/api/home/triggers/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
    } finally {
      setBusy(null)
    }
  }

  const test = async (rule, deliver) => {
    setBusy(rule.id)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/home/triggers/test', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...sampleEventFor(rule), deliver }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const mine = (data.rules || []).find(r => r.id === rule.id)
      setResult({
        ruleId: rule.id,
        delivered: data.delivered,
        ok: !!mine?.would_fire,
        reason: mine?.reason || 'rule not evaluated',
        delay: mine?.delay_seconds || 0,
        others: (data.would_fire || []).filter(n => n !== rule.name),
        localTime: data.local_time,
      })
    } catch (e) {
      setError(`Test failed: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  if (!rules) return null

  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">SAFETY &amp; ALERTS</span>
      </div>

      {rules.length === 0 && (
        <p className="rs-card-meta" style={{ fontSize: '0.95rem' }}>
          No alert rules yet. The built-in pack is created on startup once
          Home Assistant is configured.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {rules.map(rule => {
          const tone = SEVERITY_TONE[rule.severity] || SEVERITY_TONE.info
          const showing = result && result.ruleId === rule.id
          return (
            <div key={rule.id} style={{
              border: '1px solid var(--border)', borderLeft: `3px solid ${tone}`,
              borderRadius: 10, padding: 14,
              opacity: rule.enabled ? 1 : 0.55,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{rule.name}</span>
                <span style={{ fontSize: '0.85rem', color: tone, fontWeight: 700,
                               letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {rule.severity}
                </span>
                {rule.builtin && (
                  <span className="rs-pill" style={{ fontSize: '0.85rem' }}>BUILT-IN</span>
                )}
                <div style={{ flex: 1 }} />
                <button className={rule.enabled ? 'rs-pill is-active' : 'rs-pill'}
                        style={{ fontSize: '0.85rem' }}
                        onClick={() => toggle(rule)} disabled={busy === rule.id}>
                  {rule.enabled ? 'ON' : 'MUTED'}
                </button>
              </div>

              <div className="rs-card-meta" style={{ fontSize: '0.95rem', marginTop: 6 }}>
                Watches {watching(rule)}.
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="rs-pill" style={{ fontSize: '0.85rem' }}
                        onClick={() => test(rule, false)} disabled={busy === rule.id}>
                  TEST
                </button>
                <button className="rs-pill" style={{ fontSize: '0.85rem' }}
                        onClick={() => test(rule, true)} disabled={busy === rule.id}
                        title="Fires the real alert, including push">
                  SEND FOR REAL
                </button>
              </div>

              {showing && (
                <div style={{
                  marginTop: 10, padding: 12, borderRadius: 8,
                  background: 'rgba(0,0,0,0.22)', fontSize: '0.95rem',
                  border: `1px solid ${result.ok ? 'var(--secondary)' : 'var(--warn)'}`,
                }}>
                  <div style={{ fontWeight: 700, color: result.ok ? 'var(--secondary)' : 'var(--warn)' }}>
                    {result.ok
                      ? (result.delay
                          ? `Would fire, after ${Math.round(result.delay / 60)} min held`
                          : 'Would fire')
                      : 'Would not fire'}
                  </div>
                  <div style={{ opacity: 0.85, marginTop: 4 }}>{result.reason}</div>
                  {result.delivered && (
                    <div style={{ marginTop: 6, color: 'var(--md-primary)' }}>
                      Sent for real — check your phone. Quiet hours still apply
                      unless this rule is critical.
                    </div>
                  )}
                  {result.others.length > 0 && (
                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Also matched: {result.others.join(', ')}
                    </div>
                  )}
                  <div style={{ marginTop: 6, opacity: 0.6, fontSize: '0.85rem' }}>
                    Local time {result.localTime}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="rs-card-meta" style={{ fontSize: '0.95rem', color: 'var(--md-error)', marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}
