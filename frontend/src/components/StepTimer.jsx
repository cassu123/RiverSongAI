/**
 * StepTimer — one timer, on one step.
 *
 * Offered rather than started. A step that says "3-5 minutes per side, until
 * golden" is judged by looking, and an alarm implying otherwise is worse than
 * no alarm — so the icon is an offer and the step says which kind it is.
 *
 * The server holds a deadline, never a countdown. This ticks locally against
 * that instant, so a reload, a second phone, or a laptop that went to sleep
 * all show the same number without anything having to be kept in sync.
 */
import React, { useEffect, useRef, useState } from 'react'

const mmss = (s) => {
  const sign = s < 0 ? '-' : ''
  const a = Math.abs(s)
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}

// A short double beep, synthesised rather than shipped as a file: no asset to
// load, and nothing to fail on a kitchen tablet with no network.
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[0, 0.32].forEach(offset => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset)
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.24)
    })
    setTimeout(() => ctx.close().catch(() => {}), 1200)
  } catch { /* audio blocked; the row still turns red and counts up */ }
}

export default function StepTimer({ timer, api, onChanged }) {
  const [left, setLeft] = useState(0)
  const rang = useRef(false)

  useEffect(() => {
    const compute = () => {
      if (timer.paused_seconds != null) return timer.paused_seconds
      if (!timer.ends_at) return 0
      return Math.round((new Date(timer.ends_at) - Date.now()) / 1000)
    }
    setLeft(compute())
    if (timer.paused_seconds != null) return          // frozen; no tick needed
    const t = setInterval(() => setLeft(compute()), 1000)
    return () => clearInterval(t)
  }, [timer])

  // Ring once, on the transition. Re-ringing on every render would make a
  // timer nobody has acknowledged into a continuous alarm.
  useEffect(() => {
    if (left <= 0 && !rang.current && timer.paused_seconds == null) {
      rang.current = true
      beep()
      if (navigator.vibrate) navigator.vibrate([200, 100, 200])
    }
    if (left > 0) rang.current = false
  }, [left, timer.paused_seconds])

  const act = async (action, seconds) => {
    try {
      await api.patch(`/meal-cook/timers/${timer.id}`, { action, seconds })
    } finally { onChanged?.() }
  }

  const stop = async () => {
    try { await api.delete(`/meal-cook/timers/${timer.id}`) } finally { onChanged?.() }
  }

  const done = left <= 0 && timer.paused_seconds == null
  const paused = timer.paused_seconds != null

  return (
    <div
      role="timer"
      aria-live={done ? 'assertive' : 'off'}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginTop: 8, padding: '8px 10px', borderRadius: 8,
        background: done
          ? 'color-mix(in srgb, var(--md-error) 18%, transparent)'
          : 'var(--md-surface-container-high)',
        border: done ? '1px solid var(--md-error)' : '1px solid var(--md-outline-variant)',
      }}
    >
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.15rem',
        minWidth: 66, color: done ? 'var(--md-error)' : 'var(--primary)',
      }}>{mmss(left)}</span>

      <span className="rs-card-label" style={{ fontSize: '0.6rem', flex: 1, minWidth: 60 }}>
        {done ? 'TIME' : paused ? 'PAUSED' : timer.label}
      </span>

      {/* Pause and resume are the same button: there is only ever one thing
          it can usefully do. */}
      {!done && (
        <button
          className="rs-pill" style={{ padding: '4px 10px' }}
          aria-label={paused ? 'Resume timer' : 'Pause timer'}
          onClick={() => act(paused ? 'resume' : 'pause')}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>
            {paused ? 'play_arrow' : 'pause'}
          </span>
        </button>
      )}

      {/* Still offered after it has rung: "one more minute" is exactly what
          you want having just looked in the oven, and the server counts that
          from now rather than from a deadline already in the past. */}
      <button
        className="rs-pill" style={{ padding: '4px 10px', fontSize: '0.72rem' }}
        aria-label="Add a minute"
        onClick={() => act('extend', 60)}
      >+1 MIN</button>

      <button
        className="rs-pill"
        style={{
          padding: '4px 10px', fontSize: '0.72rem',
          color: done ? 'var(--md-error)' : undefined,
          borderColor: done ? 'var(--md-error)' : undefined,
        }}
        aria-label="Stop timer"
        onClick={stop}
      >STOP</button>
    </div>
  )
}
