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

export function useWebSocket(baseUrl, onMessage, options = {}) {
  const { token, kioskToken } = options
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [authError, setAuthError] = useState(false)

  const wsRef              = useRef(null)
  const reconnectCountRef  = useRef(0)
  const reconnectTimerRef  = useRef(null)
  const isMountedRef       = useRef(true)

  // Wrap connect in useCallback so the useEffect dependency array is stable
  const connect = useCallback(async () => {
    if (!isMountedRef.current) return

    let ticket = null
    try {
      // 1. Exchange token for ticket if needed
      if (token) {
        const res = await fetch('/api/auth/ws-ticket', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          ticket = data.ticket
        }
      } else if (kioskToken) {
        const res = await fetch('/api/auth/ws-ticket/kiosk', {
          method: 'POST',
          headers: { 'X-Kiosk-Token': kioskToken }
        })
        if (res.ok) {
          const data = await res.json()
          ticket = data.ticket
        }
      }

      // 2. Build full URL with ticket
      const url = new URL(baseUrl, window.location.href)
      if (ticket) {
        url.searchParams.set('ticket', ticket)
      } else if (!token && !kioskToken) {
        // Fallback for anonymous connection if any exist (none today)
      } else {
        // We expected a ticket but didn't get one. 
        // Fallback to legacy ?token= if configured on server (handled by server)
        if (token) url.searchParams.set('token', token)
        if (kioskToken) url.searchParams.set('token', kioskToken)
      }

      if (url.hostname !== window.location.hostname) {
        console.error('[useWebSocket] Blocked connection to non-same-origin host:', url.hostname)
        setConnectionStatus('error')
        return
      }

      const ws = new WebSocket(url.toString())
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMountedRef.current) return
        reconnectCountRef.current = 0
        setAuthError(false)
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

        // Code 4001 is our custom "Authentication Required / Invalid" code
        if (event.code === 4001) {
          setAuthError(true)
          if (token) {
            localStorage.removeItem('rs-auth-token')
            localStorage.removeItem('rs-auth-user')
          }
          return // Do not attempt to reconnect
        }

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
  }, [baseUrl, onMessage, token, kioskToken])

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

  return { sendMessage, connectionStatus, authError }
}
