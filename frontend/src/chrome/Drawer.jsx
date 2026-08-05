import React from 'react'
import RsMark from '../components/RsMark.jsx'
import EnvIcon from './EnvIcon.jsx'
import { NAV_GROUPS } from '../utils/constants.js'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useBreakpoint.js'

/**
 * Drawer — primary navigation.
 *
 * Renders the same markup at every size; CSS decides the shape:
 *   < 768px   off-canvas overlay drawer behind the hamburger
 *   768–1199  persistent 88px icon+label rail
 *   >= 1200   persistent 260px drawer
 *
 * The `open` prop only means anything in the overlay case. From 768px up the
 * nav is always on screen, so it must not be marked aria-hidden and must not
 * trap the page behind a scrim.
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

  // At/above md the nav is permanently visible (rail or full drawer).
  const isPersistent = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px)`)

  function navigate(key) {
    onNavigate(key)
    // Closing is meaningless for a persistent rail, and calling it would leave
    // the shell's `drawerOpen` state out of sync with what's on screen.
    if (!isPersistent) onClose()
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
      {!isPersistent && (
        <div
          className={`rs-drawer-scrim ${open ? 'is-open' : ''}`}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <nav
        className={`rs-drawer ${open ? 'is-open' : ''}`}
        aria-label="Primary"
        // Only the off-canvas drawer is hidden when closed. A visible rail
        // marked aria-hidden would be unreachable to assistive tech.
        aria-hidden={isPersistent ? undefined : !open}
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
                          title={it.label}
                          aria-current={currentPage === it.key ? 'page' : undefined}
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
                        title={it.label}
                        aria-current={currentPage === it.key ? 'page' : undefined}
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
              title="Admin mode"
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
