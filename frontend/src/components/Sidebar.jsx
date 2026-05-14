import React, { useState } from 'react'
import { USER_ITEMS, ADMIN_ITEMS } from '../utils/constants.js'

// ── Material Symbol component ────────────────────────────────────────────────
function MdIcon({ name, size = 20, style }) {
  return (
    <span
      className="material-symbols-rounded"
      style={{ fontSize: size, width: size, height: size, ...style }}
    >
      {name}
    </span>
  )
}

// ── Main Sidebar / Navigation Drawer ────────────────────────────────────────
export default function Sidebar({
  currentPage, onNavigate, isAdmin, showAdminToggle, onAdminToggle,
  displayName, onLogout, mobileOpen, onMobileClose,
  enabledFeatures, userIsAdmin,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const baseItems = isAdmin ? ADMIN_ITEMS : USER_ITEMS
  const items = userIsAdmin || !enabledFeatures
    ? baseItems
    : baseItems.filter(i => enabledFeatures.has(i.key))

  const initials = displayName
    ? displayName.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'RS'

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: collapsed ? '72px' : '260px',
        flexShrink: 0,
        background: 'var(--md-surface-container-low)',
        borderRight: '1px solid var(--md-outline-variant)',
        transition: 'width 250ms cubic-bezier(0.2, 0, 0, 1), transform 250ms cubic-bezier(0.2, 0, 0, 1)',
        zIndex: 50,
        overflow: 'hidden',
      }}
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}
    >
      {/* ── Brand header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: collapsed ? '16px 0' : '16px 20px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        minHeight: 64,
        flexShrink: 0,
        borderBottom: '1px solid var(--md-outline-variant)',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--md-shape-sm)',
          background: 'var(--md-primary-container)',
          color: 'var(--md-on-primary-container)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.8125rem',
          fontWeight: 700,
          flexShrink: 0,
          letterSpacing: '0.05em',
        }}>
          RS
        </div>

        {!collapsed && (
          <span style={{
            fontSize: '1.375rem',
            fontWeight: 400,
            color: 'var(--md-on-surface)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}>
            River Song
          </span>
        )}

        {onMobileClose && (
          <button
            className="sidebar-mobile-close"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Navigation items ── */}
      <nav
        aria-label="Main navigation"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {items.map(({ key, label, icon, soon }) => {
          const active = currentPage === key
          const isKill = key === 'killswitch'

          return (
            <NavItem
              key={key}
              icon={icon}
              label={label}
              active={active}
              soon={soon}
              danger={isKill}
              collapsed={collapsed}
              onClick={() => onNavigate(key)}
            />
          )
        })}
      </nav>

      {/* ── Admin toggle ── */}
      {showAdminToggle && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 10,
          padding: collapsed ? '10px 0' : '10px 20px',
          borderTop: '1px solid var(--md-outline-variant)',
          flexShrink: 0,
        }}>
          {!collapsed && (
            <span style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: isAdmin ? '#FFB86C' : 'var(--md-on-surface-variant)',
              textTransform: 'uppercase',
              transition: 'color 200ms',
            }}>
              Admin
            </span>
          )}

          {/* M3 Switch */}
          <button
            onClick={() => onAdminToggle(!isAdmin)}
            aria-pressed={isAdmin}
            aria-label="Toggle admin mode"
            style={{
              width: 52,
              height: 32,
              borderRadius: 'var(--md-shape-full)',
              background: isAdmin ? '#FFB86C' : 'var(--md-surface-variant)',
              border: `2px solid ${isAdmin ? '#FFB86C' : 'var(--md-outline)'}`,
              display: 'flex',
              alignItems: 'center',
              padding: 4,
              cursor: 'pointer',
              transition: 'background 200ms, border-color 200ms',
              flexShrink: 0,
            }}
          >
            <span style={{
              width: isAdmin ? 24 : 16,
              height: 16,
              borderRadius: '50%',
              background: isAdmin ? 'var(--md-on-primary)' : 'var(--md-outline)',
              transform: isAdmin ? 'translateX(20px)' : 'translateX(0)',
              transition: 'transform 200ms cubic-bezier(0.2,0,0,1), width 200ms, background 200ms',
              pointerEvents: 'none',
            }} />
          </button>
        </div>
      )}

      {/* ── Profile + Settings + Logout ── */}
      <div style={{
        borderTop: '1px solid var(--md-outline-variant)',
        flexShrink: 0,
      }}>
        {/* Profile row */}
        <button
          onClick={() => onNavigate('profile')}
          aria-current={currentPage === 'profile' ? 'page' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: collapsed ? '12px 0' : '12px 20px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%',
            background: currentPage === 'profile'
              ? 'var(--md-secondary-container)'
              : 'transparent',
            transition: 'background 200ms',
            borderRadius: 0,
          }}
        >
          {/* Avatar */}
          <div style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'var(--md-primary-container)',
            color: 'var(--md-on-primary-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.8125rem',
            fontWeight: 700,
            flexShrink: 0,
          }}>
            {initials}
          </div>

          {!collapsed && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              overflow: 'hidden',
              minWidth: 0,
              textAlign: 'left',
            }}>
              <span style={{
                fontSize: '0.875rem',
                fontWeight: 500,
                color: currentPage === 'profile'
                  ? 'var(--md-on-secondary-container)'
                  : 'var(--md-on-surface)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {displayName || 'User'}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--md-on-surface-variant)' }}>
                Profile
              </span>
            </div>
          )}
        </button>

        {/* Settings + Logout row */}
        <div style={{
          display: 'flex',
          borderTop: '1px solid var(--md-outline-variant)',
        }}>
          <button
            onClick={() => onNavigate('settings')}
            aria-current={currentPage === 'settings' ? 'page' : undefined}
            title="Settings"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 44,
              color: currentPage === 'settings'
                ? 'var(--md-primary)'
                : 'var(--md-on-surface-variant)',
              background: currentPage === 'settings'
                ? 'color-mix(in srgb, var(--md-primary) 10%, transparent)'
                : 'transparent',
              borderRadius: 0,
              transition: 'background 200ms, color 200ms',
            }}
          >
            <MdIcon name="settings" size={20} />
          </button>

          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 44,
                color: 'var(--md-on-surface-variant)',
                background: 'transparent',
                borderLeft: '1px solid var(--md-outline-variant)',
                borderRadius: 0,
                transition: 'background 200ms, color 200ms',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--md-error)'
                e.currentTarget.style.background = 'color-mix(in srgb, var(--md-error) 8%, transparent)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--md-on-surface-variant)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <MdIcon name="logout" size={20} />
            </button>
          )}
        </div>
      </div>

      {/* ── Collapse toggle ── */}
      <button
        className="sidebar-collapse"
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 36,
          width: '100%',
          borderTop: '1px solid var(--md-outline-variant)',
          color: 'var(--md-on-surface-variant)',
          fontSize: '0.875rem',
          flexShrink: 0,
          transition: 'background 200ms',
        }}
      >
        <MdIcon name={collapsed ? 'chevron_right' : 'chevron_left'} size={20} />
      </button>
    </aside>
  )
}

// ── Single navigation item ───────────────────────────────────────────────────
function NavItem({ icon, label, active, soon, danger, collapsed, onClick }) {
  const [hovered, setHovered] = useState(false)

  const activeColor  = danger ? 'var(--md-error)' : 'var(--md-on-secondary-container)'
  const activeBg     = danger
    ? 'color-mix(in srgb, var(--md-error) 12%, transparent)'
    : 'var(--md-secondary-container)'
  const inactiveColor = danger
    ? 'var(--md-on-surface-variant)'
    : 'var(--md-on-surface-variant)'
  const hoverBg = danger
    ? 'color-mix(in srgb, var(--md-error) 8%, transparent)'
    : 'rgba(255,255,255,0.06)'

  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={collapsed ? label : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: collapsed ? '0 18px' : '0 20px',
        height: 56,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%',
        position: 'relative',
        borderRadius: 0,
        transition: 'background 200ms',
        background: 'transparent',
        overflow: 'visible',
      }}
    >
      {/* M3 active indicator — pill behind icon (+ label when not collapsed) */}
      <div style={{
        position: 'absolute',
        left: collapsed ? 8 : 12,
        right: collapsed ? 8 : 12,
        top: '50%',
        transform: 'translateY(-50%)',
        height: 32,
        borderRadius: 'var(--md-shape-full)',
        background: active ? activeBg : hovered ? hoverBg : 'transparent',
        transition: 'background 200ms, opacity 200ms',
        pointerEvents: 'none',
      }} />

      {/* Icon */}
      <span
        className="material-symbols-rounded"
        style={{
          fontSize: 22,
          width: 22,
          height: 22,
          color: active ? activeColor : danger && hovered ? 'var(--md-error)' : inactiveColor,
          transition: 'color 200ms',
          position: 'relative',
          zIndex: 1,
          lineHeight: 1,
          fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
        }}
      >
        {icon}
      </span>

      {/* Label */}
      {!collapsed && (
        <span style={{
          fontSize: '0.875rem',
          fontWeight: active ? 500 : 400,
          color: active ? activeColor : danger && hovered ? 'var(--md-error)' : 'var(--md-on-surface-variant)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          flex: 1,
          textAlign: 'left',
          position: 'relative',
          zIndex: 1,
          transition: 'color 200ms',
        }}>
          {label}
        </span>
      )}

      {/* Soon badge */}
      {!collapsed && soon && (
        <span style={{
          fontSize: '0.5625rem',
          fontWeight: 500,
          letterSpacing: '0.06em',
          color: 'var(--md-on-surface-variant)',
          border: '1px solid var(--md-outline-variant)',
          borderRadius: 'var(--md-shape-full)',
          padding: '1px 6px',
          lineHeight: 1.4,
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
        }}>
          SOON
        </span>
      )}
    </button>
  )
}
