import { useEffect, useRef } from 'react'

/** Body class that freezes every Stage particle field (set by useBackdropIdle
    while a Drawer/Sheet covers the backdrop with heavy glass blur). */
export const BACKDROP_IDLE_CLASS = 'rs-backdrop-idle'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Shared boilerplate for every Stage scene's particle field.
 *
 * Caller passes an init(ctx, w, h) that returns a step() function.
 * The hook handles ResizeObserver, devicePixelRatio cap (1.5 — S24 Ultra
 * sweet spot), RAF loop, and cleanup. Each scene only writes its particle
 * logic; the engine plumbing lives here.
 *
 * The latest init is read through a ref, so a parent re-render (which
 * recreates the inline init closure) does NOT tear down and reseed the
 * particle field — the loop only restarts on real resize or remount.
 *
 * Respects prefers-reduced-motion: a single frame is drawn so the scene
 * keeps its depth, then the loop stays parked (and resumes live if the
 * user flips the OS setting back). While <body> carries rs-backdrop-idle
 * the loop idles without stepping, so glass overlays above the stage stop
 * forcing per-frame backdrop re-blurs.
 */
export default function useCanvasEffect(canvasRef, init) {
  const initRef = useRef(init)
  initRef.current = init

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY)
    let raf = 0
    let step = null

    function resize() {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      if (w === 0 || h === 0) return
      canvas.width  = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      step = initRef.current(ctx, w, h)
      if (reduced.matches && step) step()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    function loop() {
      if (
        step &&
        !reduced.matches &&
        !document.body.classList.contains(BACKDROP_IDLE_CLASS)
      ) {
        step()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [canvasRef])
}
