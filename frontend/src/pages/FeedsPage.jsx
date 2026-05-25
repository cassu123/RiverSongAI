// Feeds page — thin wrapper around the modular FeedTabsContainer.
//
// The original 935-line monolithic FeedsPage was retired once each tab
// (News / Weather / Sports / Stocks / Flights) gained inline settings and the
// radar map was ported into WeatherTab. All feed UI now lives inside the tab
// components, so this page just provides the page chrome (title, subtitle)
// and mounts the container.

import React, { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import FeedTabsContainer from '../components/FeedTabsContainer.jsx'

export default function FeedsPage({ setAction }) {
  const { token } = useAuth()

  // No page-level action slot — the tab bar lives inside FeedTabsContainer.
  useEffect(() => {
    if (setAction) setAction(null)
    return () => { if (setAction) setAction(null) }
  }, [setAction])

  return (
    <div className="rs-foyer">
      <div className="rs-foyer-head" style={{ marginBottom: 24 }}>
        <h1 className="rs-greeting">Global Intelligence</h1>
        <div className="rs-greeting-sub">
          Live feeds across weather, markets, air traffic, space, earth, and whats happening right now.
        </div>
      </div>
      <FeedTabsContainer token={token} />
    </div>
  )
}
