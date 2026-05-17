import React from 'react'

/**
 * PreviewGrade — single film-grade overlay above every scene.
 *
 * Three layers, all pointer-events: none, mixed onto the stage:
 *   1. feTurbulence film grain   — breaks flat color fields
 *   2. Atmospheric haze band     — depth across the horizon
 *   3. Soft chromatic vignette   — pulls attention inward
 *
 * One overlay across all 8 scenes lifts every one off "flat poster"
 * toward "movie still" without touching scene internals.
 */
export default function PreviewGrade() {
  return (
    <>
      {/* Film grain — static (not animated); inexpensive */}
      <svg className="rs-grade rs-grade-grain" aria-hidden="true" preserveAspectRatio="none">
        <defs>
          <filter id="rs-film-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              seed="7"
              stitchTiles="stitch"
            />
            <feColorMatrix
              values="0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0.11 0"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#rs-film-grain)" />
      </svg>

      {/* Atmospheric haze band across the horizon — depth + warmth */}
      <div className="rs-grade rs-grade-haze" />

      {/* Soft chromatic vignette — pulls eye inward, hides edge fall-off */}
      <div className="rs-grade rs-grade-vignette" />
    </>
  )
}
