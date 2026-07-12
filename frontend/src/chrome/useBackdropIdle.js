import { useEffect } from 'react'
import { BACKDROP_IDLE_CLASS } from './useCanvasEffect.js'

/**
 * While `active`, marks <body> with rs-backdrop-idle so the Stage freezes:
 * useCanvasEffect parks its particle loops and chrome-stage.css pauses the
 * CSS keyframe layers. Heavy glass surfaces (Drawer, Sheet) sit above the
 * whole backdrop with 30–40px blurs — re-blurring a moving scene every
 * frame is the single most expensive thing the UI does, and behind that
 * much glass the motion is invisible anyway.
 *
 * Ref-counted so overlapping overlays don't unfreeze each other early.
 */
let holders = 0

export default function useBackdropIdle(active) {
  useEffect(() => {
    if (!active) return
    holders += 1
    document.body.classList.add(BACKDROP_IDLE_CLASS)
    return () => {
      holders -= 1
      if (holders <= 0) {
        holders = 0
        document.body.classList.remove(BACKDROP_IDLE_CLASS)
      }
    }
  }, [active])
}
