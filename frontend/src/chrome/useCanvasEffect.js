import { useEffect } from 'react'

/**
 * Shared boilerplate for every Stage scene's particle field.
 *
 * Caller passes an init(ctx, w, h) that returns a step() function.
 * The hook handles ResizeObserver, devicePixelRatio cap (1.5 — S24 Ultra
 * sweet spot), RAF loop, and cleanup. Each scene only writes its particle
 * logic; the engine plumbing lives here.
 */
export default function useCanvasEffect(canvasRef, init) {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
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
      step = init(ctx, w, h)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    function loop() {
      if (step) step()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [init, canvasRef])
}
