import { describe, it, expect } from 'vitest'
import { createMind, seeded, TARGETS } from './riverMind.js'
import { derivePalette } from './riverOrbGL.js'

const FRAME = 1000 / 60

function run(mind, seconds, from = 0) {
  let t = from
  let s
  for (let i = 0; i < Math.round(seconds * 60); i++) { t += FRAME; s = mind.tick(t) }
  return { s, t }
}

describe('riverMind', () => {
  it('draws together when listening and churns when thinking', () => {
    const m = createMind({ random: seeded(1) })
    let { s, t } = run(m, 4)
    const idleCohesion = s.cohesion
    m.setState('listening')
    ;({ s, t } = run(m, 3, t))
    expect(s.cohesion).toBeGreaterThan(idleCohesion + 0.15)
    m.setState('thinking')
    ;({ s } = run(m, 3, t))
    expect(s.turbulence).toBeGreaterThan(TARGETS.listening.turbulence + 0.3)
    expect(s.vortices.filter((v) => Math.abs(v.strength) > 0.1).length).toBeGreaterThanOrEqual(4)
  })

  it('treats connecting and transcribing as thinking', () => {
    const m = createMind({ random: seeded(2) })
    m.setState('transcribing')
    expect(m.state).toBe('thinking')
  })

  it('never jumps when her speed changes', () => {
    const m = createMind({ random: seeded(3) })
    let t = 0
    let prev = m.tick((t += FRAME)).flow
    let worst = 0
    for (let i = 0; i < 600; i++) {
      if (i === 300) m.setState('thinking')
      const flow = m.tick((t += FRAME)).flow
      worst = Math.max(worst, flow - prev)
      expect(flow).toBeGreaterThanOrEqual(prev)
      prev = flow
    }
    // At most one frame's worth of her fastest flow.
    expect(worst).toBeLessThan(0.02)
  })

  it('moves time once per frame however many orbs read her', () => {
    const m = createMind({ random: seeded(4) })
    const a = m.tick(100).time
    const b = m.tick(100).time
    expect(b).toBe(a)
  })

  it('does things on her own, at irregular intervals', () => {
    const m = createMind({ random: seeded(5) })
    let t = 0
    let wasCalm = true
    const starts = []
    for (let i = 0; i < 60 * 120; i++) {
      const s = m.tick((t += FRAME))
      if (wasCalm && !s.calm) starts.push(t / 1000)
      wasCalm = s.calm
    }
    expect(starts.length).toBeGreaterThan(6)
    const gaps = starts.slice(1).map((x, i) => x - starts[i])
    const spread = Math.max(...gaps) - Math.min(...gaps)
    expect(spread).toBeGreaterThan(2)
  })

  it('reaches out when she starts using a tool', () => {
    const m = createMind({ random: seeded(6) })
    const { t } = run(m, 1)
    m.work('start')
    const { s } = run(m, 0.5, t)
    expect(s.reach).toBeGreaterThan(0.5)
  })

  it('follows the voice level, quicker up than down', () => {
    const m = createMind({ random: seeded(7) })
    m.setState('speaking')
    m.setLevel(1)
    let { s, t } = run(m, 0.15)
    const rise = s.level
    m.setLevel(0)
    ;({ s } = run(m, 0.15, t))
    expect(rise).toBeGreaterThan(0.6)
    expect(1 - rise).toBeLessThan(rise - s.level + 0.5)
  })
})

describe('derivePalette', () => {
  const hueOf = ([r, g, b]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
    if (d < 1e-6) return null
    let h
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return ((h * 60) + 360) % 360
  }
  const dist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

  it('builds her around the universe colour', () => {
    const p = derivePalette('#cc2222')
    expect(dist(hueOf(p.c1), 0)).toBeLessThan(3)
  })

  it('keeps every hue in the same family — no clashing complement', () => {
    for (const primary of ['#cc2222', '#deb651', '#22cc44', '#e040c0', '#5ab4f5']) {
      const p = derivePalette(primary)
      const h = hueOf(p.c1)
      for (const c of [p.c0, p.c2, p.c3]) expect(dist(hueOf(c), h)).toBeLessThanOrEqual(50)
    }
  })

  it('leaves a grey universe grey', () => {
    const p = derivePalette('#c0c0c8')
    for (const c of [p.c0, p.c1, p.c2, p.c3]) {
      expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.15)
    }
  })

  it('accepts rgb() as well as hex, and survives garbage', () => {
    expect(derivePalette('rgb(204, 34, 34)').c1).toEqual(derivePalette('#cc2222').c1)
    expect(derivePalette('not a colour').c1).toHaveLength(3)
  })
})
