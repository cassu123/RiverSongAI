// ToastHost — renders toasts dispatched via lib/api.js `toast()`.
// Mount once near the root (App.jsx). Stacks up to 4, auto-dismisses.

import { useEffect, useState } from 'react'

const KIND_COLORS = {
  error:   { border: '#c53a1f', text: '#ffb4a3' },
  success: { border: '#3dcc79', text: '#b6f0cf' },
  info:    { border: '#7888f8', text: '#c5ccff' },
}

let nextId = 1

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    const onToast = (e) => {
      const { message, kind = 'error' } = e.detail || {}
      if (!message) return
      const id = nextId++
      setToasts(prev => [...prev.slice(-3), { id, message, kind }])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 6000)
    }
    window.addEventListener('rs-toast', onToast)
    return () => window.removeEventListener('rs-toast', onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380,
    }}>
      {toasts.map(t => {
        const c = KIND_COLORS[t.kind] || KIND_COLORS.error
        return (
          <div
            key={t.id}
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
            style={{
              padding: '10px 14px',
              background: 'rgba(10, 10, 14, 0.92)',
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              color: c.text,
              fontSize: '0.8rem',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            }}
          >
            {t.message}
          </div>
        )
      })}
    </div>
  )
}
