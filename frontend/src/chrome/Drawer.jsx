import React from 'react'
import RsMark from '@components/RsMark.jsx'
import EnvIcon from './EnvIcon.jsx'
import { NAV_GROUPS, ALWAYS_VISIBLE } from '../utils/constants.js'

/**
 * Drawer — Google Spaces & Services Launcher Sheet
 *
 * Provides instant access to all hubs and capabilities (Kitchen, Garage, Stash,
 * Notes, Reading, Feeds, Store, Routines, Analytics, etc.) in a tactile
 * Material 3 grid sheet, with quick account and admin controls at the base.
 */
export default function Drawer({
  open,
  onClose,
  currentPage,
  onNavigate,
  adminMode,
  userIsAdmin,
  onAdminToggle,
  enabledFeatures,
  displayName,
  onLogout,
}) {
  const initials = (typeof displayName === 'string' && displayName.trim())
    ? displayName.trim().split(/\s+/).map(w => w ? w[0] : '').join('').slice(0, 2).toUpperCase()
    : 'RS'

  function navigate(key) {
    onNavigate(key)
    onClose()
  }

  // Filter groups based on admin mode and enabled features
  const allGroups = NAV_GROUPS.filter(g => {
    if (g.isAdmin && !adminMode) return false
    return true
  }).map(g => {
    const filteredItems = g.items.filter(it => {
      if (userIsAdmin || !enabledFeatures || ALWAYS_VISIBLE.has(it.key)) return true
      return enabledFeatures.has(it.key)
    })
    return { ...g, items: filteredItems }
  }).filter(g => g.items.length > 0)

  // Primary spaces to display in the launcher grid
  const spacesList = []
  allGroups.forEach(g => {
    g.items.forEach(it => {
      // Exclude primary bottom dock buttons from main spaces grid to keep it focused
      if (['home', 'briefing', 'chat', 'speak'].includes(it.key)) return
      spacesList.push(it)
    })
  })

  return (
    <>
      <div
        className={`rs-drawer-scrim ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <nav
        className={`rs-drawer ${open ? 'is-open' : ''}`}
        aria-label="Spaces & Services"
        aria-hidden={!open}
      >
        <div className="rs-drawer-head">
          <div className="rs-flex rs-items-center rs-gap-3">
            <RsMark mark="mono" size={26} />
            <span style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
              Spaces & Services
            </span>
          </div>
          <button className="rs-drawer-close" onClick={onClose} aria-label="Close">
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>

        <div className="rs-drawer-scroll-area">
          <div className="rs-spaces-grid">
            {spacesList.map(it => {
              const isActive = currentPage === it.key
              const danger = it.key === 'killswitch'
              return (
                <button
                  key={it.key}
                  className={`rs-space-tile ${isActive ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
                  onClick={() => navigate(it.key)}
                  title={it.label}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="rs-space-icon-wrap">
                    <EnvIcon name={it.icon || it.key} className="rs-icon" />
                  </div>
                  <span className="rs-space-label">{it.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Account & Quick Controls Footer */}
        <div className="rs-drawer-footer rs-mt-3" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 14 }}>
          <div className="rs-flex rs-items-center rs-justify-between rs-gap-3">
            <button
              className={`rs-drawer-profile ${currentPage === 'profile' ? 'is-active' : ''}`}
              onClick={() => navigate('profile')}
              aria-current={currentPage === 'profile' ? 'page' : undefined}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 16 }}
            >
              <span className="rs-drawer-avatar" aria-hidden="true">{initials}</span>
              <span className="rs-drawer-profile-body">
                <span className="rs-drawer-profile-name">{displayName || 'User'}</span>
                <span className="rs-drawer-profile-sub">Account & Profile</span>
              </span>
            </button>

            <button
              className="rs-icon-btn"
              onClick={() => navigate('settings')}
              title="Settings"
              aria-label="Settings"
              style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }}
            >
              <EnvIcon name="settings" className="rs-icon" />
            </button>

            {onLogout && (
              <button
                className="rs-icon-btn"
                onClick={() => { onClose(); onLogout() }}
                title="Sign out"
                aria-label="Sign out"
                style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--rs-status-critical)' }}
              >
                <EnvIcon name="logout" className="rs-icon" />
              </button>
            )}
          </div>

          {userIsAdmin && (
            <div className="rs-mt-3 rs-flex rs-items-center rs-justify-between" style={{ padding: '6px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--text-muted)', fontWeight: 500 }}>Admin Mode</span>
              <button
                className={`rs-drawer-toggle ${adminMode ? 'is-on' : ''}`}
                onClick={() => onAdminToggle(!adminMode)}
                aria-pressed={adminMode}
                title="Admin mode"
                style={{ padding: 0 }}
              >
                <span className="rs-toggle-track" aria-hidden="true">
                  <span className="rs-toggle-thumb" />
                </span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </>
  )
}
