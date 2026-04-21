import React from 'react'

const FEEDS = [
  {
    key: 'news',
    icon: IconNews,
    title: 'NEWS',
    desc: 'Top headlines from configurable sources. Ask River to read you the news, filter by topic, or brief you on a specific story.',
    tags: ['RSS / NewsAPI', 'Topic filters', 'Voice briefing'],
  },
  {
    key: 'weather',
    icon: IconWeather,
    title: 'WEATHER',
    desc: 'Current conditions and forecasts for any location. River can give you a morning weather report or alert you to severe conditions.',
    tags: ['7-day forecast', 'Hourly breakdown', 'Location aware'],
  },
  {
    key: 'sports',
    icon: IconSports,
    title: 'SPORTS',
    desc: 'Live scores, schedules, and standings for your favourite teams and leagues.',
    tags: ['Live scores', 'Team tracking', 'League standings'],
  },
  {
    key: 'stocks',
    icon: IconStocks,
    title: 'STOCKS & MARKETS',
    desc: 'Real-time quotes, portfolio tracking, and market summaries you can ask about in conversation.',
    tags: ['Real-time quotes', 'Portfolio watch', 'Market summary'],
  },
]

export default function FeedsPage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>DATA</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>FEEDS</span>
      </div>
      <h1 className="page-title">Feeds</h1>
      <p className="page-subtitle">
        Live data streams River can read, summarise, and discuss with you.
      </p>

      <div className="coming-soon-banner">
        <span className="coming-soon-tag">COMING SOON</span>
        <span className="coming-soon-text">
          Feeds integration is under development. The providers are scaffolded — configuration UI and conversation hooks ship in a future phase.
        </span>
      </div>

      <div className="feature-card-grid">
        {FEEDS.map(({ key, icon: Icon, title, desc, tags }) => (
          <div key={key} className="feature-card feature-card--locked">
            <div className="feature-card-header">
              <div className="feature-card-icon"><Icon /></div>
              <div className="feature-card-title">{title}</div>
              <div className="feature-card-badge">SOON</div>
            </div>
            <p className="feature-card-desc">{desc}</p>
            <div className="feature-card-tags">
              {tags.map(t => <span key={t} className="feature-tag">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function IconNews() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="3" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="5" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="5" y1="10" x2="15" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="5" y1="13" x2="11" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconWeather() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 14a4 4 0 0 1 10 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="10" y1="1" x2="10" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="10" y1="11" x2="10" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="4" y1="7" x2="2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="18" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconSports() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 2.5 C7 5 7 15 10 17.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M10 2.5 C13 5 13 15 10 17.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconStocks() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <polyline points="2,14 6,9 10,12 14,6 18,8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
      <line x1="2" y1="17" x2="18" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
