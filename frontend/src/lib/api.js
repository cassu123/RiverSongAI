/**
 * lib/api.js — the one way to call the backend.
 *
 *   import { apiFetch, toast } from '../lib/api'
 *
 *   const data = await apiFetch('/api/settings/llm')            // GET, parsed JSON
 *   await apiFetch('/api/auth/profile', { method: 'PATCH', body: { mood } })
 *
 * What it does for every call:
 *   - attaches the Bearer token from localStorage
 *   - JSON-encodes plain-object bodies and sets Content-Type
 *   - checks res.ok and throws ApiError(status, detail) on failure
 *   - surfaces failures as a visible toast (unless { silent: true })
 *
 * Complements utils/useApi.js (hook-based helpers for flag-gated pages);
 * new code should prefer this module.
 */

export const API_BASE = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'rs-auth-token'

export class ApiError extends Error {
  constructor(status, detail, url) {
    super(detail || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.url = url
  }
}

/** Show a toast. kind: 'error' | 'success' | 'info' */
export function toast(message, kind = 'error') {
  window.dispatchEvent(new CustomEvent('rs-toast', { detail: { message, kind } }))
}

export async function apiFetch(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    signal,
    silent = false,   // suppress the error toast (caller renders its own error UI)
    raw = false,      // return the Response instead of parsed JSON
  } = options

  const token = localStorage.getItem(TOKEN_KEY)
  const finalHeaders = { ...headers }
  if (token && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${token}`
  }

  let finalBody = body
  const isPlainObject = body && typeof body === 'object' &&
    !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)
  if (isPlainObject) {
    finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json'
    finalBody = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers: finalHeaders, body: finalBody, signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    if (!silent) toast('Network error — could not reach River Song.')
    console.error(`[api] ${method} ${path} network error:`, err)
    throw new ApiError(0, 'Network error', path)
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.clone().json()
      if (data?.detail) detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch { /* non-JSON error body */ }
    const err = new ApiError(res.status, detail, path)
    if (!silent) toast(detail)
    console.error(`[api] ${method} ${path} failed:`, detail)
    throw err
  }

  if (raw) return res
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
