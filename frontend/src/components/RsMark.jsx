import React from 'react'
import './RsMark.css'

/**
 * RsMark — the River Song logo that morphs by environment.
 *
 * Props:
 *   mark: 'full' | 'mono' | 'fragment'   default 'mono'
 *     - 'mono'     : compact RS monogram (sidebar)
 *     - 'full'     : larger RIVER · SONG wordmark (page header / login)
 *     - 'fragment' : a single styled glyph (micro indicators, favicons)
 *   size: number — base px size of the mono mark; 'full' scales relatively.
 *   ariaLabel: string — accessibility label.
 *
 * All visual variation is driven by the `data-env` attribute on <html>.
 * No SVG assets — everything is CSS clip-paths, pseudo-elements, and
 * type treatment. Drop-in replaceable later by swapping the rendered
 * span for an <svg>.
 */
export default function RsMark({ mark = 'mono', size = 36, ariaLabel = 'River Song' }) {
  return (
    <span
      className={`rs-mark rs-mark--${mark}`}
      style={{ '--rs-mark-size': `${size}px` }}
      role="img"
      aria-label={ariaLabel}
      data-mark={mark}
    >
      <span className="rs-mark-glyph rs-mark-glyph--r">R</span>
      <span className="rs-mark-glyph rs-mark-glyph--s">S</span>
      {mark === 'full' && (
        <>
          <span className="rs-mark-divider" aria-hidden="true" />
          <span className="rs-mark-wordmark">
            <span className="rs-mark-word">RIVER</span>
            <span className="rs-mark-dot" aria-hidden="true">·</span>
            <span className="rs-mark-word">SONG</span>
          </span>
        </>
      )}
    </span>
  )
}
