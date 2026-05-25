import React, { useState, useEffect } from 'react'
import NewsTab    from './tabs/NewsTab.jsx'
import WeatherTab from './tabs/WeatherTab.jsx'
import SportsTab  from './tabs/SportsTab.jsx'
import StocksTab  from './tabs/StocksTab.jsx'
import FlightsTab from './tabs/FlightsTab.jsx'

const TABS = [
  { key: 'news',    label: 'NEWS',    icon: 'newspaper' },
  { key: 'weather', label: 'WEATHER', icon: 'cloud' },
  { key: 'sports',  label: 'SPORTS',  icon: 'sports_kabaddi' },
  { key: 'stocks',  label: 'STOCKS',  icon: 'trending_up' },
  { key: 'flights', label: 'FLIGHTS', icon: 'flight' },
]

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

  const switchTab = (key) => {
    setActive(key)
    setTabInUrl(key)
  }

  // Sync when the browser URL changes externally — back/forward navigation,
  // or another component calling history.pushState. The original effect ran
  // only once on mount, so back/forward had no effect on the active tab.
  useEffect(() => {
    const sync = () => {
      const tab = getTabFromUrl()
      if (tab && tab !== active) setActive(tab)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [active])

  return (
    <div className="rs-card is-wide" style={{ overflow: 'hidden' }}>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '14px 20px',
        borderBottom: '1px solid var(--md-outline-variant)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        {TABS.map(tab => (
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

      {/* Tab content */}
      <div style={{ padding: '20px 24px 28px' }}>
        {active === 'news'    && <NewsTab    token={token} active={active === 'news'} />}
        {active === 'weather' && <WeatherTab token={token} active={active === 'weather'} />}
        {active === 'sports'  && <SportsTab  token={token} active={active === 'sports'} />}
        {active === 'stocks'  && <StocksTab  token={token} active={active === 'stocks'} />}
        {active === 'flights' && <FlightsTab token={token} active={active === 'flights'} />}
      </div>

    </div>
  )
}
