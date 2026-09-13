import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@context/AuthContext.jsx'
import { useBreakpoint } from '@hooks/useBreakpoint'

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
  const { isPhone } = useBreakpoint()

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
    <div className="rs-relative" style={{ display: 'inline-block' }}>
      <button
        className="rs-pill rs-type-nano"
        onClick={() => setOpen(o => !o)}
        title="Session presets"
       
      >
        <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', marginRight: 'var(--rs-space-1)' }}>tune</span>
        <span className="rs-speak-actions-label">Presets</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={() => setOpen(false)} />
          <div
            className="rs-card rs-p-3"
            style={{
              zIndex: 9999,
              background: 'var(--md-surface-container-highest)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
              // On phones this anchored dropdown (right:0, 240px wide) overflows
              // off the left edge — render it as a full-width bottom sheet.
              ...(isPhone
                ? { position: 'fixed', left: 12, right: 12, bottom: 12, minWidth: 0, maxHeight: '60vh', overflowY: 'auto' }
                : { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, minWidth: 240 }),
            }}
          >
            <div className="rs-card-label rs-mb-2">SESSION PRESETS</div>
            {presets.length === 0 && (
              <div className="rs-card-meta rs-p-2">No presets yet.</div>
            )}
            {presets.map(p => (
              <button
                key={p.id}
                className="rs-drawer-item rs-w-full rs-text-left"
                onClick={() => apply(p)}
                disabled={applying === p.id}
                style={{ padding: 'var(--rs-space-2) var(--rs-space-3)' }}
              >
                <span className="rs-grow rs-type-micro rs-fw-700">
                  {p.is_default && <span style={{ marginRight: 'var(--rs-space-1)', opacity: 0.7 }}>★</span>}
                  {p.name}
                </span>
                {applying === p.id && <span className="rs-muted rs-type-nano">APPLYING…</span>}
              </button>
            ))}
            {onManage && (
              <button
                className="rs-drawer-item rs-w-full rs-mt-1 rs-text-left"
                onClick={() => { setOpen(false); onManage() }}
                style={{ padding: 'var(--rs-space-2) var(--rs-space-3)', opacity: 0.7, borderTop: '1px solid var(--rs-hairline)' }}
              >
                <span className="rs-type-nano rs-fw-700">+ MANAGE PRESETS</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
