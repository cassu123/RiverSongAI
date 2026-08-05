import React from 'react'
import EnvIcon from './EnvIcon.jsx'

/**
 * Sheet — bottom sheet primitive. Used for model selector, attach picker,
 * env switcher, and any short-lived contextual choice surface.
 *
 * Shares DNA with Drawer: same scrim, same glass material, same row hover.
 * Slides up from bottom on mobile, anchors center-bottom on desktop.
 */
export default function Sheet({ open, onClose, title, children }) {
  return (
    <>
      <div
        className={`rs-sheet-scrim ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        className={`rs-sheet ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Sheet'}
      >
        <div className="rs-sheet-handle" aria-hidden="true" />
        {title && (
          <header className="rs-sheet-head">
            <h2 className="rs-sheet-title">{title}</h2>
          </header>
        )}
        <div className="rs-sheet-body">{children}</div>
      </div>
    </>
  )
}

/** SheetRow — interactive option row. Same DNA as drawer items. */
export function SheetRow({ icon, title, sub, active, onClick, badge, dimmed, chevron }) {
  return (
    <button
      className={`rs-sheet-row ${active ? 'is-active' : ''} ${dimmed ? 'is-dimmed' : ''}`}
      onClick={onClick}
    >
      {icon && <EnvIcon name={icon} className="rs-sheet-row-icon" />}
      <div className="rs-sheet-row-body">
        <div className="rs-sheet-row-title">
          {title}
          {badge && <span className="rs-sheet-row-badge">{badge}</span>}
        </div>
        {sub && <div className="rs-sheet-row-sub">{sub}</div>}
      </div>
      {active && <EnvIcon name="check" className="rs-sheet-check" />}
      {chevron && !active && <EnvIcon name="chevron_right" className="rs-sheet-chevron" />}
    </button>
  )
}
