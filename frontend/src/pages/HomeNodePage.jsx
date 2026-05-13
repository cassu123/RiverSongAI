import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import './HomeNodePage.css'

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

export default function HomeNodePage() {
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

  return (
    <div className="page-wrap home-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>HOME</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>NODE CONTROL</span>
          </div>
          <h1 className="page-title">Home Node</h1>
          <div className="page-subtitle">
            <span
              className="page-subtitle-dot"
              style={{ background: loading ? undefined : status?.reachable ? 'var(--secondary)' : 'var(--warn)' }}
            />
            {loading ? 'Connecting…' : status?.reachable ? `${devices.length} entities · Home Assistant` : 'Home Assistant not reachable'}
          </div>
        </div>
        {status?.reachable && (
          <div className="page-header-actions">
            <button className="btn" onClick={() => fetchAll()}>↺ REFRESH</button>
          </div>
        )}
      </div>

      {/* Not configured state */}
      {!loading && !status?.configured && (
        <div className="card home-setup-card">
          <div className="card-title">HOME ASSISTANT NOT CONFIGURED</div>
          <p className="home-setup-desc">
            Add your Home Assistant URL and long-lived access token to <code>.env</code> to enable device control.
          </p>
          <div className="home-setup-steps">
            <div className="home-setup-step">
              <span className="home-setup-num">01</span>
              <span>Open Home Assistant → Profile → Security → Long-lived access tokens → Create token</span>
            </div>
            <div className="home-setup-step">
              <span className="home-setup-num">02</span>
              <span>Add to your <code>.env</code>:</span>
            </div>
            <div className="home-setup-code">
              <code>HOME_ASSISTANT_URL=http://homeassistant.local:8123</code>
              <code>HOME_ASSISTANT_TOKEN=your_token_here</code>
            </div>
            <div className="home-setup-step">
              <span className="home-setup-num">03</span>
              <span>Restart the server and return to this page.</span>
            </div>
          </div>
        </div>
      )}

      {/* Configured but not reachable */}
      {!loading && status?.configured && !status?.reachable && (
        <div className="card home-unreachable-card">
          <div className="card-title">UNREACHABLE</div>
          <p className="home-setup-desc">
            Home Assistant is configured at <code>{status.url}</code> but is not responding.
            Make sure HA is running and the URL is correct, then refresh.
          </p>
          <button className="btn" onClick={() => fetchAll()}>↺ RETRY</button>
        </div>
      )}

      {/* Connected — device grid */}
      {!loading && status?.reachable && (
        <>
          {/* Scenes quick-launch strip */}
          {scenes.length > 0 && (
            <div className="home-scenes-strip">
              {scenes.map(s => (
                <button 
                  key={s.entity_id} 
                  className={`home-scene-pill ${acting === s.entity_id ? 'home-scene-pill--busy' : ''}`}
                  onClick={() => callAction(s.entity_id, 'turn_on')}
                  disabled={acting === s.entity_id}
                >
                  {DOMAIN_ICON[s.domain]} {s.name}
                </button>
              ))}
            </div>
          )}

          {/* Domain filter */}
          {domains.length > 1 && (
            <div className="home-filter-row">
              <button
                className={`home-filter-btn ${filter === 'all' ? 'home-filter-btn--on' : ''}`}
                onClick={() => setFilter('all')}
              >
                ALL
              </button>
              {domains.map(d => (
                <button
                  key={d}
                  className={`home-filter-btn ${filter === d ? 'home-filter-btn--on' : ''}`}
                  onClick={() => setFilter(d)}
                >
                  {(DOMAIN_LABEL[d] || d).toUpperCase()}S
                </button>
              ))}
            </div>
          )}

          {/* Groups */}
          {Object.entries(groups).map(([domain, devs]) => (
            <div key={domain} className="home-group">
              <div className="home-group-title">
                <span className="home-group-icon">{DOMAIN_ICON[domain] || '◦'}</span>
                {(DOMAIN_LABEL[domain] || domain).toUpperCase()}S
              </div>
              <div className="home-device-grid">
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
            <div className="card home-empty">
              <span className="home-empty-text">No devices in this category.</span>
            </div>
          )}
        </>
      )}
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
    <div className={`card home-device-card ${on ? 'home-device-card--on' : ''} ${busy ? 'home-device-card--busy' : ''}`}>
      <div className="home-device-icon">{DOMAIN_ICON[device.domain] || '◦'}</div>
      <div className="home-device-name">{device.name}</div>
      
      {isClimate && (
        <div className="home-climate-row">
          <div className="home-climate-info">
            <span>{device.current_temp != null ? `${device.current_temp}°` : '--'}</span>
            <span>Target: {device.temperature != null ? `${device.temperature}°` : '--'}</span>
          </div>
          <div className="home-climate-target">
            <div className="home-climate-btns">
              <button className="home-climate-btn" onClick={() => handleTempAdjust(-0.5)} disabled={busy}>−</button>
              <button className="home-climate-btn" onClick={() => handleTempAdjust(0.5)} disabled={busy}>+</button>
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--md-primary)', fontWeight: 600 }}>{device.state.toUpperCase()}</span>
          </div>
        </div>
      )}

      {isLight && on && (
        <div className="home-brightness-row">
          <input 
            type="range" 
            className="home-brightness-slider" 
            min="1" max="100" 
            value={localBrightness} 
            onChange={handleBrightnessChange}
            disabled={busy}
          />
          <span className="home-brightness-label">{localBrightness}%</span>
        </div>
      )}

      {!isClimate && !isLight && (
        <div className="home-device-meta">
          {on ? device.state.toUpperCase() : 'OFF'}
        </div>
      )}

      <button
        className={`home-device-btn ${on ? 'home-device-btn--on' : ''}`}
        onClick={handleToggle}
        disabled={busy}
      >
        {busy ? '…' : isLock ? (on ? 'LOCK' : 'UNLOCK') : isCover ? (on ? 'CLOSE' : 'OPEN') : (on ? 'ON' : 'OFF')}
      </button>
    </div>
  )
}
