import React from 'react'
import RsMark from '../components/RsMark.jsx'
import EnvIcon from './EnvIcon.jsx'

const PRIMARY = [
  { key: 'speak',    label: 'Speak' },
  { key: 'memory',   label: 'Memory' },
  { key: 'home',     label: 'Home Node' },
  { key: 'chronos',  label: 'CHRONOS' },
  { key: 'pulse',    label: 'Pulse' },
  { key: 'routines', label: 'Routines' },
]

const SECONDARY = [
  { key: 'inventory',   label: 'Inventory' },
  { key: 'culinary',    label: 'Culinary' },
  { key: 'garage',      label: 'Garage' },
  { key: 'store',       label: 'Store' },
  { key: 'analytics',   label: 'Analytics' },
  { key: 'feeds',       label: 'Feeds' },
  { key: 'sifter',      label: 'Sifter' },
  { key: 'reading',     label: 'Reading' },
  { key: 'dreamscape',  label: 'Dreamscape' },
  { key: 'environment', label: 'Environment' },
]

const ADMIN = [
  { key: 'settings', label: 'Settings' },
  { key: 'logout',   label: 'Logout' },
]

export default function PreviewDrawer({ open, onClose, active, onNavigate }) {
  return (
    <>
      <div
        className={`rs-drawer-scrim ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <nav
        className={`rs-drawer ${open ? 'is-open' : ''}`}
        aria-label="Primary"
        aria-hidden={!open}
      >
        <div className="rs-drawer-head">
          <span className="rs-drawer-title">
            <RsMark mark="mono" size={28} />
            <span>River Song</span>
          </span>
          <button className="rs-drawer-close" onClick={onClose} aria-label="Close">
            <EnvIcon name="close" />
          </button>
        </div>

        <div className="rs-drawer-section" role="group" aria-labelledby="rs-section-primary">
          <h3 id="rs-section-primary" className="rs-drawer-section-label">Primary</h3>
          <div className="rs-drawer-list">
            {PRIMARY.map(it => (
              <button
                key={it.key}
                className={`rs-drawer-item ${active === it.key ? 'is-active' : ''}`}
                onClick={() => onNavigate(it.key)}
              >
                <EnvIcon name={it.key} className="rs-icon" />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rs-drawer-section" role="group" aria-labelledby="rs-section-tools">
          <h3 id="rs-section-tools" className="rs-drawer-section-label">Tools</h3>
          <div className="rs-drawer-grid">
            {SECONDARY.map(it => (
              <button
                key={it.key}
                className={`rs-drawer-item rs-drawer-item--compact ${active === it.key ? 'is-active' : ''}`}
                onClick={() => onNavigate(it.key)}
              >
                <EnvIcon name={it.key} className="rs-icon" />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rs-drawer-section" role="group" aria-labelledby="rs-section-account">
          <h3 id="rs-section-account" className="rs-drawer-section-label">Account</h3>
          <div className="rs-drawer-list">
            {ADMIN.map(it => (
              <button
                key={it.key}
                className="rs-drawer-item"
                onClick={() => onNavigate(it.key)}
              >
                <EnvIcon name={it.key} className="rs-icon" />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
    </>
  )
}
