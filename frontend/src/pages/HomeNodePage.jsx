import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'

const DOMAIN_ICON = {
  light:         '◎',
  switch:        '◉',
  fan:           '◈',
  cover:         '▣',
  lock:          '◆',
  climate:       '◇',
  scene:         '★',
  script:        '▶',
  input_boolean: '◉',
}

const DOMAIN_LABEL = {
  light: 'Light', switch: 'Switch', fan: 'Fan', cover: 'Cover',
  lock: 'Lock', climate: 'Climate', scene: 'Scene', script: 'Script',
  input_boolean: 'Toggle',
}

function isOn(device) {
  return ['on', 'open', 'unlocked', 'home', 'playing', 'active', 'heat', 'cool', 'fan_only', 'dry'].includes(device.state)
}

function groupByDomain(devices) {
  const groups = {}
  for (const d of devices) {
    if (['scene', 'script'].includes(d.domain)) continue // Handled by quick strip
    if (!groups[d.domain]) groups[d.domain] = []
    groups[d.domain].push(d)
  }
  return groups
}

export default function HomeNodePage({ setAction }) {
  const { token } = useAuth()
  const [status,  setStatus]  = useState(null)   // { configured, reachable, url }
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)   // entity_id currently being acted on
  const [filter,  setFilter]  = useState('all')

  const fetchAll = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    const headers = { Authorization: `Bearer ${token}` }
    try {
      const st = await fetch('/api/home/status', { headers }).then(r => r.json())
      setStatus(st)
      if (st.configured && st.reachable) {
        const devs = await fetch('/api/home/devices', { headers }).then(r => r.json())
        setDevices(Array.isArray(devs) ? devs : [])
      }
    } catch {
      setStatus({ configured: false, reachable: false, url: '' })
    } finally {
      if (!isSilent) setLoading(false)
    }
  }, [token])

  useEffect(() => { 
    if (token) fetchAll() 
  }, [token, fetchAll])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!status?.reachable || !token) return
    const id = setInterval(() => fetchAll(true), 30000)
    return () => clearInterval(id)
  }, [status?.reachable, token, fetchAll])

  const callAction = async (entity_id, action, extra = {}) => {
    setActing(entity_id)
    try {
      await fetch('/api/home/action', {
        method:  'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body:    JSON.stringify({ entity_id, action, ...extra }),
      })
      
      // Optimistic state flip for simple toggles
      if (['turn_on', 'turn_off', 'lock', 'unlock', 'open', 'close'].includes(action)) {
        setDevices(prev => prev.map(d => {
          if (d.entity_id !== entity_id) return d
          let newState = d.state
          if (action === 'turn_on') newState = 'on'
          else if (action === 'turn_off') newState = 'off'
          else if (action === 'lock') newState = 'locked'
          else if (action === 'unlock') newState = 'unlocked'
          else if (action === 'open') newState = 'open'
          else if (action === 'close') newState = 'closed'
          return { ...d, state: newState, ...extra }
        }))
      } else if (action === 'set_temperature' || action === 'set_brightness') {
         // Just update the attributes optimistically
         setDevices(prev => prev.map(d => d.entity_id === entity_id ? { ...d, ...extra } : d))
      }
    } finally {
      setActing(null)
    }
  }

  const domains = [...new Set(devices.filter(d => !['scene', 'script'].includes(d.domain)).map(d => d.domain))].sort()
  const scenes  = devices.filter(d => ['scene', 'script'].includes(d.domain))
  
  const filteredDevices = filter === 'all' 
    ? devices.filter(d => !['scene', 'script'].includes(d.domain)) 
    : devices.filter(d => d.domain === filter)
  const groups = groupByDomain(filteredDevices)

  const ActionSlot = useMemo(() => (
    <div className="rs-input-bar">
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, width: '100%', alignItems: 'center' }}>
        <button 
          className={`rs-pill ${filter === 'all' ? 'is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          ALL
        </button>
        {domains.map(d => (
          <button
            key={d}
            className={`rs-pill ${filter === d ? 'is-active' : ''}`}
            onClick={() => setFilter(d)}
          >
            {(DOMAIN_LABEL[d] || d).toUpperCase()}S
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="rs-pill" onClick={() => fetchAll()}>
          <span className="material-symbols-rounded">refresh</span>
        </button>
      </div>
    </div>
  ), [domains, filter, fetchAll])

  useEffect(() => {
    if (setAction && status?.reachable) setAction(ActionSlot)
    return () => { if (setAction) setAction(null) }
  }, [ActionSlot, setAction, status?.reachable])

  return (
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-card-label">HOME / NODE CONTROL</div>
        <h1 className="rs-greeting">Home Node</h1>
        <div className="rs-status-strip">
          <span
            className="rs-status-dot"
            style={{ background: loading ? undefined : status?.reachable ? 'var(--secondary)' : 'var(--warn)' }}
          />
          <span>{loading ? 'CONNECTING…' : status?.reachable ? `${devices.length} ENTITIES · HOME ASSISTANT` : 'HOME ASSISTANT NOT REACHABLE'}</span>
        </div>
      </header>

      <div className="rs-card-flow">
        {/* Not configured state */}
        {!loading && !status?.configured && (
          <div className="rs-card is-wide" style={{ backdropFilter: 'var(--glass-blur)' }}>
            <div className="rs-card-head">
               <span className="rs-card-label">HOME ASSISTANT NOT CONFIGURED</span>
            </div>
            <p className="rs-card-meta">
              Add your Home Assistant URL and long-lived access token to <code>.env</code> to enable device control.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>01</span>
                <span>Open Home Assistant → Profile → Security → Long-lived access tokens → Create token</span>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>02</span>
                <span>Add to your <code>.env</code>:</span>
              </div>
              <div style={{ 
                padding: '12px 16px', 
                background: 'rgba(0,0,0,0.2)', 
                borderRadius: 'var(--md-shape-xl)', 
                fontFamily: 'var(--font-mono)', 
                fontSize: '0.75rem',
                color: 'var(--secondary)'
              }}>
                <div>HOME_ASSISTANT_URL=http://homeassistant.local:8123</div>
                <div>HOME_ASSISTANT_TOKEN=your_token_here</div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>03</span>
                <span>Restart the server and return to this page.</span>
              </div>
            </div>
          </div>
        )}

        {/* Configured but not reachable */}
        {!loading && status?.configured && !status?.reachable && (
          <div className="rs-card is-wide" style={{ backdropFilter: 'var(--glass-blur)' }}>
            <div className="rs-card-head">
               <span className="rs-card-label">UNREACHABLE</span>
            </div>
            <p className="rs-card-meta">
              Home Assistant is configured at <code>{status.url}</code> but is not responding.
              Make sure HA is running and the URL is correct, then refresh.
            </p>
            <button className="rs-btn-primary" style={{ marginTop: 16 }} onClick={() => fetchAll()}>↺ RETRY</button>
          </div>
        )}

        {/* Connected — device grid */}
        {!loading && status?.reachable && (
          <>
            {/* Scenes quick-launch strip */}
            {scenes.length > 0 && (
              <div style={{ 
                display: 'flex', 
                gap: 8, 
                overflowX: 'auto', 
                paddingBottom: 8, 
                width: '100%',
                scrollbarWidth: 'none'
              }}>
                {scenes.map(s => (
                  <button 
                    key={s.entity_id} 
                    className={`rs-pill ${acting === s.entity_id ? 'is-active' : ''}`}
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => callAction(s.entity_id, 'turn_on')}
                    disabled={acting === s.entity_id}
                  >
                    {DOMAIN_ICON[s.domain]} {s.name.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {/* Groups */}
            {Object.entries(groups).map(([domain, devs]) => (
              <div key={domain} style={{ width: '100%' }}>
                <div className="rs-card-label" style={{ marginBottom: 12, marginLeft: 12 }}>
                  <span style={{ marginRight: 8 }}>{DOMAIN_ICON[domain] || '◦'}</span>
                  {(DOMAIN_LABEL[domain] || domain).toUpperCase()}S
                </div>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', 
                  gap: 12,
                  width: '100%'
                }}>
                  {devs.map(d => (
                    <DeviceCard
                      key={d.entity_id}
                      device={d}
                      busy={acting === d.entity_id}
                      onAction={callAction}
                    />
                  ))}
                </div>
              </div>
            ))}

            {filteredDevices.length === 0 && (
              <div className="rs-card is-wide" style={{ textAlign: 'center', opacity: 0.5 }}>
                <span className="rs-card-meta">No devices in this category.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DeviceCard({ device, busy, onAction }) {
  const on = isOn(device)
  const isLock   = device.domain === 'lock'
  const isCover  = device.domain === 'cover'
  const isClimate = device.domain === 'climate'
  const isLight = device.domain === 'light'

  const [localBrightness, setLocalBrightness] = useState(
    Math.round((device.brightness ?? 255) / 255 * 100)
  )
  const brightTimer = useRef(null)

  // Keep local brightness in sync with external updates if not currently dragging
  useEffect(() => {
    if (!brightTimer.current) {
      setLocalBrightness(Math.round((device.brightness ?? 255) / 255 * 100))
    }
  }, [device.brightness])

  const handleToggle = () => {
    if (isLock)   return onAction(device.entity_id, on ? 'lock' : 'unlock')
    if (isCover)  return onAction(device.entity_id, on ? 'close' : 'open')
    return onAction(device.entity_id, on ? 'turn_off' : 'turn_on')
  }

  const handleBrightnessChange = (e) => {
    const val = parseInt(e.target.value)
    setLocalBrightness(val)
    if (brightTimer.current) clearTimeout(brightTimer.current)
    brightTimer.current = setTimeout(() => {
      onAction(device.entity_id, 'turn_on', { brightness_pct: val })
      brightTimer.current = null
    }, 400)
  }

  const handleTempAdjust = (delta) => {
    const currentTarget = device.temperature || 20
    const next = parseFloat((currentTarget + delta).toFixed(1))
    onAction(device.entity_id, 'set_temperature', { temperature: next })
  }

  return (
    <div 
      className="rs-card" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        gap: 8, 
        textAlign: 'center',
        opacity: busy ? 0.6 : 1,
        border: on ? '1px solid color-mix(in srgb, var(--secondary) 30%, transparent)' : undefined,
        background: on ? 'color-mix(in srgb, var(--secondary) 5%, var(--rs-card-bg))' : undefined,
        backdropFilter: 'var(--glass-blur)',
        padding: '16px 12px'
      }}
    >
      <div style={{ fontSize: '1.4rem', color: on ? 'var(--secondary)' : 'var(--text-muted)', lineHeight: 1 }}>
        {DOMAIN_ICON[device.domain] || '◦'}
      </div>
      <div style={{ fontSize: '0.85rem', fontWeight: 500, lineHeight: 1.3 }}>{device.name}</div>
      
      {isClimate && (
        <div style={{ 
          width: '100%', 
          marginTop: 4, 
          padding: 8, 
          background: 'rgba(0, 0, 0, 0.2)', 
          borderRadius: 'var(--md-shape-xl)',
          fontSize: '0.75rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, marginBottom: 8 }}>
            <span>{device.current_temp != null ? `${device.current_temp}°` : '--'}</span>
            <span>Target: {device.temperature != null ? `${device.temperature}°` : '--'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button 
                className="rs-pill" 
                style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }} 
                onClick={() => handleTempAdjust(-0.5)} 
                disabled={busy}
              >
                −
              </button>
              <button 
                className="rs-pill" 
                style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }} 
                onClick={() => handleTempAdjust(0.5)} 
                disabled={busy}
              >
                +
              </button>
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--md-primary)', fontWeight: 600 }}>{device.state.toUpperCase()}</span>
          </div>
        </div>
      )}

      {isLight && on && (
        <div style={{ width: '100%', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input 
            type="range" 
            style={{ flex: 1, height: 4, accentColor: 'var(--md-primary)' }} 
            min="1" max="100" 
            value={localBrightness} 
            onChange={handleBrightnessChange}
            disabled={busy}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', opacity: 0.7 }}>{localBrightness}%</span>
        </div>
      )}

      {!isClimate && !isLight && (
        <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
          {on ? device.state.toUpperCase() : 'OFF'}
        </div>
      )}

      <button
        className={on ? 'rs-pill is-active' : 'rs-pill'}
        style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
        onClick={handleToggle}
        disabled={busy}
      >
        {busy ? '…' : isLock ? (on ? 'LOCK' : 'UNLOCK') : isCover ? (on ? 'CLOSE' : 'OPEN') : (on ? 'ON' : 'OFF')}
      </button>
    </div>
  )
}
