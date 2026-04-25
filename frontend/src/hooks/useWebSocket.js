// =============================================================================
// src/hooks/useWebSocket.js
//
// React hook that manages a WebSocket connection to the River Song backend.
//
// Features:
//   - Auto-reconnect on unclean close (up to MAX_RECONNECT_ATTEMPTS)
//   - Exponential-ish backoff via RECONNECT_DELAY_MS
//   - Exposes connectionStatus: 'connected'|'disconnected'|'reconnecting'|'error'
//   - sendMessage() serializes a JS object to JSON and sends it
//   - Cleans up cleanly on component unmount
//
// Usage:
//   const { sendMessage, connectionStatus } = useWebSocket(url, onMessage)
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'

const RECONNECT_DELAY_MS       = 3000
const MAX_RECONNECT_ATTEMPTS   = 5

export function useWebSocket(url, onMessage) {
  const [connectionStatus, setConnectionStatus] = useState('disconnected')

  const wsRef              = useRef(null)
  const reconnectCountRef  = useRef(0)
  const reconnectTimerRef  = useRef(null)
  const isMountedRef       = useRef(true)

  // Wrap connect in useCallback so the useEffect dependency array is stable
  const connect = useCallback(() => {
    if (!isMountedRef.current) return

    try {
      const parsed = new URL(url, window.location.href)
      if (parsed.hostname !== window.location.hostname) {
        console.error('[useWebSocket] Blocked connection to non-same-origin host:', parsed.hostname)
        setConnectionStatus('error')
        return
      }
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMountedRef.current) return
        reconnectCountRef.current = 0
        setConnectionStatus('connected')
      }

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return
        try {
          const data = JSON.parse(event.data)
          if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            console.error('[useWebSocket] Rejected non-object message')
            return
          }
          if ('__proto__' in data || 'constructor' in data || 'prototype' in data) {
            console.error('[useWebSocket] Rejected message with dangerous keys')
            return
          }
          onMessage(data)
        } catch (err) {
          console.error('[useWebSocket] Failed to parse incoming message:', event.data, err)
        }
      }

      ws.onclose = (event) => {
        if (!isMountedRef.current) return
        setConnectionStatus('disconnected')

        // Only reconnect on unclean closes and within attempt limit
        const shouldReconnect =
          !event.wasClean &&
          reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS

        if (shouldReconnect) {
          reconnectCountRef.current += 1
          setConnectionStatus('reconnecting')
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }

      ws.onerror = () => {
        if (!isMountedRef.current) return
        // onerror is always followed by onclose, so let onclose handle reconnect
        setConnectionStatus('error')
      }

    } catch (err) {
      console.error('[useWebSocket] Failed to create WebSocket:', err)
      setConnectionStatus('error')
    }
  }, [url, onMessage])

  useEffect(() => {
    isMountedRef.current = true
    connect()

    return () => {
      isMountedRef.current = false
      clearTimeout(reconnectTimerRef.current)

      if (wsRef.current) {
        // Null the onclose handler so the cleanup close does not trigger reconnect
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  const sendMessage = useCallback((payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
    } else {
      console.warn('[useWebSocket] Cannot send -- socket is not open. State:', wsRef.current?.readyState)
    }
  }, [])

  return { sendMessage, connectionStatus }
}
