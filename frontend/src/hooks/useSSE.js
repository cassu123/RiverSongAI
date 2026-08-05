import { useEffect, useRef } from 'react'

/**
 * Opens an SSE connection that closes when the tab is hidden and reopens
 * when the tab becomes visible again. Pass named event handlers as an object:
 *   { update: fn, ping: fn, message: fn, error: fn }
 * deps should include anything the url or handlers close over (token, id, etc.)
 */
export function useSSE(url, handlers, deps = []) {
  const esRef = useRef(null)
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers })

  useEffect(() => {
    if (!url) return

    function open() {
      if (esRef.current) esRef.current.close()
      const es = new EventSource(url)
      const h = handlersRef.current
      Object.entries(h).forEach(([event, fn]) => {
        if (event === 'message') es.onmessage = fn
        else if (event === 'error') es.onerror = fn
        else es.addEventListener(event, fn)
      })
      esRef.current = es
    }

    function handleVisibility() {
      if (document.hidden) {
        esRef.current?.close()
        esRef.current = null
      } else {
        open()
      }
    }

    if (!document.hidden) open()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      esRef.current?.close()
      esRef.current = null
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
