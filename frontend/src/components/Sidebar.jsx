import React, { useState } from 'react'

const USER_ITEMS = [
  { key: 'speak',  label: 'SPEAK',  icon: IconSpeak },
  { key: 'memory', label: 'MEMORY', icon: IconMemory },
]

const ADMIN_ITEMS = [
  { key: 'dashboard',  label: 'DASHBOARD', icon: IconDashboard },
  { key: 'speak',      label: 'SPEAK',      icon: IconSpeak },
  { key: 'memory',     label: 'MEMORY',     icon: IconMemory },
  { key: 'routines',   label: 'ROUTINES',   icon: IconRoutines },
  { key: 'home',       label: 'HOME',       icon: IconHome },
  { key: 'users',      label: 'USERS',      icon: IconUsers },
  { key: 'killswitch', label: 'KILL SW.',   icon: IconKill },
]

export default function Sidebar({ currentPage, onNavigate, isAdmin, showAdminToggle, onAdminToggle, displayName, onLogout }) {
  const [collapsed, setCollapsed] = useState(false)
  const items = isAdmin ? ADMIN_ITEMS : USER_ITEMS

  const initials = displayName
    ? displayName.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'CW'

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-logo">RS</div>
        {!collapsed && <span className="sidebar-title">RIVER SONG</span>}
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {items.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`sidebar-item ${currentPage === key ? 'sidebar-item--active' : ''} ${key === 'killswitch' ? 'sidebar-item--kill' : ''}`}
            onClick={() => onNavigate(key)}
            aria-current={currentPage === key ? 'page' : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon />
            {!collapsed && <span className="sidebar-label">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Bottom utility buttons */}
      <div className={`sidebar-utils ${collapsed ? 'sidebar-utils--collapsed' : ''}`}>
        {/* Profile */}
        <button
          className={`sidebar-profile ${currentPage === 'profile' ? 'sidebar-profile--active' : ''}`}
          onClick={() => onNavigate('profile')}
          title={collapsed ? 'Profile' : undefined}
          aria-current={currentPage === 'profile' ? 'page' : undefined}
          style={{ flex: 1, borderRight: collapsed ? 'none' : '1px solid var(--border)' }}
        >
          <div className="sidebar-avatar">{initials}</div>
          {!collapsed && (
            <div className="sidebar-profile-info">
              <span className="sidebar-profile-name">{displayName || 'Charlie W.'}</span>
              <span className="sidebar-profile-sub">Profile</span>
            </div>
          )}
        </button>

        {/* Settings gear */}
        <button
          className={`sidebar-util-btn ${currentPage === 'settings' ? 'sidebar-util-btn--active' : ''}`}
          onClick={() => onNavigate('settings')}
          title="Settings"
          aria-current={currentPage === 'settings' ? 'page' : undefined}
        >
          <IconGear />
        </button>

        {/* Logout */}
        {onLogout && (
          <button
            className="sidebar-util-btn"
            onClick={onLogout}
            title="Sign out"
            style={{ color: 'var(--text-dim)' }}
          >
            <IconLogout />
          </button>
        )}
      </div>

      {/* Admin mode toggle — only visible to admin role users */}
      {showAdminToggle && (
        <div
          className={`sidebar-admin-toggle ${collapsed ? 'sidebar-admin-toggle--collapsed' : ''}`}
          title={collapsed ? (isAdmin ? 'Admin mode on' : 'Admin mode off') : undefined}
        >
          {!collapsed && (
            <span className={`sidebar-admin-label ${isAdmin ? 'sidebar-admin-label--on' : ''}`}>
              ADMIN
            </span>
          )}
          <button
            className={`sidebar-toggle-switch ${isAdmin ? 'sidebar-toggle-switch--on' : ''}`}
            onClick={() => onAdminToggle(!isAdmin)}
            aria-pressed={isAdmin}
            aria-label="Toggle admin mode"
          >
            <span className="sidebar-toggle-knob" />
          </button>
        </div>
      )}

      <button
        className="sidebar-collapse"
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </aside>
  )
}

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function IconSpeak() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3h12v8H9l-3 2v-2H2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function IconMemory() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function IconRoutines() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polyline points="9,1 5,9 8,9 7,15 11,7 8,7" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polyline points="1,8 8,2 15,8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <polyline points="3,7 3,14 6,14 6,10 10,10 10,14 13,14 13,7" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconKill() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M5 3.5A6 6 0 1 0 11 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="8" y1="1" x2="8" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <polyline points="11,5 14,8 11,11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="14" y1="8" x2="6" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
