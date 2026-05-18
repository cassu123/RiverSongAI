import React from 'react'
import SettingsPage from './SettingsPage.jsx'

/**
 * AdminSettingsPage — admin-only view of Settings.
 * Reuses SettingsPage with viewMode='admin', which gates content to admin sections:
 *   - Orchestration (n8n toggle; credentials in .env)
 *   - Daemon control
 *   - Local AI features
 *   - Personality
 *   - Feature visibility
 *   - Family groups
 *   - Wake word config
 *   - Model visibility
 *
 * User-facing settings (model picker, voice, memory, notifications) live in the
 * regular Settings page.
 */
export default function AdminSettingsPage({ onFeaturesChanged }) {
  return <SettingsPage viewMode="admin" onFeaturesChanged={onFeaturesChanged} />
}
