import React, { useState } from 'react'

const USER_ITEMS = [
  { key: 'speak',       label: 'SPEAK',       icon: IconSpeak },
  { key: 'chat',        label: 'CHAT',        icon: IconChat },
  { key: 'memory',      label: 'MEMORY',      icon: IconMemory },
  { key: 'inventory',   label: 'INVENTORY',   icon: IconInventory },
  { key: 'maintenance', label: 'MAINTENANCE', icon: IconWrench },
  { key: 'commerce',    label: 'STORE',       icon: IconCommerce },
  { key: 'feeds',       label: 'FEEDS',       icon: IconFeeds },
  { key: 'google',      label: 'GOOGLE',      icon: IconGoogle,   soon: true },
  { key: 'reading',     label: 'READING',     icon: IconReading },
]

const ADMIN_ITEMS = [
  { key: 'dashboard',   label: 'DASHBOARD',   icon: IconDashboard },
  { key: 'speak',       label: 'SPEAK',       icon: IconSpeak },
  { key: 'chat',        label: 'CHAT',        icon: IconChat },
  { key: 'memory',      label: 'MEMORY',      icon: IconMemory },
  { key: 'inventory',   label: 'INVENTORY',   icon: IconInventory },
  { key: 'maintenance', label: 'MAINTENANCE', icon: IconWrench },
  { key: 'commerce',    label: 'STORE',       icon: IconCommerce },
  { key: 'routines',    label: 'ROUTINES',    icon: IconRoutines },
  { key: 'home',        label: 'HOME',        icon: IconHome },
  { key: 'analytics',   label: 'ANALYTICS',   icon: IconAnalytics, soon: true },
  { key: 'feeds',       label: 'FEEDS',       icon: IconFeeds },
  { key: 'google',      label: 'GOOGLE',      icon: IconGoogle,    soon: true },
  { key: 'reading',     label: 'READING',     icon: IconReading },
  { key: 'users',       label: 'USERS',       icon: IconUsers },
  { key: 'killswitch',  label: 'KILL SW.',    icon: IconKill },
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
        {items.map(({ key, label, icon: Icon, soon }) => (
          <button
            key={key}
            className={`sidebar-item ${currentPage === key ? 'sidebar-item--active' : ''} ${key === 'killswitch' ? 'sidebar-item--kill' : ''} ${soon ? 'sidebar-item--soon' : ''}`}
            onClick={() => onNavigate(key)}
            aria-current={currentPage === key ? 'page' : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon />
            {!collapsed && <span className="sidebar-label">{label}</span>}
            {!collapsed && soon && <span className="sidebar-soon-pill">SOON</span>}
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
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3 13c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M11.5 2.5c.8.6 1.5 1.5 1.5 2.5s-.7 1.9-1.5 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}

function IconChat() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 3h12v8H9l-3 2v-2H2V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <line x1="5" y1="6.5" x2="11" y2="6.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      <line x1="5" y1="8.5" x2="9" y2="8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
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

function IconWrench() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10.5 2a3.5 3.5 0 0 0-3.36 4.46L2 11.59 2.41 14 4 14.41 9.54 8.86A3.5 3.5 0 1 0 10.5 2z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="10.5" cy="5.5" r="1" fill="currentColor"/>
    </svg>
  )
}

function IconInventory() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="5" y1="3" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="7" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="7" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="0" />
    </svg>
  )
}

function IconFeeds() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="7" width="14" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="12" width="9" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function IconGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.5 5.5 C4 6.5 12 6.5 13.5 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M2.5 10.5 C4 9.5 12 9.5 13.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconCommerce() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 1h2l2 8h7l2-5H4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="7" cy="13.5" r="1.2" fill="currentColor"/>
      <circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>
    </svg>
  )
}

function IconReading() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 2a1.5 1.5 0 0 1 1.5-1.5H13v13H4.5A1.5 1.5 0 0 1 3 12V2z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3 12a1.5 1.5 0 0 0 1.5 1.5H13" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="6" y1="4.5" x2="10.5" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="6" y1="7" x2="10.5" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function IconAnalytics() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="9" width="2.5" height="5" rx="0.4" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.4" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="11.5" y="3" width="2.5" height="11" rx="0.4" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="15" x2="15" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}
