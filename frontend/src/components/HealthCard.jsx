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

  if (loading && !health) return <div className="stat-card">Loading health...</div>
  if (error && !health) return <div className="stat-card" style={{ borderLeft: '4px solid var(--error)' }}>Health Unavailable</div>

  const statusColor = health.status === 'ok' ? 'var(--md-tertiary)' : 
                      health.status === 'degraded' ? 'var(--md-warning)' : 'var(--error)'
  
  const statusLabel = health.status === 'ok' ? 'All Systems Go' : 
                      health.status === 'degraded' ? 'Degraded' : 'Error'

  const formatLastBriefing = (iso) => {
    if (!iso) return 'Never'
    const date = new Date(iso)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    return isToday ? `Today at ${timeStr}` : date.toLocaleDateString()
  }

  return (
    <div className="stat-card health-card">
      <div className="health-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>River Song — System Health</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ 
            width: 8, height: 8, borderRadius: '50%', 
            backgroundColor: statusColor,
            boxShadow: `0 0 6px ${statusColor}`
          }} />
          <span style={{ fontSize: '0.75rem', color: statusColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="health-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
        <HealthRow 
          label="Brain (Ollama)" 
          value={health.ollama.reachable ? 'Online' : 'Offline'} 
          subValue={health.ollama.reachable ? `${health.ollama.response_time_ms}ms` : null}
          isError={!health.ollama.reachable}
        />
        <HealthRow label="LLM Model" value={health.ollama.active_model || health.providers.llm_model} />
        <HealthRow label="Voice" value={health.providers.active_voice} />
        <HealthRow label="Ears (Whisper)" value={health.providers.stt_model} />
        <HealthRow 
          label="Memories" 
          value={`${health.memory.fact_count} facts · ${health.memory.habit_count} habits`} 
        />
        <HealthRow 
          label="Push Alerts" 
          value={health.push_notifications_enabled ? 'Enabled' : 'Disabled'} 
        />
        <HealthRow 
          label="Last Briefing" 
          value={formatLastBriefing(health.last_briefing)} 
        />
        <HealthRow 
          label="Uptime" 
          value={`${Math.floor(health.uptime_seconds / 3600)}h ${Math.floor((health.uptime_seconds % 3600) / 60)}m`} 
        />
      </div>

      <style>{`
        .health-row-label {
          font-size: 0.7rem;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 2px;
        }
        .health-row-value {
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--md-on-surface);
        }
        .health-row-sub {
          font-size: 0.7rem;
          color: var(--text-dim);
          margin-left: 6px;
          font-weight: 400;
        }
      `}</style>
    </div>
  )
}

const HealthRow = ({ label, value, subValue, isError }) => (
  <div className="health-row">
    <div className="health-row-label">{label}</div>
    <div className="health-row-value" style={{ color: isError ? 'var(--error)' : 'inherit' }}>
      {value}
      {subValue && <span className="health-row-sub">[{subValue}]</span>}
    </div>
  </div>
)

export default HealthCard
