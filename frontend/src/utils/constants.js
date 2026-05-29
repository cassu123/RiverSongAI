/**
 * src/utils/constants.js
 * 
 * Shared constants for the River Song AI frontend.
 * Extracted here to prevent circular dependencies between components.
 */

export const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch', 'admin_settings'])

export const ALWAYS_VISIBLE = new Set(['speak', 'chat', 'profile', 'settings', 'chronos', 'briefing'])

export const STATE_TABS = ['idle', 'listening', 'thinking', 'speaking']

/**
 * NAV_GROUPS — drawer taxonomy per RIVER_SONG_CHROME_PLAN.md §5.
 *
 *   Primary (6 items)  : icon + label rows. Always visible.
 *   More    (2-col)    : icon-above-label cells.
 *   Admin              : admin-only, settings + logout always render.
 *
 * `layout` hints to the drawer how to render: 'list' (default) or 'grid'.
 */
export const NAV_GROUPS = [
  {
    label: 'Primary',
    layout: 'list',
    items: [
      { key: 'briefing',    label: 'Briefing',    icon: 'briefing' },
      { key: 'speak',       label: 'Speaking',    icon: 'speak' },
      { key: 'chat',        label: 'Chat',        icon: 'chat' },
      { key: 'home',        label: 'Home Node',   icon: 'home' },
      { key: 'feeds',       label: 'Feeds',       icon: 'feeds' },
    ]
  },
  {
    label: 'More',
    layout: 'grid',
    items: [
      { key: 'memory',      label: 'Memory',      icon: 'memory' },
      { key: 'chronos',     label: 'Notes',       icon: 'chronos' },
      { key: 'routines',    label: 'Routines',    icon: 'routines' },
      { key: 'inventory',   label: 'Stash',       icon: 'inventory' },
      { key: 'culinary',    label: 'Kitchen',     icon: 'culinary' },
      { key: 'vehicles',    label: 'Garage',      icon: 'vehicles' },
      { key: 'commerce',    label: 'Store',       icon: 'commerce' },
      { key: 'analytics',   label: 'Analytics',   icon: 'analytics' },
      { key: 'reading',     label: 'Reading',     icon: 'reading' },
      { key: 'google',      label: 'Google',      icon: 'google' },
      { key: 'environment', label: 'Environment', icon: 'environment' },
      { key: 'fleet',       label: 'Fleet',       icon: 'fleet' },
    ]
  },
  {
    label: 'Admin',
    layout: 'list',
    isAdmin: true,
    items: [
      { key: 'dashboard',      label: 'System Hub',     icon: 'dashboard' },
      { key: 'users',          label: 'Users',          icon: 'users' },
      { key: 'admin_settings', label: 'Admin Settings', icon: 'admin_settings' },
      { key: 'killswitch',     label: 'Kill Switch',    icon: 'killswitch' },
    ]
  }
]

// Flat lookups used for header-context lookups (unused for context now, but kept
// because other modules import them).
export const USER_ITEMS = NAV_GROUPS.filter(g => !g.isAdmin).flatMap(g => g.items)
export const ADMIN_ITEMS = NAV_GROUPS.flatMap(g => g.items)
