import React, { useEffect, useRef, useState } from 'react'

/**
 * PresenceBulb — River, rendered as liquid light inside glass.
 *
 * ONE avatar for the whole app. It is size-agnostic: everything inside scales
 * off the element's own box, so the same component is the 20px dot in the
 * header and the 400px presence on the Speaking stage. That is the point —
 * previously the header rendered a flat CSS circle and the Speaking page
 * rendered a separate three.js scene, so River had two unrelated faces.
 *
 * Pure CSS/SVG on purpose. The look wanted here (volumetric glass, blurred
 * inner veils, bloom) is what compositing is good at, and it costs no WebGL
 * context, no shader compile and no 268 kB of three.js on a phone.
 *
 * Two inputs:
 *   state  idle | listening | thinking | speaking | error
 *   level  0..1 live audio amplitude — drives the flux
 *
 * Either can be passed directly, or left to the global `rs-presence` bus when
 * this is mounted somewhere that has no direct access to the voice loop
 * (the header, a chat bubble, a card).
 */

const STATES = ['idle', 'listening', 'thinking', 'speaking', 'error']

export default function PresenceBulb({
  state: stateProp,
  level: levelProp,
  size,
  interactive = false,
  onClick,
  className = '',
  label,
}) {
  // Only subscribe to the bus when the caller isn't driving us directly.
  const listens = stateProp === undefined || levelProp === undefined
  const [busState, setBusState] = useState('idle')
  const [busLevel, setBusLevel] = useState(0)
  const [attention, setAttention] = useState(false)
  const attentionTimer = useRef(null)

  useEffect(() => {
    if (!listens) return
    const onPresence = (e) => {
      const s = e.detail?.state
      if (STATES.includes(s)) setBusState(s)
      const l = e.detail?.level
      if (typeof l === 'number') setBusLevel(Math.max(0, Math.min(1, l)))
    }
    const onToast = () => {
      setAttention(true)
      clearTimeout(attentionTimer.current)
      attentionTimer.current = setTimeout(() => setAttention(false), 2400)
    }
    window.addEventListener('rs-presence', onPresence)
    window.addEventListener('rs-toast', onToast)
    return () => {
      window.removeEventListener('rs-presence', onPresence)
      window.removeEventListener('rs-toast', onToast)
      clearTimeout(attentionTimer.current)
    }
  }, [listens])

  const state = stateProp ?? busState
  const rawLevel = levelProp ?? busLevel

  // Smooth the amplitude. Raw mic level is far too jittery to drive a visual
  // directly — untouched it reads as a strobe rather than a breath.
  const [level, setLevel] = useState(0)
  const smoothed = useRef(0)
  const frame = useRef(0)
  useEffect(() => {
    let alive = true
    const tick = () => {
      if (!alive) return
      smoothed.current += (rawLevel - smoothed.current) * 0.18
      // Only re-render on a visible change; this runs at 60fps.
      setLevel((prev) =>
        Math.abs(prev - smoothed.current) > 0.01 ? smoothed.current : prev)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(frame.current) }
  }, [rawLevel])

  const classes = [
    'rs-bulb',
    `is-${state}`,
    attention ? 'is-attention' : '',
    interactive ? 'is-interactive' : '',
    className,
  ].filter(Boolean).join(' ')

  const style = {
    '--rs-bulb-level': level.toFixed(3),
    ...(size ? { '--rs-bulb-size': typeof size === 'number' ? `${size}px` : size } : null),
  }

  const inner = (
    <>
      <span className="rs-bulb-bloom"  aria-hidden="true" />
      <span className="rs-bulb-body"   aria-hidden="true">
        <span className="rs-bulb-veil rs-bulb-veil--a" />
        <span className="rs-bulb-veil rs-bulb-veil--b" />
        <span className="rs-bulb-veil rs-bulb-veil--c" />
        <span className="rs-bulb-core" />
      </span>
      <span className="rs-bulb-rim"    aria-hidden="true" />
      <span className="rs-bulb-sheen"  aria-hidden="true" />
    </>
  )

  const describe = label ?? (state === 'idle'
    ? 'Speak to River'
    : `River is ${state}`)

  if (interactive) {
    return (
      <button className={classes} style={style} onClick={onClick}
              aria-label={describe} title={describe}>
        {inner}
      </button>
    )
  }
  return (
    <span className={classes} style={style} role="img" aria-label={describe}>
      {inner}
    </span>
  )
}
