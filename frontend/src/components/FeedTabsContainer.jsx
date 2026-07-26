import React, { useState, useEffect, useRef } from 'react'
import NewsTab    from './tabs/NewsTab.jsx'
import WeatherTab from './tabs/WeatherTab.jsx'
import SportsTab  from './tabs/SportsTab.jsx'
import StocksTab  from './tabs/StocksTab.jsx'
import FlightsTab from './tabs/FlightsTab.jsx'
import SpaceTab   from './tabs/SpaceTab.jsx'
import EarthTab   from './tabs/EarthTab.jsx'
import HappeningsTab from './tabs/HappeningsTab.jsx'
import {
  useFeedPrefs, FeedTabsManager, OPTIONAL_TABS,
  WeatherSettings, StocksSettings, SpaceSettings, EarthSettings, HappeningsSettings,
} from './tabs/FeedTabSettings.jsx'

const TABS = [
  { key: 'news',    label: 'NEWS',    icon: 'newspaper' },
  { key: 'weather', label: 'WEATHER', icon: 'cloud' },
  { key: 'sports',  label: 'SPORTS',  icon: 'sports_kabaddi' },
  { key: 'stocks',  label: 'STOCKS',  icon: 'trending_up' },
  { key: 'flights', label: 'FLIGHTS', icon: 'flight' },
  { key: 'space',   label: 'SPACE',   icon: 'rocket_launch' },
  { key: 'earth',   label: 'EARTH',   icon: 'public' },
  { key: 'happenings', label: 'HAPPENINGS', icon: 'whatshot' },
]

const OPTIONAL_KEYS = Object.fromEntries(OPTIONAL_TABS.map(t => [t.key, t.flag]))

function getTabFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search).get('tab')
    return TABS.find(t => t.key === p)?.key || null
  } catch { return null }
}

function setTabInUrl(key) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', key)
    window.history.replaceState({}, '', url)
  } catch {}
}

export default function FeedTabsContainer({ token, defaultTab = 'news' }) {
  const [active, setActive] = useState(() => getTabFromUrl() || defaultTab)
  const [manageOpen, setManageOpen] = useState(false)
  const manageRef = useRef(null)
  const { prefs, savePrefs } = useFeedPrefs(token)

  // Which optional tabs (Space/Earth/Happenings) are enabled. Until prefs load,
  // show everything; once loaded, hide the ones switched off.
  const isVisible = (key) => {
    const flag = OPTIONAL_KEYS[key]
    if (!flag) return true
    return !prefs || prefs[flag] !== false
  }
  const visibleTabs = TABS.filter(t => isVisible(t.key))

  const switchTab = (key) => {
    setActive(key)
    setTabInUrl(key)
  }

  // If the active tab gets hidden via the manager, fall back to the first
  // visible tab so we never render an empty body.
  useEffect(() => {
    if (!isVisible(active) && visibleTabs.length > 0) {
      switchTab(visibleTabs[0].key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, active])

  // Sync when the browser URL changes externally (back/forward).
  useEffect(() => {
    const sync = () => {
      const tab = getTabFromUrl()
      if (tab && tab !== active) setActive(tab)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [active])

  // Close the manage-tabs popover on outside click.
  useEffect(() => {
    if (!manageOpen) return
    const handler = (e) => {
      if (manageRef.current && !manageRef.current.contains(e.target)) setManageOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [manageOpen])

  const settingsForActive = {
    weather:    <WeatherSettings    prefs={prefs} savePrefs={savePrefs} />,
    stocks:     <StocksSettings     prefs={prefs} savePrefs={savePrefs} />,
    space:      <SpaceSettings      prefs={prefs} savePrefs={savePrefs} />,
    earth:      <EarthSettings      prefs={prefs} savePrefs={savePrefs} />,
    happenings: <HappeningsSettings prefs={prefs} savePrefs={savePrefs} />,
  }[active] || null

  return (
    <div className="rs-card is-wide" style={{ overflow: 'hidden' }}>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '14px 20px',
        borderBottom: '1px solid var(--md-outline-variant)',
      }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', flex: 1 }}>
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              className={`rs-pill ${active === tab.key ? 'is-active' : ''}`}
              onClick={() => switchTab(tab.key)}
              style={{ flexShrink: 0 }}
            >
              <span className="material-symbols-rounded">{tab.icon}</span>
              <span className="rs-speak-actions-label">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Manage which optional tabs are shown */}
        <div style={{ position: 'relative', flexShrink: 0 }} ref={manageRef}>
          <button
            className={`rs-pill ${manageOpen ? 'is-active' : ''}`}
            onClick={() => setManageOpen(o => !o)}
            title="Manage tabs"
            style={{ flexShrink: 0 }}
          >
            <span className="material-symbols-rounded">tune</span>
          </button>
          {manageOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 100, marginTop: 8,
              background: 'var(--md-surface-container)',
              border: '1px solid var(--md-outline-variant)',
              borderRadius: 12, padding: '16px 18px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
              minWidth: 220,
            }}>
              <FeedTabsManager prefs={prefs} savePrefs={savePrefs} />
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ padding: '20px 24px 28px' }}>
        {settingsForActive}
        {active === 'news'    && <NewsTab    token={token} active={active === 'news'} />}
        {active === 'weather' && <WeatherTab token={token} active={active === 'weather'} />}
        {active === 'sports'  && <SportsTab  token={token} active={active === 'sports'} />}
        {active === 'stocks'  && <StocksTab  token={token} active={active === 'stocks'} />}
        {active === 'flights' && <FlightsTab token={token} active={active === 'flights'} />}
        {active === 'space'   && <SpaceTab   token={token} active={active === 'space'} />}
        {active === 'earth'   && <EarthTab   token={token} active={active === 'earth'} />}
        {active === 'happenings' && <HappeningsTab token={token} active={active === 'happenings'} />}
      </div>

    </div>
  )
}
