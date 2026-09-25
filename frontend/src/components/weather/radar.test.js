import { describe, it, expect } from 'vitest'
import { inConus, iemFrames, rainviewerFrames } from './radar.js'

describe('radar sources', () => {
  it('uses NEXRAD over the lower 48 only', () => {
    expect(inConus(34.87, -92.11)).toBe(true)    // Jacksonville, AR
    expect(inConus(51.5, -0.12)).toBe(false)     // London
    expect(inConus(21.3, -157.8)).toBe(false)    // Honolulu: not in the mosaic
  })

  it('loops the last 50 minutes of NEXRAD, oldest first', () => {
    const f = iemFrames(1_000_000_000)
    expect(f).toHaveLength(6)
    expect(f[0].url).toContain('/nexrad-n0q-900913-m50m/{z}/{x}/{y}.png')
    expect(f[4].url).toContain('/nexrad-n0q-900913-m10m/')
    expect(f[5].url).toContain('/nexrad-n0q-900913/{z}')
    expect(f[5].time - f[0].time).toBe(50 * 60_000)
  })

  it("builds RainViewer frames from its own host, in its one remaining scheme", () => {
    const f = rainviewerFrames({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: 100, path: '/v2/radar/a' }, { time: 700, path: '/v2/radar/b' }] },
    })
    expect(f).toEqual([
      { url: 'https://tilecache.rainviewer.com/v2/radar/a/256/{z}/{x}/{y}/2/1_1.png', time: 100_000 },
      { url: 'https://tilecache.rainviewer.com/v2/radar/b/256/{z}/{x}/{y}/2/1_1.png', time: 700_000 },
    ])
    expect(rainviewerFrames(null)).toEqual([])
  })
})
