import { useEffect, useRef, useState } from 'react'
import { getRiverMind } from './riverMind.js'
import { createOrbRenderer, derivePalette } from './riverOrbGL.js'

/**
 * RiverOrb — River's placeholder body until her avatar exists.
 *
 * The element's CSS box decides how big she is; the canvas fills it and she
 * sizes herself to the short side, leaving room around her for glow and for
 * the ribbons to reach out. The canvas is transparent: she sits on whatever is
 * behind her.
 *
 *   detail="compact"  the dock — body, eyes and a light particle shell
 *   detail="full"     the Voice stage — everything, including her ribbons
 *
 * Behaviour comes from the shared mind (riverMind.js), so every orb on the
 * page is the same River doing the same thing. Colour comes from the active
 * universe's --primary and eases across when the universe changes.
 *
 * Cost control: 30 fps while she is idle and nothing is happening, no frames
 * at all while she is off screen or the tab is hidden, device-pixel ratio
 * capped (1.25 on the stage — she is soft light, extra pixels buy nothing).
 */
export default function RiverOrb({ detail = 'full', className = '', label }) {
  const canvasRef = useRef(null)
  const [fallback, setFallback] = useState(false)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    let renderer = null
    try {
      renderer = createOrbRenderer(canvas, { detail })
    } catch (err) {
      console.warn('[RiverOrb] could not build the renderer; using the still fallback.', err)
    }
    if (!renderer) { setFallback(true); return undefined }

    const mind = getRiverMind()
    const root = document.documentElement

    const readPalette = () =>
      renderer.setPalette(derivePalette(getComputedStyle(root).getPropertyValue('--primary')))
    readPalette()
    const themeWatch = new MutationObserver(readPalette)
    themeWatch.observe(root, { attributes: true, attributeFilter: ['data-universe', 'data-env', 'data-mood', 'data-theme', 'class', 'style'] })

    const maxDpr = detail === 'compact' ? 2 : 1.25
    // Layout size, not getBoundingClientRect: pages scale in on entry
    // (.page-enter), and a transformed size would leave the canvas short
    // of its box — and soft — after the animation ends.
    const fit = () =>
      renderer.resize(canvas.offsetWidth, canvas.offsetHeight, Math.min(window.devicePixelRatio || 1, maxDpr))
    fit()
    const resizeWatch = new ResizeObserver(fit)
    resizeWatch.observe(canvas)

    let raf = 0
    let lastDraw = 0
    let onScreen = true
    let pageVisible = document.visibilityState !== 'hidden'

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const s = mind.tick(now)
      if (s.calm && now - lastDraw < 32) return
      const dt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 1 / 60
      lastDraw = now
      renderer.render(s, dt)
    }
    const start = () => { if (!raf && onScreen && pageVisible) raf = requestAnimationFrame(frame) }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }

    const viewWatch = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      onScreen ? start() : stop()
    })
    viewWatch.observe(canvas)
    const onVisibility = () => {
      pageVisible = document.visibilityState !== 'hidden'
      pageVisible ? start() : stop()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Phones drop GL contexts under memory pressure. Rebuild when it comes
    // back rather than leaving a hole where River was.
    let lost = false
    const onLost = (e) => { e.preventDefault(); lost = true; stop() }
    const onRestored = () => setGeneration((g) => g + 1)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    start()

    return () => {
      stop()
      themeWatch.disconnect()
      resizeWatch.disconnect()
      viewWatch.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      renderer.destroy()
      // Release the context only if the canvas has really left the page. In
      // StrictMode's double mount, and after a context restore, the same
      // canvas is set up again at once and needs it.
      setTimeout(() => { if (!lost && !canvas.isConnected) renderer.release() }, 0)
    }
  }, [detail, generation])

  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }

  if (fallback) {
    return <span className={`rs-river-orb is-fallback ${className}`.trim()} {...a11y} />
  }
  return <canvas ref={canvasRef} className={`rs-river-orb ${className}`.trim()} {...a11y} />
}
