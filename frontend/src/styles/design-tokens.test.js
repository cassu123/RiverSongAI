/**
 * Guards for the two inline-style rules that keep getting broken.
 *
 * Both of these were fixed across the app once already. They came back the
 * next time a page was written by hand, because nothing failed when they did.
 * A build that passes is not evidence: an 8px label renders fine, it just
 * cannot be read.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === 'node_modules') return []
    if (statSync(full).isDirectory()) return jsxFiles(full)
    return name.endsWith('.jsx') ? [full] : []
  })
}

/** True when the JSX tag owning this offset is a Material Symbols glyph.
 *  Sizing an icon sets a box, not type, so the type floor does not apply. */
function isIconTag(src, pos) {
  const start = src.lastIndexOf('<', pos)
  return start !== -1 && pos - start < 600 && src.slice(start, pos).includes('material-symbols')
}

/** The bodies of every `style={{ ... }}` attribute in a source file. */
function styleSpans(src) {
  const spans = []
  let i = 0
  for (;;) {
    const start = src.indexOf('style={{', i)
    if (start === -1) return spans
    let depth = 0
    let p = start + 'style={'.length
    for (; p < src.length; p += 1) {
      if (src[p] === '{') depth += 1
      else if (src[p] === '}' && (depth -= 1) === 0) break
    }
    spans.push(src.slice(start, p + 1))
    i = p + 1
  }
}

const files = jsxFiles(SRC)

describe('inline styles', () => {
  it('finds the frontend sources', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  // --rs-fs-nano is 0.6875rem (11px) and is the floor of the type scale.
  it('sets no text smaller than the nano rung', () => {
    const FLOOR_REM = 0.6875
    const offenders = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const re = /\bfontSize\s*:\s*'([0-9.]+)(rem|px)'/g
      let m
      while ((m = re.exec(src)) !== null) {
        if (isIconTag(src, m.index)) continue
        const rem = m[2] === 'rem' ? Number(m[1]) : Number(m[1]) / 16
        if (rem < FLOOR_REM) {
          offenders.push(`${relative(SRC, file)}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // The veil/hairline/scrim tokens exist because a frozen white or black
  // wash cannot follow the environment. Only the bands those tokens actually
  // cover are checked: a 2% whisper or a deliberate 90% white wash is a
  // decision, and there is no token pretending to be it.
  it('draws no surface veil or hairline by hand', () => {
    const RGBA = /rgba\(\s*(255,\s*255,\s*255|0,\s*0,\s*0)\s*,\s*([0-9.]+)\s*\)/g
    const offenders = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const span of styleSpans(src)) {
        let m
        RGBA.lastIndex = 0
        while ((m = RGBA.exec(span)) !== null) {
          // Exempt what the tokens deliberately do not cover: a gradient
          // stop, and the colour of a shadow or filter — those are tuned per
          // effect, and pinning them to a shared scrim would change the blur
          // they were drawn against.
          const before = span.slice(0, m.index)
          const key = before.match(/([a-zA-Z]+)\s*:[^:]*$/)
          if (key && /^(boxShadow|textShadow|filter|backdropFilter)$/.test(key[1])) continue
          // Anything after the owning key, not just up to the next ')': a
          // gradient lists several stops and each one closes its own paren.
          if (key && before.slice(key.index).includes('gradient(')) continue
          const a = Number(m[2])
          const white = m[1].startsWith('255')
          const covered = white
            ? a >= 0.03 && a <= 0.14
            : (a >= 0.18 && a <= 0.3) || (a >= 0.5 && a <= 0.68) || (a >= 0.75 && a <= 0.85)
          if (covered) offenders.push(`${relative(SRC, file)}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // --md-shape-* covers 4, 8, 12, 14 and 20. A bare number within 3px of one
  // of those is that shape written out longhand.
  it('names no border radius that a shape token already covers', () => {
    const SHAPES = [4, 8, 12, 14, 20, 999]
    const offenders = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const span of styleSpans(src)) {
        const re = /\bborderRadius\s*:\s*'?(\d+)(?:px)?'?(?![\w.])/g
        let m
        while ((m = re.exec(span)) !== null) {
          const n = Number(m[1])
          if (SHAPES.some((s) => Math.abs(s - n) <= 3)) {
            offenders.push(`${relative(SRC, file)}: ${m[0]}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // Generic palette values belong in themes.css so every environment can move
  // them. Two things stay literal and are out of scope here: brand colours
  // (#96bf48, #0071dc, ...), and colours held in plain data objects — a chart
  // library passes those straight to an SVG attribute, where var() does not
  // resolve. So this reads style attributes only, not every object literal.
  it('names no generic colour that a theme token already covers', () => {
    const BANNED = /\b(?:color|borderColor)\s*:\s*'(grey|gray|#888|#888888|#f87171|#4ade80|#facc15|#00e5ff|rgba\(\s*220,\s*230,\s*245[^']*)'/g
    const offenders = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const span of styleSpans(src)) {
        let m
        BANNED.lastIndex = 0
        while ((m = BANNED.exec(span)) !== null) {
          offenders.push(`${relative(SRC, file)}: ${m[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
