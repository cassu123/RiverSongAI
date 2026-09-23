/**
 * riverMind — how River moves, kept separate from what she looks like.
 *
 * The orb is a placeholder for an avatar that does not exist yet. Whatever
 * body she ends up in, the behaviour should be the same, so it lives here and
 * the renderer only reads it. The VRM avatar can read the same snapshot.
 *
 * Three rules:
 *
 *   1. Nothing loops. Every dial drifts on seeded gradient noise, so no stretch
 *      of her motion ever plays back identically. A CSS keyframe replays one
 *      cycle forever and the eye catches the period in a few passes; that is
 *      what made the old bulb read as wallpaper.
 *
 *   2. States are goals, not animations. Listening does not mean "breathe
 *      faster". Each state sets targets and every dial springs toward its
 *      target, slightly under-damped, so each transition lands a little
 *      differently and never snaps.
 *
 *   3. She does things nobody asked for. A scheduler with irregular timing
 *      fires small behaviours — a glance, a vortex spinning up, a breath, a
 *      thought crossing her — and a slow mood keeps her charged after a busy
 *      stretch. That is what reads as a mind rather than a reaction.
 *
 * Phases are integrated rather than derived from time × speed, so a change of
 * speed never makes anything jump.
 */

/* ------------------------------------------------------------------ noise */

/** Seeded 1-D gradient noise, roughly -1..1. Not periodic. */
function makeNoise(rand) {
  const N = 512
  const g = new Float32Array(N)
  for (let i = 0; i < N; i++) g[i] = rand() * 2 - 1
  return (x) => {
    const i = Math.floor(x)
    const f = x - i
    const a = g[((i % N) + N) % N] * f
    const b = g[(((i + 1) % N) + N) % N] * (f - 1)
    const u = f * f * f * (f * (f * 6 - 15) + 10)
    return (a + (b - a) * u) * 2
  }
}

/** Small seeded PRNG (mulberry32) so tests can pin behaviour. */
export function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ states */

const ALIASES = { connecting: 'thinking', transcribing: 'thinking' }
export const STATES = ['idle', 'listening', 'thinking', 'speaking', 'error']

/**
 * What each state asks of her. Dials are 0..~1.5:
 *   energy     overall intensity of light
 *   cohesion   how tightly she holds her shape (low = frayed, loose)
 *   turbulence how much the flow inside her churns
 *   swirl      how fast the vortices turn
 *   wobble     how much her edge deforms
 *   shell      visibility of the particle shell
 *   ribbon     visibility and reach of the ribbons (her voice)
 *   awake      how many vortices are awake (2..5)
 */
export const TARGETS = {
  idle:      { energy: 0.42, cohesion: 0.58, turbulence: 0.40, swirl: 0.45, wobble: 0.45, shell: 0.55, ribbon: 0.35, awake: 3 },
  listening: { energy: 0.58, cohesion: 0.90, turbulence: 0.22, swirl: 0.30, wobble: 0.22, shell: 0.85, ribbon: 0.18, awake: 2 },
  thinking:  { energy: 0.80, cohesion: 0.45, turbulence: 0.85, swirl: 1.35, wobble: 0.62, shell: 0.70, ribbon: 0.45, awake: 5 },
  speaking:  { energy: 0.74, cohesion: 0.66, turbulence: 0.48, swirl: 0.72, wobble: 0.52, shell: 0.60, ribbon: 1.00, awake: 4 },
  error:     { energy: 0.30, cohesion: 0.25, turbulence: 0.95, swirl: 0.20, wobble: 0.90, shell: 0.35, ribbon: 0.08, awake: 2 },
}

const DIALS = ['energy', 'cohesion', 'turbulence', 'swirl', 'wobble', 'shell', 'ribbon', 'awake']

// How far each dial wanders on its own, and how quickly. Different rates per
// dial so they never move in lockstep.
const DRIFT = {
  energy: [0.08, 0.11], cohesion: [0.10, 0.07], turbulence: [0.14, 0.09],
  swirl: [0.16, 0.13], wobble: [0.14, 0.10], shell: [0.10, 0.08],
  ribbon: [0.10, 0.06], awake: [0.6, 0.05],
}

/* ------------------------------------------------------------------ events */

/**
 * Unprompted behaviours. Each is an envelope added on top of the dials:
 * attack → hold → release. Weights say how often each is chosen.
 *
 * Which ones she does depends on what she is doing. Idle, anything. While
 * listening, nothing: someone who wanders off mid-sentence is not listening.
 * While thinking, flickers and curls. While speaking, small glances.
 */
const EVENTS = {
  idle: [
    { name: 'glance',  weight: 3 },
    { name: 'curl',    weight: 3 },
    { name: 'breath',  weight: 2 },
    { name: 'shimmer', weight: 2 },
    { name: 'drift',   weight: 2 },
    { name: 'thought', weight: 2 },
  ],
  listening: [],
  thinking: [
    { name: 'thought', weight: 3 },
    { name: 'curl',    weight: 2 },
    { name: 'shimmer', weight: 1 },
  ],
  speaking: [
    { name: 'glance',  weight: 2 },
    { name: 'shimmer', weight: 2 },
    { name: 'drift',   weight: 1 },
  ],
  error: [
    { name: 'thought', weight: 2 },
    { name: 'breath',  weight: 1 },
  ],
}

/* ------------------------------------------------------------------ mind */

/**
 * `wallClock` gives the real time for night dimming. tick() is fed frame
 * timestamps, which count from page load and are no use as a time of day.
 */
export function createMind({ random = Math.random, reducedMotion = false, wallClock = Date.now } = {}) {
  const rand = random
  const noise = makeNoise(rand)
  const noiseOffset = {}
  for (const d of DIALS) noiseOffset[d] = rand() * 1000

  let state = 'idle'
  let rawLevel = 0
  let last = null
  let clock = 0                 // seconds of her own time
  let nextEventAt = 3 + rand() * 4
  let charge = 0                // slow mood: rises while busy, decays over minutes
  let night = 1                 // 0.78 between 23:00 and 06:00, real local time
  let hourCheckedAt = -Infinity
  const envelopes = []          // active unprompted behaviours / reactions

  const dial = {}
  const vel = {}
  for (const d of DIALS) { dial[d] = TARGETS.idle[d]; vel[d] = 0 }

  // Vortices: each orbits the centre on its own noisy path.
  const vortices = Array.from({ length: 5 }, (_, i) => ({
    theta: rand() * Math.PI * 2,
    rho: 0.28 + rand() * 0.38,
    spin: i % 2 ? -1 : 1,
    base: 0.75 + rand() * 0.5,
    radius: 0.34 + rand() * 0.2,
    boost: 0,
    phase: rand() * Math.PI * 2,
    seed: rand() * 100,
    x: 0, y: 0, strength: 0,
  }))

  const snap = {
    state, level: 0, flare: 0, spark: 0, reach: 0, reachDir: 0, err: 0,
    attnX: 0, attnY: 0, ribbonAngle: 0, time: 0, flow: 0,
    rotX: 0, rotY: 0, calm: true, vortices,
    energy: 0, cohesion: 0, turbulence: 0, swirl: 0, wobble: 0, shell: 0, ribbon: 0,
  }

  const envTotals = { energy: 0, cohesion: 0, turbulence: 0, swirl: 0, wobble: 0, flare: 0, spark: 0, reach: 0, attnX: 0, attnY: 0, ribbonAngle: 0 }
  let ribbonAngleBase = (rand() - 0.5) * 0.5
  let err = 0
  let level = 0

  function push(e) {
    envelopes.push({ start: clock, attack: 0.4, hold: 0.6, release: 1.2, ...e })
  }

  function envValue(e) {
    const t = clock - e.start
    if (t < 0) return 0
    if (t < e.attack) return t / e.attack
    if (t < e.attack + e.hold) return 1
    const r = (t - e.attack - e.hold) / e.release
    return r < 1 ? 1 - r * r * (3 - 2 * r) : -1   // -1 = finished
  }

  function pick(list) {
    const total = list.reduce((s, x) => s + x.weight, 0)
    let r = rand() * total
    for (const x of list) { r -= x.weight; if (r <= 0) return x.name }
    return list[0].name
  }

  function spontaneous(name) {
    const dir = rand() * Math.PI * 2
    switch (name) {
      case 'glance': {
        const m = 0.5 + rand() * 0.5
        push({ attnX: Math.cos(dir) * m, attnY: Math.sin(dir) * m, attack: 0.5 + rand() * 0.6, hold: 0.8 + rand() * 2.2, release: 1.2 + rand() })
        break
      }
      case 'curl': {
        const v = vortices[Math.floor(rand() * 3)]
        v.boost = 1.2 + rand() * 1.1
        push({ swirl: 0.25, turbulence: 0.15, attack: 0.8, hold: 0.8 + rand() * 1.5, release: 2 })
        break
      }
      case 'breath':
        push({ cohesion: -0.28, energy: 0.1, wobble: 0.2, attack: 1.8, hold: 0.4, release: 2.6 })
        break
      case 'shimmer':
        push({ spark: 1, energy: 0.08, attack: 0.3, hold: 0.5, release: 1.4 })
        break
      case 'drift':
        push({ ribbonAngle: (rand() - 0.5) * 1.3, attack: 2.5, hold: 3 + rand() * 4, release: 3 })
        break
      case 'thought':
        push({ flare: 0.3 + rand() * 0.2, turbulence: 0.35, swirl: 0.3, attack: 0.15, hold: 0.2, release: 1.1 })
        push({ attnX: Math.cos(dir) * 0.35, attnY: Math.sin(dir) * 0.35, attack: 0.2, hold: 0.4, release: 1.0 })
        break
    }
  }

  const api = {
    get state() { return state },

    setState(s) {
      const next = ALIASES[s] || s
      if (!STATES.includes(next) || next === state) return
      const prev = state
      state = next
      // Arriving somewhere is an event in itself.
      if (next === 'listening') push({ cohesion: 0.15, energy: 0.15, attack: 0.15, hold: 0.1, release: 0.8 })
      if (next === 'thinking') push({ flare: 0.25, turbulence: 0.25, attack: 0.2, hold: 0.2, release: 1.0 })
      if (next === 'idle' && prev !== 'idle') push({ cohesion: -0.15, attack: 1.2, hold: 0.2, release: 2.5 })
    },

    setLevel(l) { rawLevel = Math.max(0, Math.min(1, Number(l) || 0)) },

    /** She has started or finished doing something (a tool call). */
    work(phase = 'start') {
      if (phase === 'start') {
        push({ reach: 1, flare: 0.35, turbulence: 0.25, attack: 0.25, hold: 0.6, release: 1.3, reachDir: rand() * Math.PI * 2 })
      } else {
        // "Done." A brief gathering in.
        push({ cohesion: 0.3, flare: 0.25, spark: 0.6, attack: 0.15, hold: 0.15, release: 1.1 })
      }
    },

    /** Something wants the user's attention. */
    attention() {
      push({ flare: 0.8, energy: 0.2, spark: 0.8, attnY: 0.5, attack: 0.12, hold: 0.4, release: 1.8 })
    },

    /**
     * Advance to `nowMs` and return the snapshot. Safe to call from several
     * renderers in the same frame: time only moves forward once.
     */
    tick(nowMs) {
      const now = nowMs / 1000
      if (last === null) last = now
      let dt = now - last
      if (dt <= 0) return snap
      last = now
      dt = Math.min(dt, 0.1)                    // after a stall, don't lurch
      const ts = reducedMotion ? 0.25 : 1
      dt *= ts
      clock += dt

      // --- unprompted behaviour ---------------------------------------
      if (!reducedMotion && clock >= nextEventAt) {
        const pool = EVENTS[state]
        if (pool.length) spontaneous(pick(pool))
        // Irregular spacing: exponential around a mean that depends on how
        // occupied she already is. Busy states leave less room for tangents.
        const mean = state === 'idle' ? 6.5 : state === 'thinking' ? 3.5 : state === 'error' ? 4 : 9
        nextEventAt = clock + Math.max(1.6, -Math.log(1 - rand()) * mean)
      }

      // --- mood ---------------------------------------------------------
      if (state !== 'idle') charge = Math.min(1, charge + dt / 45)
      charge *= Math.exp(-dt / 150)
      // The hour moves slowly; no need for a Date every frame.
      if (clock - hourCheckedAt > 30 || hourCheckedAt === -Infinity) {
        const hour = new Date(wallClock()).getHours()
        night = hour >= 23 || hour < 6 ? 0.78 : 1
        hourCheckedAt = clock
      }

      // --- envelopes ------------------------------------------------------
      for (const k in envTotals) envTotals[k] = 0
      let reachDir = snap.reachDir
      let reachPeak = 0
      for (let i = envelopes.length - 1; i >= 0; i--) {
        const e = envelopes[i]
        const v = envValue(e)
        if (v < 0) { envelopes.splice(i, 1); continue }
        for (const k in envTotals) if (e[k]) envTotals[k] += e[k] * v
        if (e.reach && e.reach * v > reachPeak) { reachPeak = e.reach * v; reachDir = e.reachDir }
      }

      // --- dials: spring toward target + own drift ------------------------
      const target = TARGETS[state]
      const k = 7, c = 2 * Math.sqrt(k) * 0.72  // slightly under-damped
      for (const d of DIALS) {
        const [amp, rate] = DRIFT[d]
        let t = target[d] + noise(noiseOffset[d] + clock * rate) * amp + (envTotals[d] || 0)
        if (d === 'energy') t = (t + charge * 0.12) * night
        if (d === 'swirl') t *= night
        vel[d] += ((t - dial[d]) * k - vel[d] * c) * dt
        dial[d] += vel[d] * dt
      }

      // --- voice level: quick to rise, slower to fall ---------------------
      const rate = rawLevel > level ? 0.35 : 0.12
      level += (rawLevel - level) * (1 - Math.pow(1 - rate, dt * 60))
      err += ((state === 'error' ? 1 : 0) - err) * Math.min(1, dt * 1.5)

      // --- vortices -------------------------------------------------------
      const awake = Math.max(2, Math.min(5, dial.awake))
      vortices.forEach((v, i) => {
        const on = Math.max(0, Math.min(1, awake - i))
        v.theta += dt * v.spin * (0.05 + 0.09 * noise(v.seed + clock * 0.07)) * (0.6 + dial.swirl)
        v.rho = 0.3 + 0.32 * (0.5 + 0.5 * noise(v.seed + 40 + clock * 0.05))
        v.boost *= Math.exp(-dt / 2.5)
        v.x = Math.cos(v.theta) * v.rho
        v.y = Math.sin(v.theta) * v.rho
        const live = v.base * (0.55 + dial.swirl * 0.6) + v.boost
        v.strength = v.spin * live * on * (0.85 + 0.15 * noise(v.seed + 80 + clock * 0.3))
        v.phase += dt * Math.abs(v.strength) * (0.3 + 0.55 * dial.swirl)
      })

      // --- phases (integrated, so speed changes never jump) --------------
      snap.time += dt * (0.35 + dial.energy * 0.45 + level * 0.6)
      snap.flow += dt * (0.18 + dial.swirl * 0.32)
      snap.rotY += dt * (0.10 + dial.swirl * 0.12)
      snap.rotX = 0.35 + 0.25 * noise(500 + clock * 0.05)
      ribbonAngleBase += noise(900 + clock * 0.03) * dt * 0.02

      // --- publish --------------------------------------------------------
      snap.state = state
      for (const d of DIALS) snap[d] = dial[d]
      snap.level = level
      snap.flare = Math.min(1.2, envTotals.flare)
      snap.spark = Math.min(1.5, envTotals.spark + 0.15 * (0.5 + 0.5 * noise(700 + clock * 0.4)))
      snap.reach = reachPeak
      snap.reachDir = reachDir
      snap.err = err
      snap.attnX = envTotals.attnX + noise(300 + clock * 0.09) * 0.12
      snap.attnY = envTotals.attnY + noise(350 + clock * 0.08) * 0.12
      snap.ribbonAngle = ribbonAngleBase + envTotals.ribbonAngle
      snap.calm = state === 'idle' && envelopes.length === 0 && level < 0.02
      return snap
    },
  }
  return api
}

/* --------------------------------------------------------- the shared mind */

let shared = null

/**
 * The one River every renderer on the page reads, so the dock and the Voice
 * stage never disagree about what she is doing. Listens to the app's bus:
 *   rs-presence  { state, level }   from the voice loop
 *   rs-activity  { phase }          a tool call starting / finishing
 *   rs-toast                        something wants attention
 */
export function getRiverMind() {
  if (shared) return shared
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  shared = createMind({ reducedMotion: !!reduced })
  if (typeof window !== 'undefined') {
    window.addEventListener('rs-presence', (e) => {
      const st = e.detail?.state
      if (st) shared.setState(st)
      // The voice loop only sends a level while listening or speaking. Any
      // other state arriving without one means the audio has stopped —
      // otherwise the last amplitude sticks through transcribing, connecting
      // or an error.
      if (typeof e.detail?.level === 'number') shared.setLevel(e.detail.level)
      else if (st && st !== 'listening' && st !== 'speaking') shared.setLevel(0)
    })
    window.addEventListener('rs-activity', (e) => shared.work(e.detail?.phase === 'end' ? 'end' : 'start'))
    window.addEventListener('rs-toast', () => shared.attention())
  }
  return shared
}
