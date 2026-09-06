import React from 'react'
import SettingsPage from './SettingsPage.jsx'

/**
 * Render the settings page in administrative mode.
 * @param {Object} props - Props forwarded to the settings page.
 * @returns {JSX.Element} The administrative settings page.
 */
export default function AdminSettingsPage(props) {
  return <SettingsPage initialHubTab="admin" viewMode="admin" {...props} />
}
