import { useEffect, useRef } from 'react'

/**
 * Manage a responsive, animated canvas particle field.
 *
 * Reinitializes the field when the canvas size changes, caps the device pixel
 * ratio at 1.5, and pauses animation while the document is hidden.
 *
 * @param {React.RefObject<HTMLCanvasElement>} canvasRef - Ref to the canvas element.
 * @param {function(CanvasRenderingContext2D, number, number): function} init - Initializes the particle field and returns a frame-step function.
 */
export default function useCanvasEffect(canvasRef, init) {
  const initRef = useRef(init)
  initRef.current = init

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
      if (initRef.current) {
        step = initRef.current(ctx, w, h)
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    /**
     * Advances the canvas animation while the document is visible.
     */
    function loop() {
      if (document.hidden) {
        raf = 0
        return
      }
      if (step) {
        step()
      }
      raf = requestAnimationFrame(loop)
    }

    function onVisibilityChange() {
      if (!document.hidden && !raf) {
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    if (!document.hidden) {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      ro.disconnect()
    }
  }, [canvasRef])
}
