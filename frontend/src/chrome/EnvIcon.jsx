import React, { createContext, useContext } from 'react'

/**
 * EnvIcon — one component, eight glyph sets.
 *
 * Same semantic key ("memory", "home", "speak") renders a different
 * Material Symbol depending on the active environment, so the icon
 * thematically matches the world (auto_stories in Atreides, data_object
 * in Forerunner, voicemail in Pacifica, etc).
 *
 * Usage:
 *   <EnvIcon name="memory" />
 *   <EnvIcon name="mail" style={{ fontSize: 28 }} className="custom" />
 *
 * Per-env mappings layer on top of BASE — any key not overridden falls
 * back to the universal glyph, so we can stay terse.
 */

const EnvContext = createContext('atreides')
export const EnvProvider = EnvContext.Provider

/* Universal fallback glyphs ─────────────────────────────────────────────── */
const BASE = {
  // Primary nav
  briefing: 'auto_stories', dashboard: 'dashboard', chat: 'chat_bubble',
  speak: 'graphic_eq', memory: 'psychology', home: 'home',
  chronos: 'menu_book', pulse: 'bolt', routines: 'settings_suggest',
  // Secondary
  inventory: 'inventory_2', culinary: 'restaurant', garage: 'directions_car',
  vehicles: 'directions_car',
  store: 'storefront', commerce: 'shopping_bag',
  analytics: 'analytics', feeds: 'rss_feed', google: 'hub',
  sifter: 'filter_alt', reading: 'auto_stories', dreamscape: 'auto_awesome',
  environment: 'public',
  // Admin
  settings: 'settings', admin_settings: 'shield_person',
  users: 'group', killswitch: 'power_settings_new', logout: 'logout',
  // Dashboard
  mail: 'mail', weather: 'partly_cloudy_day', events: 'event',
  // Input + chrome
  mic: 'mic', add: 'add', think: 'psychology', search: 'language',
  close: 'close', back: 'arrow_back', check: 'check',
  chevron_right: 'chevron_right', radio: 'radio_button_unchecked',
}

/* Per-env overrides — only define keys that should differ ───────────────── */
const PER_ENV = {
  atreides: {
    speak: 'record_voice_over', memory: 'auto_stories', home: 'castle',
    chronos: 'history_edu', pulse: 'water_drop', routines: 'history_toggle_off',
    inventory: 'inventory', culinary: 'soup_kitchen', garage: 'sailing',
    store: 'storefront', analytics: 'monitoring', feeds: 'newspaper',
    reading: 'menu_book', dreamscape: 'visibility', environment: 'water',
    settings: 'tune', logout: 'meeting_room',
    mail: 'mail', weather: 'thunderstorm', events: 'event_note',
    think: 'auto_stories', search: 'travel_explore',
  },
  harkonnen: {
    speak: 'campaign', memory: 'psychology_alt', home: 'factory',
    chronos: 'edit_note', pulse: 'electric_bolt', routines: 'precision_manufacturing',
    inventory: 'warehouse', culinary: 'kitchen', garage: 'forklift',
    store: 'point_of_sale', analytics: 'monitoring', feeds: 'broadcast_on_personal',
    reading: 'description', dreamscape: 'remove_red_eye',
    settings: 'tune', logout: 'exit_to_app',
    mail: 'forward_to_inbox', weather: 'foggy', events: 'assignment',
    think: 'cognition', search: 'radar',
  },
  arrakis: {
    speak: 'record_voice_over', memory: 'auto_stories', home: 'landscape',
    chronos: 'history_edu', pulse: 'wb_sunny', routines: 'hourglass_top',
    inventory: 'inventory', culinary: 'soup_kitchen', garage: 'savings',
    store: 'storefront', analytics: 'monitoring', feeds: 'newspaper',
    reading: 'menu_book', dreamscape: 'visibility', environment: 'terrain',
    settings: 'tune', logout: 'meeting_room',
    mail: 'mail', weather: 'wb_sunny', events: 'event_note',
    think: 'auto_stories', search: 'travel_explore',
  },
  forerunner: {
    speak: 'graphic_eq', memory: 'data_object', home: 'shield_lock',
    chronos: 'description', pulse: 'electric_bolt', routines: 'rule',
    inventory: 'category', culinary: 'science', garage: 'rocket_launch',
    store: 'token', analytics: 'analytics', feeds: 'satellite_alt',
    sifter: 'filter_alt', reading: 'auto_stories', dreamscape: 'all_inclusive',
    environment: 'language', settings: 'tune',
    mail: 'send', weather: 'wb_twilight', events: 'event_available',
    think: 'memory', search: 'travel_explore',
  },
  unsc: {
    speak: 'settings_voice', memory: 'database', home: 'military_tech',
    chronos: 'assignment', pulse: 'bolt', routines: 'fact_check',
    inventory: 'inventory_2', culinary: 'restaurant_menu', garage: 'local_shipping',
    store: 'inventory_2', analytics: 'leaderboard', feeds: 'cell_tower',
    reading: 'menu_book', dreamscape: 'visibility',
    environment: 'public', settings: 'build',
    mail: 'mark_email_unread', weather: 'cloud', events: 'event_busy',
    think: 'psychology_alt', search: 'radar',
  },
  spires: {
    speak: 'graphic_eq', memory: 'library_books', home: 'temple_buddhist',
    chronos: 'edit_note', pulse: 'self_improvement', routines: 'all_inclusive',
    inventory: 'category', culinary: 'eco', garage: 'travel_explore',
    store: 'spa', analytics: 'insights', feeds: 'translate',
    sifter: 'filter_alt', reading: 'menu_book', dreamscape: 'auto_awesome',
    environment: 'globe_asia', settings: 'tune', logout: 'self_improvement',
    mail: 'mail', weather: 'partly_cloudy_day', events: 'event',
    think: 'psychology', search: 'explore',
  },
  garden: {
    speak: 'voice_chat', memory: 'psychology', home: 'cottage',
    chronos: 'edit_note', pulse: 'water_drop', routines: 'eco',
    inventory: 'inventory_2', culinary: 'restaurant', garage: 'pedal_bike',
    store: 'storefront', analytics: 'monitor_heart', feeds: 'park',
    reading: 'auto_stories', dreamscape: 'spa',
    environment: 'yard', settings: 'tune',
    mail: 'mark_email_read', weather: 'wb_sunny', events: 'event',
    think: 'self_improvement', search: 'travel_explore',
  },
  corpo: {
    speak: 'campaign', memory: 'memory_alt', home: 'domain',
    chronos: 'edit_document', pulse: 'bolt', routines: 'smart_toy',
    inventory: 'inventory_2', culinary: 'fastfood', garage: 'electric_car',
    store: 'shopping_bag', analytics: 'show_chart', feeds: 'newsmode',
    reading: 'newspaper', dreamscape: 'view_in_ar',
    environment: 'public', settings: 'tune', logout: 'exit_to_app',
    mail: 'mark_email_read', weather: 'cloud', events: 'event_available',
    think: 'memory', search: 'travel_explore',
  },
  pacifica: {
    speak: 'voicemail', memory: 'psychology_alt', home: 'home_repair_service',
    chronos: 'edit_note', pulse: 'flash_on', routines: 'autofps_select',
    inventory: 'inventory_2', culinary: 'local_fire_department', garage: 'two_wheeler',
    store: 'local_mall', analytics: 'monitoring', feeds: 'cast',
    reading: 'menu_book', dreamscape: 'auto_fix_high',
    environment: 'travel_explore', settings: 'tune', logout: 'logout',
    mail: 'inbox', weather: 'thunderstorm', events: 'event_busy',
    think: 'psychology_alt', search: 'radar',
  },
}

export default function EnvIcon({ name, className = '', style }) {
  const env = useContext(EnvContext)
  const glyph = (PER_ENV[env] && PER_ENV[env][name]) || BASE[name] || name
  return (
    <span
      className={`material-symbols-rounded ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      {glyph}
    </span>
  )
}
