/**
 * useApi — shared HTTP helpers for flag-gated admin pages.
 *
 * Code review #15 extracted these to remove duplicated authHeaders +
 * 404→disabled boilerplate that lived in 7 new pages (Documents, Skills,
 * Presets, Compare, Research, RemoteOllama, WebhookTokens).
 *
 *   useAuthHeaders()                 — JSON + Bearer headers, memoized.
 *   API_BASE                         — the same Vite env value the pages used.
 *   useFlagGatedFetch({ url })       — tracks loading / disabled (404) /
 *                                      error, returns { loading, disabled,
 *                                      error, data, refresh, setError }.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'

export const API_BASE = import.meta.env.VITE_API_URL || ''

export function useAuthHeaders() {
  const { token } = useAuth()
  return useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
  }), [token])
}

/**
 * Fetch a probe URL once on mount + on demand.
 * A 404 sets `disabled=true` so the page can render a "feature off" notice
 * without each page re-implementing the same logic.
 */
export function useFlagGatedFetch({ url, deps = [], parser }) {
  const authHeaders   = useAuthHeaders()
  const [data,        setData]     = useState(null)
  const [loading,     setLoading]  = useState(true)
  const [disabled,    setDisabled] = useState(false)
  const [error,       setError]    = useState('')

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: authHeaders() })
      if (res.status === 404) {
        setDisabled(true); setLoading(false); return
      }
      if (!res.ok) throw new Error('Request failed.')
      const json = await res.json()
      setData(parser ? parser(json) : json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, authHeaders, ...deps])

  useEffect(() => { refresh() }, [refresh])

  return useMemo(() => ({
    loading, disabled, error, data, refresh, setError, setData,
  }), [loading, disabled, error, data, refresh])
}
