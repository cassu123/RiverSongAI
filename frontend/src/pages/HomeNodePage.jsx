import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import SafetyRules from '../components/SafetyRules.jsx'

const DOMAIN_ICON = {
  light: '◎', switch: '◉', fan: '◈', cover: '▣', lock: '◆', climate: '◇',
  scene: '★', script: '▶', input_boolean: '◉', media_player: '♪',
  sensor: '▪', binary_sensor: '▫',
}

// Domains that are read-only readings rather than things you operate.
const READONLY = new Set(['sensor', 'binary_sensor'])
const LAUNCHERS = new Set(['scene', 'script'])

const ON_STATES = ['on', 'open', 'unlocked', 'playing', 'active',
                   'heat', 'cool', 'fan_only', 'dry', 'auto']

function isOn(d) { return ON_STATES.includes(String(d.state)) }

const UNASSIGNED = 'Unassigned'

// Home Assistant service names. Covers were being sent 'open'/'close', which
// are not services -- the calls failed silently and the card never moved.
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

/** Human phrasing for a binary_sensor, driven by its device_class. */
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

/** A binary_sensor state that deserves attention in the status strip. */
function isAlarming(d) {
  if (String(d.state) !== 'on') return false
  return ['moisture', 'smoke', 'gas', 'carbon_monoxide', 'safety', 'problem']
    .includes(d.device_class)
}

export default function HomeNodePage({ setAction }) {
  const { token } = useAuth()
  const [status,  setStatus]  = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)
  const [room,    setRoom]    = useState('all')
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

  // Live updates. The server sends the same shape GET /devices returns, so a
  // spread merge is enough -- and because it omits `area`, the room a card
  // sits in survives the update.
  useEffect(() => {
    if (!status?.reachable || !token) return
    const es = new EventSource(`/api/home/stream?token=${token}`)
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (!msg.entity_id) return
        setDevices(prev => prev.map(d => d.entity_id === msg.entity_id
          ? { ...d, ...(msg.device || {}), state: msg.state ?? d.state }
          : d))
      } catch { /* a malformed frame should not kill the stream */ }
    }
    return () => es.close()
  }, [status?.reachable, token])

  // Fallback poll. SSE carries live changes; this only catches a missed frame.
  useEffect(() => {
    if (!status?.reachable || !token) return
    const id = setInterval(() => fetchAll(true), 300000)
    return () => clearInterval(id)
  }, [status?.reachable, token, fetchAll])

  const callAction = useCallback(async (entity_id, action, extra = {}) => {
    setActing(entity_id)
    // Optimistic flip, reconciled by the SSE event that follows.
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
      await fetch('/api/home/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity_id, action, ...extra }),
      })
    } finally {
      setActing(null)
    }
  }, [token])

  const runSync = useCallback(async () => {
    setSyncing(true)
    try {
      await fetch('/api/home/sync', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      })
      await fetchAll(true)
    } finally { setSyncing(false) }
  }, [token, fetchAll])

  const scenes     = useMemo(() => devices.filter(d => LAUNCHERS.has(d.domain)), [devices])
  const operable   = useMemo(() => devices.filter(d => !LAUNCHERS.has(d.domain)), [devices])

  // Rooms come from the area Home Assistant assigns each entity. Anything HA
  // has not placed collects under "Unassigned" rather than disappearing.
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

  const visibleRooms = room === 'all' ? rooms : rooms.filter(r => r.name === room)

  const attention = useMemo(() => {
    const items = []
    for (const d of operable) {
      if (d.domain === 'lock' && String(d.state) === 'unlocked')
        items.push({ id: d.entity_id, tone: 'warn', text: `${d.name} unlocked` })
      else if (d.domain === 'cover' && String(d.state) === 'open')
        items.push({ id: d.entity_id, tone: 'warn', text: `${d.name} open` })
      else if (d.domain === 'binary_sensor' && isAlarming(d))
        items.push({ id: d.entity_id, tone: 'critical', text: `${d.name}: ${binaryLabel(d)}` })
    }
    return items.sort((a, b) => (a.tone === 'critical' ? -1 : 1))
  }, [operable])

  const ActionSlot = useMemo(() => (
    <div className="rs-input-bar">
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, width: '100%', alignItems: 'center' }}>
        <button className={`rs-pill ${room === 'all' ? 'is-active' : ''}`}
                style={{ fontSize: '0.85rem' }} onClick={() => setRoom('all')}>
          ALL ROOMS
        </button>
        {rooms.map(r => (
          <button key={r.name}
                  className={`rs-pill ${room === r.name ? 'is-active' : ''}`}
                  style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
                  onClick={() => setRoom(r.name)}>
            {r.name.toUpperCase()}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="rs-pill" title="Re-read rooms from Home Assistant"
                onClick={runSync} disabled={syncing}>
          <span className="material-symbols-rounded">{syncing ? 'hourglass_top' : 'sync'}</span>
        </button>
        <button className="rs-pill" title="Refresh" onClick={() => fetchAll()}>
          <span className="material-symbols-rounded">refresh</span>
        </button>
      </div>
    </div>
  ), [rooms, room, fetchAll, runSync, syncing])

  useEffect(() => {
    if (setAction && status?.reachable) setAction(ActionSlot)
    return () => { if (setAction) setAction(null) }
  }, [ActionSlot, setAction, status?.reachable])

  return (
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-card-label">HOME</div>
        <h1 className="rs-greeting">Your House</h1>
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{
            background: loading ? undefined : status?.reachable ? 'var(--secondary)' : 'var(--warn)' }} />
          <span>{loading ? 'CONNECTING…'
            : status?.reachable
              ? `${rooms.length} ROOMS · ${operable.length} DEVICES`
              : 'HOME ASSISTANT NOT REACHABLE'}</span>
        </div>
      </header>

      <div className="rs-card-flow">

        {!loading && !status?.configured && <NotConfigured />}

        {!loading && status?.configured && !status?.reachable && (
          <div className="rs-card is-wide">
            <div className="rs-card-head"><span className="rs-card-label">UNREACHABLE</span></div>
            <p className="rs-card-meta" style={{ fontSize: '0.95rem' }}>
              Home Assistant is configured but not responding. Check that it is
              running and the URL is right, then refresh.
            </p>
            <button className="rs-btn-primary" style={{ marginTop: 16 }} onClick={() => fetchAll()}>↺ RETRY</button>
          </div>
        )}

        {!loading && status?.reachable && (
          <>
            {attention.length > 0 && (
              <div className="rs-card is-wide" style={{ borderLeft: '3px solid var(--warn)' }}>
                <div className="rs-card-head">
                  <span className="rs-card-label">NEEDS A LOOK</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {attention.map(a => (
                    <span key={a.id} className="rs-pill" style={{
                      fontSize: '0.85rem',
                      color: a.tone === 'critical' ? 'var(--md-error)' : 'var(--warn)',
                    }}>{a.text}</span>
                  ))}
                </div>
              </div>
            )}

            {scenes.length > 0 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, width: '100%', scrollbarWidth: 'none' }}>
                {scenes.map(s => (
                  <button key={s.entity_id}
                          className={`rs-pill ${acting === s.entity_id ? 'is-active' : ''}`}
                          style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}
                          onClick={() => callAction(s.entity_id, 'turn_on')}
                          disabled={acting === s.entity_id}>
                    {DOMAIN_ICON[s.domain]} {s.name.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            {visibleRooms.map(r => (
              <RoomCard key={r.name} room={r} acting={acting} onAction={callAction} />
            ))}

            <SafetyRules />

            {operable.length === 0 && (
              <div className="rs-card is-wide" style={{ textAlign: 'center' }}>
                <span className="rs-card-meta" style={{ fontSize: '0.95rem' }}>
                  No devices yet. Tap sync to re-read them from Home Assistant.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** One room: its climate summary, its controls, and its readings. */
function RoomCard({ room, acting, onAction }) {
  const controls = room.devices.filter(d => !READONLY.has(d.domain) && d.domain !== 'media_player')
  const media    = room.devices.filter(d => d.domain === 'media_player')
  const readings = room.devices.filter(d => READONLY.has(d.domain))

  // The room's temperature, if anything in it reports one.
  const temp = readings.find(d => d.device_class === 'temperature')
            || room.devices.find(d => d.current_temp != null)

  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rs-card-label">{room.name.toUpperCase()}</span>
        {temp && (
          <span style={{ fontSize: '0.95rem', opacity: 0.8, fontFamily: 'var(--font-mono)' }}>
            {temp.current_temp != null ? `${temp.current_temp}°` : `${temp.state}${temp.unit || '°'}`}
          </span>
        )}
      </div>

      {controls.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
          {controls.map(d => (
            <DeviceCard key={d.entity_id} device={d} busy={acting === d.entity_id} onAction={onAction} />
          ))}
        </div>
      )}

      {media.map(m => (
        <MediaCard key={m.entity_id} device={m} busy={acting === m.entity_id} onAction={onAction} />
      ))}

      {readings.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {readings.map(s => <SensorChip key={s.entity_id} device={s} />)}
        </div>
      )}
    </div>
  )
}

/** A reading, not a control. Sensors have no on/off to press. */
function SensorChip({ device }) {
  const binary = device.domain === 'binary_sensor'
  const alarming = binary && isAlarming(device)
  const value = binary
    ? binaryLabel(device)
    : `${device.state}${device.unit ? ` ${device.unit}` : ''}`
  return (
    <span className="rs-pill" style={{
      fontSize: '0.85rem',
      color: alarming ? 'var(--md-error)' : undefined,
      borderColor: alarming ? 'var(--md-error)' : undefined,
    }}>
      <span style={{ opacity: 0.75, marginRight: 6 }}>{device.name}</span>
      <strong style={{ fontFamily: 'var(--font-mono)' }}>{value}</strong>
    </span>
  )
}

function MediaCard({ device, busy, onAction }) {
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
    <div className="rs-card" style={{ width: '100%', marginTop: 12, opacity: busy ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: '1.3rem', color: playing ? 'var(--secondary)' : 'var(--text-muted)' }}>♪</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{device.name}</div>
          <div className="rs-card-meta" style={{ fontSize: '0.95rem' }}>
            {device.media_title || device.app_name || String(device.state).toUpperCase()}
          </div>
        </div>
        <button className="rs-pill" style={{ fontSize: '0.85rem' }} disabled={busy}
                onClick={() => onAction(device.entity_id, playing ? 'media_pause' : 'media_play')}>
          {playing ? 'PAUSE' : 'PLAY'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <span className="material-symbols-rounded" style={{ fontSize: '1.05rem', opacity: 0.7 }}>volume_down</span>
        <input type="range" min="0" max="100" value={vol} onChange={onVol} disabled={busy}
               aria-label={`${device.name} volume`}
               style={{ flex: 1, height: 4, accentColor: 'var(--md-primary)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', opacity: 0.75 }}>{vol}%</span>
      </div>
    </div>
  )
}

function DeviceCard({ device, busy, onAction }) {
  const on = isOn(device)
  const isClimate = device.domain === 'climate'
  const isLight   = device.domain === 'light'

  const [bright, setBright] = useState(Math.round((device.brightness ?? 255) / 255 * 100))
  const brightTimer = useRef(null)

  useEffect(() => {
    if (!brightTimer.current) {
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
    }, 400)
  }

  const adjustTemp = (delta) => {
    const next = parseFloat(((device.temperature || 20) + delta).toFixed(1))
    onAction(device.entity_id, 'set_temperature', { temperature: next })
  }

  return (
    <div className="rs-card" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      textAlign: 'center', opacity: busy ? 0.6 : 1, padding: '16px 12px',
      border: on ? '1px solid color-mix(in srgb, var(--secondary) 30%, transparent)' : undefined,
      background: on ? 'color-mix(in srgb, var(--secondary) 5%, var(--rs-card-bg))' : undefined,
    }}>
      <div style={{ fontSize: '1.3rem', lineHeight: 1, color: on ? 'var(--secondary)' : 'var(--text-muted)' }}>
        {DOMAIN_ICON[device.domain] || '◦'}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.3 }}>{device.name}</div>

      {isClimate && (
        <div style={{ width: '100%', marginTop: 4, padding: 8, background: 'rgba(0,0,0,0.2)',
                      borderRadius: 'var(--md-shape-xl)', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8, marginBottom: 8 }}>
            <span>{device.current_temp != null ? `${device.current_temp}°` : '--'}</span>
            <span>Target {device.temperature != null ? `${device.temperature}°` : '--'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="rs-pill" style={{ width: 30, height: 30, padding: 0, justifyContent: 'center' }}
                      onClick={() => adjustTemp(-0.5)} disabled={busy} aria-label="Lower target">−</button>
              <button className="rs-pill" style={{ width: 30, height: 30, padding: 0, justifyContent: 'center' }}
                      onClick={() => adjustTemp(0.5)} disabled={busy} aria-label="Raise target">+</button>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--md-primary)', fontWeight: 600 }}>
              {String(device.state).toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {isLight && on && (
        <div style={{ width: '100%', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min="1" max="100" value={bright} onChange={onBright} disabled={busy}
                 aria-label={`${device.name} brightness`}
                 style={{ flex: 1, height: 4, accentColor: 'var(--md-primary)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', opacity: 0.75 }}>{bright}%</span>
        </div>
      )}

      {!isClimate && !isLight && (
        <div className="rs-card-meta" style={{ fontSize: '0.85rem' }}>
          {String(device.state).toUpperCase()}
        </div>
      )}

      <button className={on ? 'rs-pill is-active' : 'rs-pill'}
              style={{ marginTop: 8, width: '100%', justifyContent: 'center', fontSize: '0.85rem' }}
              onClick={() => onAction(device.entity_id, toggleFor(device, on))}
              disabled={busy}>
        {busy ? '…' : toggleLabel(device, on)}
      </button>
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">HOME ASSISTANT NOT CONFIGURED</span>
      </div>
      <p className="rs-card-meta" style={{ fontSize: '0.95rem' }}>
        Add your Home Assistant URL and a long-lived access token to <code>.env</code> to control devices.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16, fontSize: '0.95rem' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>01</span>
          <span>Home Assistant → Profile → Security → Long-lived access tokens → Create token</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>02</span>
          <span>Add to your <code>.env</code>:</span>
        </div>
        <div style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)',
                      borderRadius: 'var(--md-shape-xl)', fontFamily: 'var(--font-mono)',
                      fontSize: '0.85rem', color: 'var(--secondary)' }}>
          <div>HOME_ASSISTANT_URL=http://homeassistant.local:8123</div>
          <div>HOME_ASSISTANT_TOKEN=your_token_here</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>03</span>
          <span>Restart the server, then press sync on this page.</span>
        </div>
      </div>
    </div>
  )
}
