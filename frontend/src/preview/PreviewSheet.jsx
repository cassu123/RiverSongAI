import React from 'react'
import EnvIcon from './EnvIcon.jsx'

/**
 * PreviewSheet — bottom sheet primitive.
 * Used for model selector (two-step) and attachment picker.
 */
export default function PreviewSheet({ open, onClose, title, children }) {
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

export function SheetRow({ icon, title, sub, active, onClick }) {
  return (
    <button className={`rs-sheet-row ${active ? 'is-active' : ''}`} onClick={onClick}>
      {icon && <EnvIcon name={icon} className="rs-sheet-row-icon" />}
      <div className="rs-sheet-row-body">
        <div className="rs-sheet-row-title">{title}</div>
        {sub && <div className="rs-sheet-row-sub">{sub}</div>}
      </div>
      {active && <EnvIcon name="check" className="rs-sheet-check" />}
    </button>
  )
}
