import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@context/AuthContext'
import SafetyRules from '@components/SafetyRules.jsx'

const READONLY = new Set(['sensor', 'binary_sensor'])
const LAUNCHERS = new Set(['scene', 'script'])

const ON_STATES = ['on', 'open', 'unlocked', 'playing', 'active',
                   'heat', 'cool', 'fan_only', 'dry', 'auto']

function isOn(d) {
  return ON_STATES.includes(String(d.state))
}

const UNASSIGNED = 'Unassigned'

function toggleFor(device, on) {
  switch (device.domain) {
    case 'lock':  return on ? 'lock' : 'unlock'
    case 'cover': return on ? 'close_cover' : 'open_cover'
    default:      return on ? 'turn_off' : 'turn_on'
  }
}

function toggleLabel(device, on) {
  switch (device.domain) {
    case 'lock':  return on ? 'LOCK' : 'UNLOCK'
    case 'cover': return on ? 'CLOSE' : 'OPEN'
    default:      return on ? 'ON' : 'OFF'
  }
}

function binaryLabel(d) {
  const on = String(d.state) === 'on'
  switch (d.device_class) {
    case 'door': case 'garage_door': case 'window': case 'opening':
      return on ? 'OPEN' : 'CLOSED'
    case 'moisture': return on ? 'WET' : 'DRY'
    case 'smoke': case 'gas': case 'carbon_monoxide':
      return on ? 'DETECTED' : 'CLEAR'
    case 'motion': case 'occupancy': return on ? 'MOTION' : 'CLEAR'
    case 'lock': return on ? 'UNLOCKED' : 'LOCKED'
    case 'battery': return on ? 'LOW' : 'OK'
    default: return on ? 'ON' : 'OFF'
  }
}

function isAlarming(d) {
  if (String(d.state) !== 'on') return false
  return ['moisture', 'smoke', 'gas', 'carbon_monoxide', 'safety', 'problem']
    .includes(d.device_class)
}

function getMaterialIcon(domain, device_class, state) {
  const on = ON_STATES.includes(String(state))
  switch (domain) {
    case 'light':
      return on ? 'lightbulb' : 'lightbulb_outline'
    case 'switch':
    case 'input_boolean':
      return 'power_settings_new'
    case 'climate':
      return 'thermostat'
    case 'lock':
      return on ? 'lock' : 'lock_open'
    case 'cover':
      return device_class === 'garage' ? 'garage' : 'blinds'
    case 'fan':
      return 'mode_fan'
    case 'media_player':
      return 'speaker'
    case 'scene':
      return 'auto_awesome'
    case 'script':
      return 'play_arrow'
    case 'binary_sensor':
      if (device_class === 'door' || device_class === 'garage_door') return on ? 'door_open' : 'door_front'
      if (device_class === 'window') return 'window'
      if (device_class === 'motion' || device_class === 'occupancy') return 'motion_sensor_active'
      if (device_class === 'moisture') return 'water_damage'
      if (device_class === 'smoke' || device_class === 'gas') return 'detector_smoke'
      return 'sensors'
    case 'sensor':
      if (device_class === 'temperature') return 'device_thermostat'
      if (device_class === 'humidity') return 'humidity_mid'
      if (device_class === 'battery') return 'battery_full'
      return 'sensors'
    default:
      return 'devices'
  }
}

export default function HomeNodePage({ setAction }) {
  const { token } = useAuth()
  const [status,  setStatus]  = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)
  const [filter,  setFilter]  = useState('all')
  const [syncing, setSyncing] = useState(false)

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

  useEffect(() => { if (token) fetchAll() }, [token, fetchAll])

  // Clear external actionSlot to keep header clean
  useEffect(() => {
    if (setAction) setAction(null)
  }, [setAction])

  // Live updates via SSE
  useEffect(() => {
    if (!status?.reachable || !token) return
    const es = new EventSource('/api/home/stream', { withCredentials: true })
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (!msg.entity_id) return
        setDevices(prev => prev.map(d => d.entity_id === msg.entity_id
          ? { ...d, ...(msg.device || {}), state: msg.state ?? d.state }
          : d))
      } catch { /* ignore malformed frames */ }
    }
    return () => es.close()
  }, [status?.reachable, token])

  // Fallback poll
  useEffect(() => {
    if (!status?.reachable || !token) return
    const id = setInterval(() => fetchAll(true), 300000)
    return () => clearInterval(id)
  }, [status?.reachable, token, fetchAll])

  const callAction = useCallback(async (entity_id, action, extra = {}) => {
    setActing(entity_id)
    const optimistic = {
      turn_on: 'on', turn_off: 'off', lock: 'locked', unlock: 'unlocked',
      open_cover: 'open', close_cover: 'closed',
      media_play: 'playing', media_pause: 'paused',
    }[action]
    if (optimistic) {
      setDevices(prev => prev.map(d => d.entity_id === entity_id
        ? { ...d, state: optimistic, ...extra } : d))
    } else if (Object.keys(extra).length) {
      setDevices(prev => prev.map(d => d.entity_id === entity_id
        ? { ...d, ...extra } : d))
    }
    try {
      const res = await fetch('/api/home/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id, action, ...extra }),
      })
      let ok = res.ok
      if (ok) {
        const body = await res.json().catch(() => ({}))
        if (body && body.ok === false) ok = false
      }
      if (!ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      await fetchAll(true)
    } finally {
      setActing(null)
    }
  }, [token, fetchAll])

  const runSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/home/sync', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      })
      await fetchAll(true)
    } finally { setSyncing(false) }
  }, [token, fetchAll])

  const scenes   = useMemo(() => devices.filter(d => LAUNCHERS.has(d.domain)), [devices])
  const operable = useMemo(() => devices.filter(d => !LAUNCHERS.has(d.domain)), [devices])

  // Filter metrics
  const lights = useMemo(() => operable.filter(d => d.domain === 'light'), [operable])
  const lightsOnCount = useMemo(() => lights.filter(d => isOn(d)).length, [lights])
  const climateDevices = useMemo(() => operable.filter(d => d.domain === 'climate'), [operable])
  const securityDevices = useMemo(() => operable.filter(d =>
    d.domain === 'lock' || d.domain === 'cover' ||
    (d.domain === 'binary_sensor' && ['door', 'garage_door', 'window', 'lock', 'motion'].includes(d.device_class))
  ), [operable])

  // Rooms partition
  const rooms = useMemo(() => {
    const byRoom = {}
    for (const d of operable) {
      const key = d.area || UNASSIGNED
      ;(byRoom[key] ||= []).push(d)
    }
    const names = Object.keys(byRoom).sort((a, b) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b))
    return names.map(name => ({ name, devices: byRoom[name] }))
  }, [operable])

  // Glance summary string
  const glanceSummary = useMemo(() => {
    if (operable.length === 0) return 'No devices connected yet'
    const parts = []
    if (lightsOnCount > 0) {
      parts.push(`${lightsOnCount} ${lightsOnCount === 1 ? 'light' : 'lights'} on`)
    } else if (lights.length > 0) {
      parts.push('All lights off')
    }

    const firstClimate = climateDevices[0]
    if (firstClimate) {
      const target = firstClimate.temperature || firstClimate.current_temp
      const mode = String(firstClimate.state).toLowerCase()
      parts.push(`Climate ${mode} at ${target ? `${target}°` : ''}`)
    }

    const unlocked = operable.filter(d => d.domain === 'lock' && String(d.state) === 'unlocked')
    if (unlocked.length > 0) {
      parts.push(`${unlocked.length} unlocked`)
    } else if (operable.some(d => d.domain === 'lock')) {
      parts.push('All doors locked')
    }

    return parts.length > 0 ? parts.join(' · ') : `${operable.length} devices connected`
  }, [operable, lightsOnCount, lights.length, climateDevices])

  // Attention alerts
  const attention = useMemo(() => {
    const items = []
    for (const d of operable) {
      if (d.domain === 'lock' && String(d.state) === 'unlocked')
        items.push({ id: d.entity_id, domain: 'lock', tone: 'warn', text: `${d.name} unlocked` })
      else if (d.domain === 'cover' && String(d.state) === 'open')
        items.push({ id: d.entity_id, domain: 'cover', tone: 'warn', text: `${d.name} open` })
      else if (d.domain === 'binary_sensor' && isAlarming(d))
        items.push({ id: d.entity_id, domain: 'binary_sensor', tone: 'critical', text: `${d.name}: ${binaryLabel(d)}` })
    }
    return items.sort((a, b) => (a.tone === 'critical' ? -1 : 1))
  }, [operable])

  return (
    <div className="rs-canvas animate-fade-in" style={{ padding: '24px 20px 80px 20px', maxWidth: 1280, margin: '0 auto' }}>
      {/* ── 1. Google Home Living Glance Bar ── */}
      <div className="gh-glance-bar">
        <div className="gh-glance-left">
          <div className="gh-glance-orb-wrap">
            <span className="material-symbols-rounded" style={{ color: 'var(--md-primary)', fontSize: 22 }}>
              {status?.reachable ? 'home' : 'cloud_off'}
            </span>
          </div>
          <div className="gh-glance-text">
            <div className="gh-glance-title">
              {loading ? 'Connecting to River Song…' : status?.reachable ? 'River Song Home' : 'Home Assistant Disconnected'}
            </div>
            <div className="gh-glance-sub">{glanceSummary}</div>
          </div>
        </div>
        {status?.reachable && (
          <button
            className="gh-glance-action"
            onClick={runSync}
            disabled={syncing}
            title="Sync entity states and rooms from Home Assistant"
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 18,
                animation: syncing ? 'spin 1s linear infinite' : 'none'
              }}
            >
              sync
            </span>
            <span>{syncing ? 'Syncing…' : 'Sync'}</span>
          </button>
        )}
      </div>

      {/* ── 2. Needs Attention Banner (if any alerts) ── */}
      {status?.reachable && attention.length > 0 && (
        <div className="gh-attention-banner animate-fade-in">
          <div className="gh-attention-title">
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>warning</span>
            <span>Needs Attention ({attention.length})</span>
          </div>
          <div className="gh-attention-items">
            {attention.map(a => (
              <button
                key={a.id}
                className={`gh-attention-chip ${a.tone === 'critical' ? 'is-critical' : ''}`}
                onClick={() => {
                  if (a.domain === 'lock') callAction(a.id, 'lock')
                  if (a.domain === 'cover') callAction(a.id, 'close_cover')
                }}
                title={a.domain === 'lock' ? 'Tap to Lock' : a.domain === 'cover' ? 'Tap to Close' : ''}
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                  {a.domain === 'lock' ? 'lock' : a.domain === 'cover' ? 'garage' : 'error'}
                </span>
                <span>{a.text}</span>
                {(a.domain === 'lock' || a.domain === 'cover') && (
                  <span className="rs-type-micro" style={{ opacity: 0.9, textDecoration: 'underline', marginLeft: 'var(--rs-space-1)' }}>
                    Secure
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 3. Quick Automations & Scenes ── */}
      {status?.reachable && scenes.length > 0 && (
        <div className="gh-scenes-row">
          {scenes.map(s => (
            <button
              key={s.entity_id}
              className="gh-scene-chip"
              onClick={() => callAction(s.entity_id, 'turn_on')}
              disabled={acting === s.entity_id}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18, color: 'var(--md-primary)' }}>
                auto_awesome
              </span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── 4. Material 3 Category & Room Filter Chips ── */}
      {status?.reachable && (
        <div className="gh-chips-bar">
          <button
            className={`gh-chip ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <span className="material-symbols-rounded gh-chip-icon">grid_view</span>
            <span>All Devices</span>
          </button>
          {lights.length > 0 && (
            <button
              className={`gh-chip ${filter === 'lights' ? 'is-active' : ''}`}
              onClick={() => setFilter('lights')}
            >
              <span className="material-symbols-rounded gh-chip-icon">lightbulb</span>
              <span>Lights ({lightsOnCount} on)</span>
            </button>
          )}
          {climateDevices.length > 0 && (
            <button
              className={`gh-chip ${filter === 'climate' ? 'is-active' : ''}`}
              onClick={() => setFilter('climate')}
            >
              <span className="material-symbols-rounded gh-chip-icon">thermostat</span>
              <span>Climate</span>
            </button>
          )}
          {securityDevices.length > 0 && (
            <button
              className={`gh-chip ${filter === 'security' ? 'is-active' : ''}`}
              onClick={() => setFilter('security')}
            >
              <span className="material-symbols-rounded gh-chip-icon">lock</span>
              <span>Security</span>
            </button>
          )}
          {rooms.map(r => (
            <button
              key={r.name}
              className={`gh-chip ${filter === r.name ? 'is-active' : ''}`}
              onClick={() => setFilter(r.name)}
            >
              <span>{r.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── 5. Main Canvas / States ── */}
      {!loading && !status?.configured && <NotConfigured />}

      {!loading && status?.configured && !status?.reachable && (
        <div className="rs-card is-wide animate-fade-in rs-p-5 rs-text-center">
          <span className="material-symbols-rounded rs-mb-3" style={{ fontSize: 48, color: 'var(--warn)' }}>
            cloud_off
          </span>
          <h2 className="rs-mb-2 rs-type-h3" style={{ fontWeight: 600, color: 'var(--fg)' }}>
            Home Assistant Unreachable
          </h2>
          <p className="rs-card-meta" style={{ maxWidth: 440, margin: '0 auto 20px auto' }}>
            River Song cannot connect to Home Assistant. Verify that your Home Assistant server is running and the configured URL is accessible.
          </p>
          <button className="rs-btn-primary" onClick={() => fetchAll()}>
            <span className="material-symbols-rounded" style={{ fontSize: 18, marginRight: 'var(--rs-space-2)' }}>refresh</span>
            RETRY CONNECTION
          </button>
        </div>
      )}

      {/* ── 6. Filtered View / Device Grid ── */}
      {!loading && status?.reachable && (
        <>
          {filter === 'all' && (
            // Room-by-room hierarchy (Google Home standard view)
            rooms.map(r => (
              <RoomSection
                key={r.name}
                room={r}
                acting={acting}
                onAction={callAction}
              />
            ))
          )}

          {filter === 'lights' && (
            <div className="gh-grid animate-fade-in">
              {lights.map(d => (
                <LightTile key={d.entity_id} device={d} busy={acting === d.entity_id} onAction={callAction} />
              ))}
            </div>
          )}

          {filter === 'climate' && (
            <div className="gh-grid animate-fade-in">
              {climateDevices.map(d => (
                <ClimateTile key={d.entity_id} device={d} busy={acting === d.entity_id} onAction={callAction} />
              ))}
            </div>
          )}

          {filter === 'security' && (
            <div className="gh-grid animate-fade-in">
              {securityDevices.map(d => (
                <DeviceTileDispatcher key={d.entity_id} device={d} busy={acting === d.entity_id} onAction={callAction} />
              ))}
            </div>
          )}

          {filter !== 'all' && filter !== 'lights' && filter !== 'climate' && filter !== 'security' && (
            // Specific single room view
            (() => {
              const matchedRoom = rooms.find(r => r.name === filter)
              return matchedRoom ? (
                <RoomSection
                  key={matchedRoom.name}
                  room={matchedRoom}
                  acting={acting}
                  onAction={callAction}
                />
              ) : null
            })()
          )}

          {operable.length === 0 && (
            <div className="rs-card is-wide animate-fade-in rs-text-center rs-p-6">
              <span className="material-symbols-rounded rs-mb-3 rs-muted" style={{ fontSize: 44 }}>
                devices
              </span>
              <p className="rs-card-meta rs-mb-4 rs-type-body" style={{ color: 'var(--fg)' }}>
                No active devices found in Home Assistant.
              </p>
              <button className="gh-glance-action" style={{ margin: '0 auto' }} onClick={runSync} disabled={syncing}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>sync</span>
                <span>Sync Devices Now</span>
              </button>
            </div>
          )}

          {/* Safety Rules Engine Integration */}
          <div className="rs-mt-7">
            <SafetyRules />
          </div>
        </>
      )}
    </div>
  )
}

/** Room Section: Room Title, Room Temperature Badge, Tactile Device Grid, and Ambient Sensor Strip */
function RoomSection({ room, acting, onAction }) {
  const controls = room.devices.filter(d => !READONLY.has(d.domain) && d.domain !== 'media_player')
  const media    = room.devices.filter(d => d.domain === 'media_player')
  const readings = room.devices.filter(d => READONLY.has(d.domain))

  // The room's temperature readout if reported
  const temp = readings.find(d => d.device_class === 'temperature')
            || room.devices.find(d => d.current_temp != null)

  if (controls.length === 0 && media.length === 0 && readings.length === 0) return null

  return (
    <section className="gh-room-section animate-fade-in">
      <div className="gh-room-head">
        <div className="gh-room-head-left">
          <h2 className="gh-room-title">{room.name}</h2>
          {temp && (
            <span className="gh-room-temp">
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>device_thermostat</span>
              <span>{temp.current_temp != null ? `${temp.current_temp}°` : `${temp.state}${temp.unit || '°'}`}</span>
            </span>
          )}
        </div>
        <span className="gh-room-count">{controls.length + media.length} devices</span>
      </div>

      {controls.length > 0 && (
        <div className="gh-grid">
          {controls.map(d => (
            <DeviceTileDispatcher key={d.entity_id} device={d} busy={acting === d.entity_id} onAction={onAction} />
          ))}
        </div>
      )}

      {media.length > 0 && (
        <div className="rs-gap-4 rs-mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {media.map(m => (
            <MediaTile key={m.entity_id} device={m} busy={acting === m.entity_id} onAction={onAction} />
          ))}
        </div>
      )}

      {readings.length > 0 && (
        <div className="gh-sensor-strip">
          {readings.map(s => <SensorPill key={s.entity_id} device={s} />)}
        </div>
      )}
    </section>
  )
}

/** Route device to the specialized tactile Google Home tile */
function DeviceTileDispatcher({ device, busy, onAction }) {
  switch (device.domain) {
    case 'light':
      return <LightTile device={device} busy={busy} onAction={onAction} />
    case 'climate':
      return <ClimateTile device={device} busy={busy} onAction={onAction} />
    case 'lock':
      return <LockTile device={device} busy={busy} onAction={onAction} />
    default:
      return <GenericTile device={device} busy={busy} onAction={onAction} />
  }
}

/** Google Home / Nest Hub Tactile Light Tile with Golden Glow and Dimmer Slider */
function LightTile({ device, busy, onAction }) {
  const on = isOn(device)
  const [bright, setBright] = useState(Math.round((device.brightness ?? 255) / 255 * 100))
  const brightTimer = useRef(null)

  useEffect(() => {
    if (!brightTimer.current && device.brightness != null) {
      setBright(Math.round((device.brightness ?? 255) / 255 * 100))
    }
  }, [device.brightness])

  const onBright = (e) => {
    const val = parseInt(e.target.value, 10)
    setBright(val)
    if (brightTimer.current) clearTimeout(brightTimer.current)
    brightTimer.current = setTimeout(() => {
      onAction(device.entity_id, 'turn_on', { brightness_pct: val })
      brightTimer.current = null
    }, 350)
  }

  const handleToggle = () => {
    onAction(device.entity_id, on ? 'turn_off' : 'turn_on')
  }

  return (
    <div className={`gh-tile ${on ? 'is-light-on' : ''}`} style={{ opacity: busy ? 0.65 : 1 }}>
      <div className="gh-tile-head">
        <div className="gh-tile-icon-wrap" onClick={handleToggle} title="Tap to toggle">
          <span className="material-symbols-rounded">{on ? 'lightbulb' : 'lightbulb_outline'}</span>
        </div>
        <button
          className="gh-tile-toggle-btn"
          onClick={handleToggle}
          disabled={busy}
          aria-label={`Toggle ${device.name}`}
          title={on ? 'Turn Off' : 'Turn On'}
        >
          <span className="material-symbols-rounded">
            {on ? 'power_settings_new' : 'power_off'}
          </span>
        </button>
      </div>

      <div className="gh-tile-body">
        <div className="gh-tile-title">{device.name}</div>
        <div className="gh-tile-status">{on ? `${bright}% Brightness` : 'Off'}</div>
      </div>

      {on && (
        <div className="gh-tile-slider-wrap">
          <input
            type="range"
            min="1"
            max="100"
            value={bright}
            onChange={onBright}
            disabled={busy}
            aria-label={`${device.name} brightness`}
            className="gh-tile-slider"
          />
          <span className="gh-tile-slider-pct">{bright}%</span>
        </div>
      )}
    </div>
  )
}

/** Google Home Tactile Climate Tile with Temperature Bump Buttons */
function ClimateTile({ device, busy, onAction }) {
  const isCooling = String(device.state) === 'cool' || String(device.hvac_action) === 'cooling'
  const isHeating = String(device.state) === 'heat' || String(device.hvac_action) === 'heating'
  const setpoint = device.temperature
  const hasSetpoint = setpoint != null
  const step = hasSetpoint && setpoint > 45 ? 1 : 0.5

  const adjustTemp = (delta) => {
    if (!hasSetpoint) return
    const next = parseFloat((setpoint + delta).toFixed(1))
    onAction(device.entity_id, 'set_temperature', { temperature: next })
  }

  return (
    <div
      className={`gh-tile is-climate ${isCooling ? 'is-cooling' : ''} ${isHeating ? 'is-heating' : ''}`}
      style={{ opacity: busy ? 0.65 : 1 }}
    >
      <div className="gh-tile-head">
        <div className="gh-tile-icon-wrap">
          <span className="material-symbols-rounded">{isCooling ? 'ac_unit' : 'thermostat'}</span>
        </div>
        <span
          className="gh-chip rs-type-micro"
          style={{
            padding: 'var(--rs-space-1) var(--rs-space-3)',
            color: isCooling ? '#96cbff' : isHeating ? '#fed7aa' : 'rgba(255,255,255,0.7)',
            borderColor: isCooling ? 'rgba(0, 229, 255, 0.4)' : isHeating ? 'rgba(251, 146, 60, 0.4)' : undefined,
          }}
        >
          {String(device.state).toUpperCase()}
        </span>
      </div>

      <div className="gh-tile-body">
        <div className="gh-tile-title">{device.name}</div>
        <div className="gh-tile-status">
          {device.current_temp != null ? `Current ${device.current_temp}°` : 'Thermostat'}
        </div>
      </div>

      <div className="gh-climate-ctrls">
        <div className="gh-temp-large">
          {device.temperature != null ? `${device.temperature}°` : device.current_temp != null ? `${device.current_temp}°` : '--'}
        </div>
        <div className="gh-temp-btns">
          <button
            className="gh-temp-step-btn"
            onClick={() => adjustTemp(-step)}
            disabled={busy || !hasSetpoint}
            aria-label="Decrease temperature"
            title="Lower temperature"
          >
            −
          </button>
          <button
            className="gh-temp-step-btn"
            onClick={() => adjustTemp(step)}
            disabled={busy || !hasSetpoint}
            aria-label="Increase temperature"
            title="Raise temperature"
          >
            +
          </button>
        </div>
      </div>
    </div>
  )
}

/** Google Home Tactile Lock Tile with Emerald/Amber Security Aura */
function LockTile({ device, busy, onAction }) {
  const locked = String(device.state) === 'locked'

  const handleToggle = () => {
    onAction(device.entity_id, locked ? 'unlock' : 'lock')
  }

  return (
    <div
      className={`gh-tile ${locked ? 'is-locked' : 'is-unlocked'}`}
      style={{ opacity: busy ? 0.65 : 1 }}
    >
      <div className="gh-tile-head">
        <div className="gh-tile-icon-wrap" onClick={handleToggle} title="Tap to toggle lock">
          <span className="material-symbols-rounded">{locked ? 'lock' : 'lock_open'}</span>
        </div>
        <button
          className="gh-tile-toggle-btn"
          onClick={handleToggle}
          disabled={busy}
          aria-label={`Toggle ${device.name}`}
          title={locked ? 'Unlock' : 'Lock'}
        >
          <span className="material-symbols-rounded">{locked ? 'lock' : 'lock_open'}</span>
        </button>
      </div>

      <div className="gh-tile-body">
        <div className="gh-tile-title">{device.name}</div>
        <div
          className="gh-tile-status"
          style={{ color: locked ? '#34d399' : '#fb923c', fontWeight: 600 }}
        >
          {locked ? 'LOCKED' : 'UNLOCKED'}
        </div>
      </div>
    </div>
  )
}

/** Generic Tactile Tile for Switches, Outlets, Fans, Covers */
function GenericTile({ device, busy, onAction }) {
  const on = isOn(device)
  const icon = getMaterialIcon(device.domain, device.device_class, device.state)

  const handleToggle = () => {
    onAction(device.entity_id, toggleFor(device, on))
  }

  return (
    <div
      className={`gh-tile ${on ? 'is-light-on' : ''}`}
      style={{ opacity: busy ? 0.65 : 1 }}
    >
      <div className="gh-tile-head">
        <div className="gh-tile-icon-wrap" onClick={handleToggle} title="Tap to toggle">
          <span className="material-symbols-rounded">{icon}</span>
        </div>
        <button
          className="gh-tile-toggle-btn"
          onClick={handleToggle}
          disabled={busy}
          aria-label={`Toggle ${device.name}`}
          title={toggleLabel(device, on)}
        >
          <span className="material-symbols-rounded">
            {on ? 'power_settings_new' : 'power_off'}
          </span>
        </button>
      </div>

      <div className="gh-tile-body">
        <div className="gh-tile-title">{device.name}</div>
        <div className="gh-tile-status">
          {toggleLabel(device, on)}
        </div>
      </div>
    </div>
  )
}

/** Google Home Media Player Card */
function MediaTile({ device, busy, onAction }) {
  const playing = String(device.state) === 'playing'
  const [vol, setVol] = useState(Math.round((device.volume_level ?? 0.3) * 100))
  const volTimer = useRef(null)

  useEffect(() => {
    if (!volTimer.current && device.volume_level != null) {
      setVol(Math.round(device.volume_level * 100))
    }
  }, [device.volume_level])

  const onVol = (e) => {
    const v = parseInt(e.target.value, 10)
    setVol(v)
    if (volTimer.current) clearTimeout(volTimer.current)
    volTimer.current = setTimeout(() => {
      onAction(device.entity_id, 'volume_set', { volume_level: v / 100 })
      volTimer.current = null
    }, 400)
  }

  return (
    <div className="gh-media-tile" style={{ opacity: busy ? 0.65 : 1 }}>
      <div className="gh-media-main">
        <div className="gh-media-art">
          <span className="material-symbols-rounded">speaker</span>
        </div>
        <div className="gh-media-info">
          <div className="gh-media-title">{device.name}</div>
          <div className="gh-media-artist">
            {device.media_title || device.app_name || (playing ? 'Playing' : 'Paused')}
          </div>
        </div>
        <button
          className="gh-media-play-btn"
          disabled={busy}
          onClick={() => onAction(device.entity_id, playing ? 'media_pause' : 'media_play')}
          title={playing ? 'Pause' : 'Play'}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 24 }}>
            {playing ? 'pause' : 'play_arrow'}
          </span>
        </button>
      </div>

      <div className="gh-media-vol-row">
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)' }}>
          volume_down
        </span>
        <input
          type="range"
          min="0"
          max="100"
          value={vol}
          onChange={onVol}
          disabled={busy}
          aria-label={`${device.name} volume`}
          className="gh-tile-slider"
        />
        <span className="gh-tile-slider-pct">{vol}%</span>
      </div>
    </div>
  )
}

/** Frosted Sensor Chip */
function SensorPill({ device }) {
  const binary = device.domain === 'binary_sensor'
  const alarming = binary && isAlarming(device)
  const icon = getMaterialIcon(device.domain, device.device_class, device.state)
  const value = binary
    ? binaryLabel(device)
    : `${device.state}${device.unit ? ` ${device.unit}` : ''}`

  return (
    <span className={`gh-sensor-pill ${alarming ? 'is-alarm' : ''}`}>
      <span className="material-symbols-rounded" style={{ fontSize: 16, opacity: 0.8 }}>
        {icon}
      </span>
      <span style={{ opacity: 0.75 }}>{device.name}:</span>
      <strong>{value}</strong>
    </span>
  )
}

/** First-time setup instructions */
function NotConfigured() {
  return (
    <div className="rs-card is-wide animate-fade-in rs-p-6">
      <div className="rs-card-head rs-mb-3">
        <span className="rs-card-label">SETUP HOME ASSISTANT</span>
      </div>
      <p className="rs-card-meta rs-mb-5 rs-type-small">
        River Song connects directly to your local or remote Home Assistant instance. Add your URL and long-lived access token to <code>.env</code> to activate tactile smart home controls.
      </p>
      <div className="rs-flex rs-flex-col rs-gap-4">
        <div className="rs-flex rs-gap-3 rs-items-center">
          <span className="gh-chip rs-justify-center" style={{ width: 28, height: 28, padding: 0 }}>1</span>
          <span>Home Assistant → User Profile → Long-lived access tokens → Create token</span>
        </div>
        <div className="rs-flex rs-gap-3 rs-items-center">
          <span className="gh-chip rs-justify-center" style={{ width: 28, height: 28, padding: 0 }}>2</span>
          <span>Add to your backend <code>.env</code> file:</span>
        </div>
        <div className="rs-mono rs-type-tiny" style={{
          padding: 'var(--rs-space-4) var(--rs-space-5)',
          background: 'rgba(0,0,0,0.35)',
          borderRadius: 'var(--md-shape-lg)',
          color: 'var(--md-primary)',
          border: '1px solid rgba(0, 229, 255, 0.2)',
        }}>
          <div>HOME_ASSISTANT_URL=http://homeassistant.local:8123</div>
          <div>HOME_ASSISTANT_TOKEN=your_token_here</div>
        </div>
        <div className="rs-flex rs-gap-3 rs-items-center">
          <span className="gh-chip rs-justify-center" style={{ width: 28, height: 28, padding: 0 }}>3</span>
          <span>Restart the service, then tap the Sync button above.</span>
        </div>
      </div>
    </div>
  )
}
