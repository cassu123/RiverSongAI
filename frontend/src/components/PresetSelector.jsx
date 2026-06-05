import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * PresetSelector — Q2#9.
 *
 * Tiny pill that opens a popover listing the user's saved session
 * presets. Apply persists the model/voice subset; non-persistent
 * fields (thinking, web_search, tool_use) come back as
 * `session_overlay` for the caller to apply locally if it cares.
 *
 * Hidden entirely when the feature is disabled — the /api/presets
 * route returns 404 in that case.
 */

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function PresetSelector({ onApply, onManage }) {
  const { token } = useAuth()
  const [available, setAvailable] = useState(null)  // null=unknown, false=disabled, true=enabled
  const [presets,   setPresets]   = useState([])
  const [open,      setOpen]      = useState(false)
  const [applying,  setApplying]  = useState(null)

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${token}`,
  }), [token])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/presets`, { headers: authHeaders() })
      if (res.status === 404) { setAvailable(false); return }
      if (!res.ok) return
      const data = await res.json()
      setPresets(data.presets || [])
      setAvailable(true)
    } catch {
      setAvailable(false)
    }
  }, [authHeaders])

  useEffect(() => { load() }, [load])

  if (available !== true) return null

  const apply = async (p) => {
    setApplying(p.id)
    try {
      const res = await fetch(`${API_BASE}/api/presets/${p.id}/apply`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error('Apply failed.')
      const data = await res.json()
      setOpen(false)
      if (onApply) onApply(data)
    } catch (e) {
      console.error(e)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="rs-pill"
        onClick={() => setOpen(o => !o)}
        title="Session presets"
        style={{ fontSize: '0.7rem' }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', marginRight: 4 }}>tune</span>
        <span className="rs-speak-actions-label">Presets</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={() => setOpen(false)} />
          <div
            className="rs-card"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              right: 0,
              zIndex: 9999,
              minWidth: 240,
              padding: 10,
              background: 'var(--md-surface-container-highest)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
            }}
          >
            <div className="rs-card-label" style={{ marginBottom: 6 }}>SESSION PRESETS</div>
            {presets.length === 0 && (
              <div className="rs-card-meta" style={{ padding: 8 }}>No presets yet.</div>
            )}
            {presets.map(p => (
              <button
                key={p.id}
                className="rs-drawer-item"
                onClick={() => apply(p)}
                disabled={applying === p.id}
                style={{ textAlign: 'left', width: '100%', padding: '8px 10px' }}
              >
                <span style={{ fontWeight: 700, fontSize: '0.78rem', flex: 1 }}>
                  {p.is_default && <span style={{ marginRight: 4, opacity: 0.7 }}>★</span>}
                  {p.name}
                </span>
                {applying === p.id && <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>APPLYING…</span>}
              </button>
            ))}
            {onManage && (
              <button
                className="rs-drawer-item"
                onClick={() => { setOpen(false); onManage() }}
                style={{ textAlign: 'left', width: '100%', padding: '8px 10px', opacity: 0.7, borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 }}
              >
                <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>+ MANAGE PRESETS</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
