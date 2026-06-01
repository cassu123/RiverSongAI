import { useEffect, useRef } from 'react'

/**
 * Like setInterval but pauses automatically when the tab is hidden and
 * resumes (with an immediate tick) when the tab becomes visible again.
 * Pass delay=null to disable without changing hook call order.
 */
export function useInterval(fn, delay) {
  const saved = useRef(fn)
  useEffect(() => { saved.current = fn }, [fn])

  useEffect(() => {
    if (delay == null) return

    let id = null

    const tick = () => { if (!document.hidden) saved.current() }
    const start = () => { id = setInterval(tick, delay) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }

    const handleVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        saved.current() // immediate tick on returning to tab
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [delay])
}
