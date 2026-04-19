import React, { useState, useEffect, useCallback } from 'react'
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
  return ['on', 'open', 'unlocked', 'home', 'playing', 'active'].includes(device.state)
}

function groupByDomain(devices) {
  const groups = {}
  for (const d of devices) {
    if (!groups[d.domain]) groups[d.domain] = []
    groups[d.domain].push(d)
  }
  return groups
}

export default function HomeNodePage() {
  const [status,  setStatus]  = useState(null)   // { configured, reachable, url }
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)   // entity_id currently being acted on
  const [filter,  setFilter]  = useState('all')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const st = await fetch('/api/home/status').then(r => r.json())
      setStatus(st)
      if (st.configured && st.reachable) {
        const devs = await fetch('/api/home/devices').then(r => r.json())
        setDevices(Array.isArray(devs) ? devs : [])
      }
    } catch {
      setStatus({ configured: false, reachable: false, url: '' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const callAction = async (entity_id, action, extra = {}) => {
    setActing(entity_id)
    try {
      await fetch('/api/home/action', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ entity_id, action, ...extra }),
      })
      // Optimistic state flip
      setDevices(prev => prev.map(d => {
        if (d.entity_id !== entity_id) return d
        const newState = action === 'turn_on' ? 'on' : action === 'turn_off' ? 'off' : (isOn(d) ? 'off' : 'on')
        return { ...d, state: newState }
      }))
    } finally {
      setActing(null)
    }
  }

  const domains = [...new Set(devices.map(d => d.domain))].sort()
  const filteredDevices = filter === 'all' ? devices : devices.filter(d => d.domain === filter)
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
            <button className="btn" onClick={fetchAll}>↺ REFRESH</button>
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
          <button className="btn" onClick={fetchAll}>↺ RETRY</button>
        </div>
      )}

      {/* Connected — device grid */}
      {!loading && status?.reachable && (
        <>
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
  const isScene  = device.domain === 'scene' || device.domain === 'script'
  const isLock   = device.domain === 'lock'
  const isCover  = device.domain === 'cover'
  const isClimate = device.domain === 'climate'

  const handleToggle = () => {
    if (isScene)  return onAction(device.entity_id, 'turn_on')
    if (isLock)   return onAction(device.entity_id, on ? 'lock' : 'unlock')
    if (isCover)  return onAction(device.entity_id, on ? 'close' : 'open')
    return onAction(device.entity_id, on ? 'turn_off' : 'turn_on')
  }

  return (
    <div className={`card home-device-card ${on ? 'home-device-card--on' : ''} ${busy ? 'home-device-card--busy' : ''}`}>
      <div className="home-device-icon">{DOMAIN_ICON[device.domain] || '◦'}</div>
      <div className="home-device-name">{device.name}</div>
      {isClimate && device.current_temp != null && (
        <div className="home-device-meta">{device.current_temp}°</div>
      )}
      {device.domain === 'light' && on && device.brightness != null && (
        <div className="home-device-meta">{Math.round(device.brightness / 255 * 100)}%</div>
      )}
      <button
        className={`home-device-btn ${on ? 'home-device-btn--on' : ''}`}
        onClick={handleToggle}
        disabled={busy}
      >
        {busy ? '…' : isScene ? 'RUN' : isLock ? (on ? 'LOCK' : 'UNLOCK') : isCover ? (on ? 'CLOSE' : 'OPEN') : (on ? 'ON' : 'OFF')}
      </button>
    </div>
  )
}
