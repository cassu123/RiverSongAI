import React, { useEffect, useRef, useState } from 'react'

/**
 * PresenceBulb — River, rendered as a luminous plasma sphere.
 *
 * ONE avatar for the whole app. It is size-agnostic: everything inside scales
 * off the element's own box, so the same component is the 20px dot in the
 * header and the 400px presence on the Speaking stage. That is the point —
 * previously the header rendered a flat CSS circle and the Speaking page
 * rendered a separate three.js scene, so River had two unrelated faces.
 *
 * Pure CSS/SVG on purpose. A lit gradient, a turbulence-warped filament pass
 * and bloom are what compositing is good at, and it costs no WebGL context, no
 * shader compile and no 268 kB of three.js on a phone.
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

const FILTER_ID = 'rs-bulb-turbulence'

/**
 * The filaments are concentric rings pushed around by an SVG turbulence
 * displacement filter, so that filter has to exist in the document — exactly
 * once, however many bulbs are mounted. Duplicate SVG filter IDs are invalid
 * and browsers silently resolve every reference to whichever came first, so
 * rendering it per-instance would be a bug waiting to surprise someone.
 *
 * Injected imperatively rather than rendered by React: it is shared chrome
 * with no owner, and this way it survives any bulb unmounting.
 */
function ensureFilterDefs() {
  if (typeof document === 'undefined') return
  if (document.getElementById(FILTER_ID)) return

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  svg.innerHTML = `
    <filter id="${FILTER_ID}" x="-30%" y="-30%" width="160%" height="160%">
      <feTurbulence type="fractalNoise" baseFrequency="0.011 0.019"
                    numOctaves="4" seed="7" result="noise">
        <animate attributeName="baseFrequency" dur="24s" repeatCount="indefinite"
                 values="0.011 0.019; 0.021 0.010; 0.011 0.019" />
      </feTurbulence>
      <!-- Keep this gentle. A large scale shreds the rings into noise instead
           of curling them, and the filaments disappear entirely. -->
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="14"
                         xChannelSelector="R" yChannelSelector="G" />
    </filter>`
  document.body.appendChild(svg)
}

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

  useEffect(ensureFilterDefs, [])

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
        <span className="rs-bulb-fil rs-bulb-fil--a" />
        <span className="rs-bulb-fil rs-bulb-fil--b" />
      </span>
      <span className="rs-bulb-core"   aria-hidden="true" />
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
