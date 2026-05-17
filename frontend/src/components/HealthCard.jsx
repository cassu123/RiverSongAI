import React, { useState, useEffect } from 'react'

const HealthCard = () => {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchHealth = async () => {
    try {
      const resp = await fetch('/health')
      if (!resp.ok) throw new Error('Health check failed')
      const data = await resp.json()
      setHealth(data)
      setError(false)
    } catch (err) {
      console.error('[Health] Failed to fetch:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !health) return <div className="rs-card-meta" style={{ padding: 24 }}>SCANNING SYSTEMS...</div>
  if (error && !health) return <div className="rs-card" style={{ borderLeft: '4px solid var(--md-error)' }}>HEALTH TELEMETRY OFFLINE</div>

  const statusColor = health.status === 'ok' ? '#4ade80' : 
                      health.status === 'degraded' ? '#facc15' : 'var(--md-error)'
  
  const statusLabel = health.status === 'ok' ? 'NOMINAL' : 
                      health.status === 'degraded' ? 'DEGRADED' : 'CRITICAL'

  const formatLastBriefing = (iso) => {
    if (!iso) return 'NEVER'
    const date = new Date(iso)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    return isToday ? `TODAY ${timeStr}` : date.toLocaleDateString().toUpperCase()
  }

  return (
    <div className="rs-card health-card" style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}>
      <div className="rs-card-head">
        <span className="rs-card-label">SYSTEM HEALTH</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="rs-status-dot" style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}` }} />
          <span className="rs-card-label" style={{ color: statusColor, opacity: 1 }}>{statusLabel}</span>
        </div>
      </div>

      <div className="health-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
        <HealthRow 
          label="BRAIN" 
          value={health.ollama.reachable ? 'ONLINE' : 'OFFLINE'} 
          subValue={health.ollama.reachable ? `${health.ollama.response_time_ms}ms` : null}
          isError={!health.ollama.reachable}
        />
        <HealthRow label="LLM MODEL" value={(health.ollama.active_model || health.providers.llm_model)?.toUpperCase()} />
        <HealthRow label="VOICE" value={health.providers.active_voice?.toUpperCase()} />
        <HealthRow label="EARS" value={health.providers.stt_model?.toUpperCase()} />
        <HealthRow 
          label="MEMORIES" 
          value={`${health.memory.fact_count} FACTS · ${health.memory.habit_count} PATTERNS`} 
        />
        <HealthRow 
          label="PUSH ALERTS" 
          value={health.push_notifications_enabled ? 'ENABLED' : 'DISABLED'} 
        />
        <HealthRow 
          label="LAST BRIEFING" 
          value={formatLastBriefing(health.last_briefing)} 
        />
        <HealthRow 
          label="UPTIME" 
          value={`${Math.floor(health.uptime_seconds / 3600)}H ${Math.floor((health.uptime_seconds % 3600) / 60)}M`} 
        />
      </div>
    </div>
  )
}

const HealthRow = ({ label, value, subValue, isError }) => (
  <div className="health-row">
    <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 2 }}>{label}</div>
    <div className="rs-card-value" style={{ fontSize: '0.9rem', color: isError ? 'var(--md-error)' : 'var(--fg)', letterSpacing: '0.02em' }}>
      {value}
      {subValue && <span style={{ opacity: 0.5, fontSize: '0.75rem', marginLeft: 6 }}>[{subValue}]</span>}
    </div>
  </div>
)

export default HealthCard
