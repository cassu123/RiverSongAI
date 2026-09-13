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
    /* Was a nested .rs-card. A card inside a card gives the double-bezel
       treatment twice over, which is what made the Feeds tabs read as a stack
       of boxes-within-boxes; DESIGN.md 7 bans it outright. This is now a
       divider-delimited section instead. */
    <section className={`rs-tabset ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="rs-tabset-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="rs-flex rs-items-center rs-gap-2 rs-grow rs-min-w-0">
          {icon && (
            <span
              className="material-symbols-rounded rs-no-shrink"
              style={{ fontSize: '1rem', opacity: 0.55 }}
            >
              {icon}
            </span>
          )}
          <span
            className="rs-card-label rs-type-nano rs-nowrap rs-no-shrink"
            style={{ letterSpacing: '0.12em' }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              className="rs-card-meta rs-muted rs-type-nano rs-nowrap rs-clip rs-ellipsis rs-min-w-0"
              style={{
                marginLeft: 'var(--rs-space-2)',
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
      </button>
      {open && (
        <div className="rs-tabset-body animate-fade-in">
          {children}
        </div>
      )}
    </section>
  )
}

export function SettingsRow({ label, children }) {
  return (
    <div className="rs-mb-4">
      <div className="rs-mb-2 rs-muted rs-type-nano rs-fw-700" style={{ letterSpacing: '0.12em' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

export function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="rs-flex rs-gap-1">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="rs-grow rs-pointer rs-type-nano rs-fw-700" style={{
            padding: 'var(--rs-space-2) 0',
            borderRadius: 'var(--md-shape-sm)',
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
    <label className="rs-flex rs-items-center rs-gap-3 rs-pointer">
      <div
        onClick={() => onChange(!checked)}
        className="rs-relative rs-no-shrink" style={{
          width: 36,
          height: 20,
          borderRadius: 'var(--md-shape-sm)',
          background: checked ? 'var(--primary)' : 'var(--md-outline-variant)',
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: checked ? 19 : 3,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      {label && <span className="rs-type-micro">{label}</span>}
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
    <div className="rs-mt-2" style={{
      position: 'absolute',
      top: '100%',
      right: 0,
      zIndex: 100,
      background: 'var(--md-surface-container)',
      border: '1px solid var(--md-outline-variant)',
      borderRadius: 'var(--md-shape-md)',
      padding: 'var(--rs-space-4) var(--rs-space-5)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
      minWidth: 280,
      maxWidth: 340,
    }}>
      <div className="rs-flex rs-items-center rs-justify-between rs-mb-4">
        <span className="rs-muted rs-type-nano rs-fw-800" style={{ letterSpacing: '0.1em' }}>{title}</span>
        <button onClick={onClose} className="rs-p-1 rs-flex rs-pointer" style={{
          background: 'none',
          border: 'none',
          color: 'var(--md-on-surface-variant)',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
        </button>
      </div>
      {children}
    </div>
  )
}
