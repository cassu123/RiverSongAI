import React from 'react'
import RsMark from '../components/RsMark.jsx'
import EnvIcon from './EnvIcon.jsx'
import useBackdropIdle from './useBackdropIdle.js'
import { NAV_GROUPS } from '../utils/constants.js'

/**
 * Drawer — overlay navigation. Replaces the permanent Sidebar.
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
  useBackdropIdle(open)
  const initials = (typeof displayName === 'string' && displayName.trim())
    ? displayName.trim().split(/\s+/).map(w => w ? w[0] : '').join('').slice(0, 2).toUpperCase()
    : 'RS'

  function navigate(key) {
    onNavigate(key)
    onClose()
  }

  // Filter NAV_GROUPS based on admin mode and enabled features
  const groups = NAV_GROUPS.filter(g => {
    if (g.isAdmin && !adminMode) return false
    return true
  }).map(g => {
    const filteredItems = g.items.filter(it => {
      if (userIsAdmin || !enabledFeatures) return true
      return enabledFeatures.has(it.key)
    })
    return { ...g, items: filteredItems }
  }).filter(g => g.items.length > 0)

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

        {/* Grouped nav sections — Primary (list) · More (grid) · Admin (list) */}
        <div className="rs-drawer-scroll-area">
          {groups.map(group => {
            const isGrid = group.layout === 'grid'
            const isPrimary = group.label === 'Primary'
            return (
              <div key={group.label} className={`rs-drawer-section ${isGrid ? 'is-grid' : ''}`}>
                {/* Primary group renders without a label; others get a divider/label */}
                {!isPrimary && (
                  <h3 className="rs-drawer-section-label">— {group.label} —</h3>
                )}
                <div className={isGrid ? 'rs-drawer-grid' : 'rs-drawer-list'}>
                  {group.items.map(it => {
                    const danger = it.key === 'killswitch'
                    const itemKey = `${group.label}:${it.key}`
                    if (isGrid) {
                      return (
                        <button
                          key={itemKey}
                          className={`rs-drawer-cell ${currentPage === it.key ? 'is-active' : ''}`}
                          onClick={() => navigate(it.key)}
                        >
                          <div className="rs-card-inner" style={{ padding: '12px 8px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                            <EnvIcon name={it.icon || it.key} className="rs-icon" />
                            <span className="rs-card-label" style={{ fontSize: '0.6rem', opacity: 1 }}>{it.label}</span>
                          </div>
                        </button>
                      )
                    }
                    return (
                      <button
                        key={itemKey}
                        className={`rs-drawer-item ${currentPage === it.key ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
                        onClick={() => navigate(it.key)}
                      >
                        <EnvIcon name={it.icon || it.key} className="rs-icon" />
                        <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{it.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Account footer */}
        <div className="rs-drawer-section rs-drawer-footer">
          <h3 className="rs-drawer-section-label">Account</h3>

          {/* Profile row */}
          <button
            className={`rs-drawer-profile ${currentPage === 'profile' ? 'is-active' : ''}`}
            onClick={() => navigate('profile')}
            aria-current={currentPage === 'profile' ? 'page' : undefined}
          >
            <span className="rs-drawer-avatar" aria-hidden="true">{initials}</span>
            <span className="rs-drawer-profile-body">
              <span className="rs-drawer-profile-name">{displayName || 'User'}</span>
              <span className="rs-drawer-profile-sub">Profile</span>
            </span>
          </button>

          {/* Admin toggle — only when current user has admin role */}
          {userIsAdmin && (
            <button
              className={`rs-drawer-toggle ${adminMode ? 'is-on' : ''}`}
              onClick={() => onAdminToggle(!adminMode)}
              aria-pressed={adminMode}
            >
              <span>Admin mode</span>
              <span className="rs-toggle-track" aria-hidden="true">
                <span className="rs-toggle-thumb" />
              </span>
            </button>
          )}

          {/* Settings + Logout pair */}
          <div className="rs-drawer-list">
            <button
              className={`rs-drawer-item ${currentPage === 'settings' ? 'is-active' : ''}`}
              onClick={() => navigate('settings')}
            >
              <EnvIcon name="settings" className="rs-icon" />
              <span>Settings</span>
            </button>
            {onLogout && (
              <button
                className="rs-drawer-item is-danger"
                onClick={() => { onClose(); onLogout() }}
              >
                <EnvIcon name="logout" className="rs-icon" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}
