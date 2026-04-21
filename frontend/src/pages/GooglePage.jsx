import React from 'react'

const GOOGLE_FEATURES = [
  {
    key: 'calendar',
    icon: IconCalendar,
    title: 'CALENDAR',
    desc: 'Ask River what\'s on your schedule, add events by voice, or get a daily agenda briefing each morning.',
    tags: ['Google Calendar', 'Event creation', 'Daily briefing'],
  },
  {
    key: 'gmail',
    icon: IconMail,
    title: 'GMAIL',
    desc: 'Hear unread email summaries, draft replies by voice, and have River flag important messages.',
    tags: ['Inbox summary', 'Voice drafting', 'Priority filters'],
  },
  {
    key: 'maps',
    icon: IconMaps,
    title: 'MAPS & NAVIGATION',
    desc: 'Get travel time estimates, find nearby places, and ask River for directions conversationally.',
    tags: ['Travel time', 'Place search', 'Route info'],
  },
  {
    key: 'music',
    icon: IconMusic,
    title: 'YOUTUBE MUSIC',
    desc: 'Control music playback by voice — play an artist, queue an album, skip tracks, or ask what\'s playing.',
    tags: ['Voice playback', 'Queue control', 'Artist / album search'],
  },
]

export default function GooglePage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>INTEGRATIONS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>GOOGLE</span>
      </div>
      <h1 className="page-title">Google</h1>
      <p className="page-subtitle">
        Connect your Google account to bring Calendar, Gmail, Maps, and Music into conversation.
      </p>

      <div className="coming-soon-banner">
        <span className="coming-soon-tag">COMING SOON</span>
        <span className="coming-soon-text">
          Google OAuth and service integrations are scaffolded. The connection flow and conversation hooks ship in a future phase.
        </span>
      </div>

      <div className="feature-card-grid">
        {GOOGLE_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
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

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="6" y1="2" x2="6" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="14" y1="2" x2="14" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="9" x2="18" y2="9" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="6" y="12" width="3" height="3" rx="0.5" fill="currentColor"/>
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="2,5 10,11 18,5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}

function IconMaps() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2a5 5 0 0 1 5 5c0 4-5 11-5 11S5 11 5 7a5 5 0 0 1 5-5z" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="10" cy="7" r="2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconMusic() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="6" cy="15" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="14" cy="13" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="8.5,15 8.5,5 16.5,3 16.5,13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}
