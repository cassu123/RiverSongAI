import React, { useState, useCallback, useEffect } from 'react'
import { useAuthHeaders, API_BASE } from '../utils/useApi.js'
import { useInterval } from '../hooks/useInterval.js'

/**
 * SlaePage — admin control panel for the Synchronized Local Autonomous
 * Environment. Four sections (Agent Roles, Langfuse, Graphiti, Recent Activity)
 * each render a status pill so the user can see what's wired at a glance.
 *
 * Sections start "not-configured" and fill in as tasks land.
 */

const STATUS_STYLES = {
  not_configured: { bg: 'rgba(255,255,255,0.10)', fg: 'rgba(255,255,255,0.6)', label: 'NOT CONFIGURED' },
  disabled:       { bg: 'rgba(255,255,255,0.18)', fg: 'rgba(255,255,255,0.8)', label: 'DISABLED' },
  healthy:        { bg: 'var(--md-secondary)',    fg: 'var(--bg-base)',        label: 'HEALTHY' },
  error:          { bg: 'var(--md-error)',        fg: 'var(--bg-base)',        label: 'ERROR' },
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.not_configured
  return (
    <span className="rs-pill" style={{ background: s.bg, color: s.fg, fontSize: '0.6rem' }}>
      {s.label}
    </span>
  )
}

function Section({ title, status, message, children }) {
  return (
    <div className="rs-card is-wide" style={{ padding: 16, marginBottom: 16 }}>
      <div className="rs-card-head" style={{ marginBottom: 8 }}>
        <span className="rs-card-label">{title}</span>
        <StatusPill status={status} />
      </div>
      {message && (
        <div style={{ fontSize: '0.78rem', opacity: 0.7, marginBottom: 8 }}>{message}</div>
      )}
      {children}
    </div>
  )
}

export default function SlaePage({ setAction }) {
  const authHeaders = useAuthHeaders()
  const [data,    setData]    = useState(null)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/slae/status`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const json = await res.json()
      setData(json)
      setError('')
    } catch (e) {
      setError(e.message || 'Failed to load SLAE status.')
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { refresh() }, [refresh])
  useInterval(refresh, 10_000)

  useEffect(() => {
    if (setAction) setAction(<button className="rs-pill" onClick={refresh}>REFRESH</button>)
  }, [setAction, refresh])

  if (loading) {
    return <div className="rs-foyer animate-fade-in"><div className="rs-card-meta">LOADING SLAE STATUS…</div></div>
  }

  if (error) {
    return (
      <div className="rs-foyer animate-fade-in">
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">SLAE Control</h1>
          <div className="rs-greeting-sub" style={{ color: 'var(--md-error)' }}>{error.toUpperCase()}</div>
        </div>
      </div>
    )
  }

  const roles    = data?.agent_roles    || {}
  const langfuse = data?.langfuse       || {}
  const graphiti = data?.graphiti       || {}
  const recent   = data?.recent_activity || {}

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">SLAE Control</h1>
        <div className="rs-greeting-sub">
          Synchronized Local Autonomous Environment — observability for agent roles, tracing, and memory graph.
        </div>
      </div>

      <Section title="AGENT ROLES" status={roles.status} message={roles.message}>
        {(roles.roles || []).length === 0 ? (
          <div className="rs-card-meta">No roles registered yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', columnGap: 12, rowGap: 6, fontSize: '0.78rem' }}>
            {roles.roles.map((r) => {
              const inv = r.last_invocation
              const dot = inv ? (inv.success ? 'var(--md-secondary)' : 'var(--md-error)') : 'rgba(255,255,255,0.18)'
              return (
                <React.Fragment key={r.name}>
                  <span style={{ opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.name}</span>
                  <span style={{ opacity: 0.7 }}>
                    {r.provider}/{r.model}
                    {r.json_mode && <span style={{ marginLeft: 6, fontSize: '0.6rem', opacity: 0.7 }}>JSON</span>}
                    <span style={{ marginLeft: 8, fontSize: '0.65rem', opacity: 0.45 }}>T={r.temperature}</span>
                  </span>
                  <span title={inv ? `${inv.ts} (${inv.elapsed_ms ?? '—'} ms)` : 'No invocations yet'} style={{
                    width: 8, height: 8, borderRadius: '50%', background: dot, alignSelf: 'center',
                  }} />
                </React.Fragment>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="LANGFUSE TRACING" status={langfuse.status} message={langfuse.message}>
        {langfuse.dashboard_url && (
          <div style={{ fontSize: '0.78rem', marginBottom: 8 }}>
            <a href={langfuse.dashboard_url} target="_blank" rel="noreferrer" style={{ color: 'var(--md-secondary)' }}>
              OPEN DASHBOARD →
            </a>
          </div>
        )}
        {(langfuse.recent_traces || []).length > 0 && (
          <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
            {langfuse.recent_traces.length} recent traces.
          </div>
        )}
      </Section>

      <Section title="GRAPHITI KNOWLEDGE GRAPH" status={graphiti.status} message={graphiti.message}>
        <div style={{ display: 'flex', gap: 16, fontSize: '0.78rem', opacity: 0.8, marginBottom: 8 }}>
          <div>NODES: <strong>{graphiti.node_count ?? 0}</strong></div>
          <div>EDGES: <strong>{graphiti.edge_count ?? 0}</strong></div>
        </div>
        {graphiti.neo4j_browser_url && (
          <div style={{ fontSize: '0.78rem' }}>
            <a href={graphiti.neo4j_browser_url} target="_blank" rel="noreferrer" style={{ color: 'var(--md-secondary)' }}>
              OPEN NEO4J BROWSER →
            </a>
          </div>
        )}
      </Section>

      <Section title="RECENT ACTIVITY" status={recent.status} message={recent.message}>
        {(recent.events || []).length === 0 ? (
          <div className="rs-card-meta">No events yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recent.events.slice(0, 20).map((e, i) => (
              <div key={i} style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                <span style={{ opacity: 0.6 }}>{e.ts}</span>{' '}
                <span>{e.source}</span>{' — '}
                <span style={{ opacity: 0.7 }}>{e.summary}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
