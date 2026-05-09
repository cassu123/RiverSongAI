/**
 * src/utils/constants.js
 * 
 * Shared constants for the River Song AI frontend.
 * Extracted here to prevent circular dependencies between components.
 */

export const ADMIN_PAGES = new Set(['dashboard', 'routines', 'home', 'users', 'killswitch'])

export const ALWAYS_VISIBLE = new Set(['speak', 'chat', 'profile', 'settings'])

export const STATE_TABS = ['idle', 'listening', 'thinking', 'speaking']
