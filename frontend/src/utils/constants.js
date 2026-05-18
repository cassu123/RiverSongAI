/**
 * src/utils/constants.js
 * 
 * Shared constants for the River Song AI frontend.
 * Extracted here to prevent circular dependencies between components.
 */

export const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch', 'admin_settings'])

export const ALWAYS_VISIBLE = new Set(['speak', 'chat', 'profile', 'settings', 'chronos', 'briefing'])

export const STATE_TABS = ['idle', 'listening', 'thinking', 'speaking']

export const NAV_GROUPS = [
  {
    label: 'Briefing',
    items: [
      { key: 'briefing',    label: 'Daily Briefing', icon: 'auto_stories' },
    ]
  },
  {
    label: 'Communication',
    items: [
      { key: 'speak',       label: 'Speak',       icon: 'mic' },
      { key: 'chat',        label: 'Chat',        icon: 'chat_bubble' },
    ]
  },
  {
    label: 'Archives',
    items: [
      { key: 'chronos',     label: 'CHRONOS',     icon: 'history' },
      { key: 'memory',      label: 'Memory',      icon: 'psychology' },
    ]
  },
  {
    label: 'Logistics',
    items: [
      { key: 'inventory',   label: 'Inventory',   icon: 'inventory_2' },
      { key: 'vehicles',    label: 'Garage',      icon: 'garage' },
    ]
  },
  {
    label: 'Commerce',
    items: [
      { key: 'commerce',    label: 'Store',       icon: 'shopping_bag' },
    ]
  },
  {
    label: 'Utilities',
    items: [
      { key: 'analytics',   label: 'Analytics',   icon: 'bar_chart' },
      { key: 'feeds',       label: 'Feeds',       icon: 'feed' },
      { key: 'google',      label: 'Google',      icon: 'hub' },
      { key: 'reading',     label: 'Reading',     icon: 'auto_stories' },
      { key: 'culinary',    label: 'Culinary',    icon: 'restaurant_menu' },
    ]
  },
  {
    label: 'System',
    isAdmin: true,
    items: [
      { key: 'dashboard',      label: 'System Hub',     icon: 'dashboard' },
      { key: 'routines',       label: 'Routines',       icon: 'routine' },
      { key: 'home',           label: 'Home Node',      icon: 'home_iot_device' },
      { key: 'environment',    label: 'Environment',    icon: 'visibility' },
      { key: 'users',          label: 'Users',          icon: 'group' },
      { key: 'admin_settings', label: 'Admin Settings', icon: 'shield_person' },
      { key: 'killswitch',     label: 'Kill Switch',    icon: 'power_settings_new' },
    ]
  }
]

export const USER_ITEMS = NAV_GROUPS.filter(g => !g.isAdmin).flatMap(g => g.items)
export const ADMIN_ITEMS = NAV_GROUPS.flatMap(g => g.items)


