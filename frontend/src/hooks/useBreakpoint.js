/**
 * useBreakpoint — consistent, JS-side responsive state.
 *
 * The app is CSS-media-query driven; use this ONLY when a component must change
 * behavior (not just style) by size — e.g. render a drawer vs a permanent rail,
 * or collapse a multi-column control into a menu. For pure visual reflow, prefer
 * CSS (.rs-auto-grid, clamp()) instead.
 *
 * Values are the single source of truth mirrored in src/styles/breakpoints.css.
 * Keep the two in sync.
 */
import { useState, useEffect } from 'react'

export const BREAKPOINTS = { xs: 380, sm: 480, md: 768, lg: 1024, xl: 1200 }

/** Subscribe to a media-query string; returns whether it currently matches. */
export function useMediaQuery(query) {
  const get = () =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false

  const [matches, setMatches] = useState(get)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/**
 * Semantic breakpoint flags aligned to the shell:
 *   isPhone   < 768   (off-canvas drawer)
 *   isTablet  768–1199
 *   isDesktop >= 1200 (permanent rail)
 * For a one-off custom size, call useMediaQuery(...) directly at the top level
 * of your component (never conditionally — Rules of Hooks).
 */
export function useBreakpoint() {
  const isPhone = useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`)
  const isTablet = useMediaQuery(
    `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.xl - 1}px)`
  )
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.xl}px)`)

  return { isPhone, isTablet, isDesktop }
}

export default useBreakpoint
