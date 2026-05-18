import React from 'react'
import RsMark from '../components/RsMark.jsx'
import EnvIcon from './EnvIcon.jsx'
import { USER_ITEMS, ADMIN_ITEMS } from '../utils/constants.js'

/**
 * Drawer — overlay navigation. Replaces the permanent Sidebar.
 *
 * Absorbs everything the Sidebar used to own in its footer:
 *   - Filtered nav list (USER_ITEMS / ADMIN_ITEMS gated by enabledFeatures)
 *   - Profile row with avatar + display name
 *   - Admin mode toggle (only when userIsAdmin)
 *   - Settings + Logout buttons
 *
 * Shares row DNA with Sheet — same radius, same hover, same active rail.
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
  // Same filtering rules the Sidebar used: admin sees everything, otherwise
  // only items present in enabledFeatures (always-visible items handled by
  // App.jsx's handleNavigate guard, which itself reads ALWAYS_VISIBLE).
  const baseItems = adminMode ? ADMIN_ITEMS : USER_ITEMS
  const items = userIsAdmin || !enabledFeatures
    ? baseItems
    : baseItems.filter(i => enabledFeatures.has(i.key))

  const initials = (typeof displayName === 'string' && displayName.trim())
    ? displayName.trim().split(/\s+/).map(w => w ? w[0] : '').join('').slice(0, 2).toUpperCase()
    : 'RS'

  function navigate(key) {
    onNavigate(key)
    onClose()
  }

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

        {/* Primary nav — feature-gated, respects admin mode */}
        <div className="rs-drawer-section">
          <h3 className="rs-drawer-section-label">
            {adminMode ? 'Admin' : 'Primary'}
          </h3>
          <div className="rs-drawer-list">
            {(items || []).map(it => {
              const danger = it.key === 'killswitch'
              return (
                <button
                  key={it.key}
                  className={`rs-drawer-item ${currentPage === it.key ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
                  onClick={() => navigate(it.key)}
                >
                  <EnvIcon name={it.key} className="rs-icon" />
                  <span>{it.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Account footer — profile + admin toggle + settings/logout.
            Pinned to bottom via margin-top: auto in CSS. */}
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
