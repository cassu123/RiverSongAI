/**
 * src/utils/constants.js
 * 
 * Shared constants for the River Song AI frontend.
 * Extracted here to prevent circular dependencies between components.
 */

export const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch'])

export const ALWAYS_VISIBLE = new Set(['speak', 'chat', 'profile', 'settings', 'chronos'])

export const STATE_TABS = ['idle', 'listening', 'thinking', 'speaking']

export const USER_ITEMS = [
  { key: 'speak',       label: 'Speak',       icon: 'mic' },
  { key: 'chat',        label: 'Chat',        icon: 'chat_bubble' },
  { key: 'chronos',     label: 'CHRONOS',     icon: 'history' },
  { key: 'memory',      label: 'Memory',      icon: 'psychology' },
  { key: 'inventory',   label: 'Inventory',   icon: 'inventory_2' },
  { key: 'vehicles',    label: 'Garage',      icon: 'garage' },
  { key: 'commerce',    label: 'Store',       icon: 'shopping_bag' },
  { key: 'analytics',   label: 'Analytics',   icon: 'bar_chart' },
  { key: 'feeds',       label: 'Feeds',       icon: 'feed' },
  { key: 'google',      label: 'Google',      icon: 'hub' },
  { key: 'reading',     label: 'Reading',     icon: 'auto_stories' },
  { key: 'culinary',    label: 'Culinary',    icon: 'restaurant_menu' },
]

export const ADMIN_ITEMS = [
  { key: 'dashboard',   label: 'Dashboard',   icon: 'dashboard' },
  { key: 'speak',       label: 'Speak',       icon: 'mic' },
  { key: 'chat',        label: 'Chat',        icon: 'chat_bubble' },
  { key: 'chronos',     label: 'CHRONOS',     icon: 'history' },
  { key: 'memory',      label: 'Memory',      icon: 'psychology' },
  { key: 'inventory',   label: 'Inventory',   icon: 'inventory_2' },
  { key: 'vehicles',    label: 'Garage',      icon: 'garage' },
  { key: 'commerce',    label: 'Store',       icon: 'shopping_bag' },
  { key: 'routines',    label: 'Routines',    icon: 'routine' },
  { key: 'home',        label: 'Home Node',   icon: 'home_iot_device' },
  { key: 'environment', label: 'Environment', icon: 'visibility' },
  { key: 'analytics',   label: 'Analytics',   icon: 'bar_chart' },
  { key: 'feeds',       label: 'Feeds',       icon: 'feed' },
  { key: 'google',      label: 'Google',      icon: 'hub' },
  { key: 'reading',     label: 'Reading',     icon: 'auto_stories' },
  { key: 'culinary',    label: 'Culinary',    icon: 'restaurant_menu' },
  { key: 'users',       label: 'Users',       icon: 'group' },
  { key: 'killswitch',  label: 'Kill Switch', icon: 'power_settings_new' },
]
