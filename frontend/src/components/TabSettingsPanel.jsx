import React, { useEffect, useState } from 'react'

/**
 * InlineSettingsSection — collapsible settings card rendered inside a tab's
 * content area (not a floating popover). Used by News/Weather/Sports/Stocks/
 * Flights tabs so per-tab configuration is discoverable without leaving the
 * tab body.
 */
export function InlineSettingsSection({
  title,
  subtitle,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  icon,
  children,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  return (
    <div className="rs-card" style={{ marginBottom: 20, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {icon && (
            <span
              className="material-symbols-rounded"
              style={{ fontSize: '1rem', opacity: 0.55, flexShrink: 0 }}
            >
              {icon}
            </span>
          )}
          <span
            className="rs-card-label"
            style={{ fontSize: '0.62rem', letterSpacing: '0.12em', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="rs-card-meta"
              style={{
                fontSize: '0.6rem', opacity: 0.5, marginLeft: 6,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        <span
          className="material-symbols-rounded"
          style={{
            fontSize: '1.1rem',
            color: 'var(--md-on-surface-variant)',
            transition: 'transform 0.22s ease',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        >
          expand_more
        </span>
      </div>
      {open && (
        <div
          className="animate-fade-in"
          style={{
            borderTop: '1px solid var(--md-outline-variant)',
            padding: '16px',
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function SettingsRow({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: '0.56rem', fontWeight: 700, letterSpacing: '0.12em', opacity: 0.45, marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

export function ToggleGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer',
            fontSize: '0.7rem', fontWeight: 700,
            border: value === opt.value ? '1px solid var(--primary)' : '1px solid var(--md-outline-variant)',
            background: value === opt.value ? 'rgba(var(--primary-rgb,100,100,255),0.12)' : 'transparent',
            color: value === opt.value ? 'var(--primary)' : 'var(--md-on-surface-variant)',
            transition: 'all 0.15s',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10, position: 'relative',
          background: checked ? 'var(--primary)' : 'var(--md-outline-variant)',
          transition: 'background 0.2s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      {label && <span style={{ fontSize: '0.75rem' }}>{label}</span>}
    </label>
  )
}

export default function TabSettingsPanel({ open, onClose, panelRef, title = 'SETTINGS', children }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef?.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose, panelRef])

  if (!open) return null

  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 100,
      background: 'var(--md-surface-container)',
      border: '1px solid var(--md-outline-variant)',
      borderRadius: 12, padding: '16px 18px', marginTop: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
      minWidth: 280, maxWidth: 340,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.1em', opacity: 0.6 }}>{title}</span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          color: 'var(--md-on-surface-variant)', display: 'flex',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
        </button>
      </div>
      {children}
    </div>
  )
}
