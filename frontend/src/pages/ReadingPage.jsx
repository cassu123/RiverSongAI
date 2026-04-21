import React from 'react'

const READING_FEATURES = [
  {
    key: 'audible',
    icon: IconHeadphones,
    title: 'AUDIBLE',
    desc: 'Control audiobook playback by voice, get chapter summaries, bookmark moments, and pick up where you left off.',
    tags: ['Playback control', 'Chapter summaries', 'Bookmarks'],
  },
  {
    key: 'libby',
    icon: IconBook,
    title: 'LIBBY / OVERDRIVE',
    desc: 'Browse your public library\'s digital collection, place holds, manage loans, and have River recommend your next read.',
    tags: ['Library loans', 'Hold management', 'Recommendations'],
  },
]

export default function ReadingPage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>INTEGRATIONS</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>READING</span>
      </div>
      <h1 className="page-title">Reading</h1>
      <p className="page-subtitle">
        Audiobooks and library loans — managed and discussed by voice.
      </p>

      <div className="coming-soon-banner">
        <span className="coming-soon-tag">COMING SOON</span>
        <span className="coming-soon-text">
          Reading providers (Audible, Libby) are scaffolded. Authentication and conversation hooks ship in a future phase.
        </span>
      </div>

      <div className="feature-card-grid feature-card-grid--2col">
        {READING_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
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

function IconHeadphones() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 11V10a7 7 0 0 1 14 0v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <rect x="2" y="11" width="3" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="15" y="11" width="3" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconBook() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13l-7-3-7 3V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}
