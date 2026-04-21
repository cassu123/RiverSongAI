import React from 'react'

const ANALYTICS_FEATURES = [
  {
    key: 'usage',
    icon: IconBarChart,
    title: 'USAGE STATS',
    desc: 'Conversation counts, average session length, peak usage times, and token spend over time.',
    tags: ['Session counts', 'Token spend', 'Peak hours'],
  },
  {
    key: 'memory',
    icon: IconMemory,
    title: 'MEMORY TRENDS',
    desc: 'Visualise how River\'s memory of you grows — facts added, preferences inferred, summary retention over time.',
    tags: ['Fact growth', 'Preference drift', 'Summary retention'],
  },
  {
    key: 'routines',
    icon: IconRoutine,
    title: 'ROUTINE PERFORMANCE',
    desc: 'Track which routines run on time, how often they succeed, and what River\'s responses look like over time.',
    tags: ['Run history', 'Success rate', 'Response trends'],
  },
  {
    key: 'models',
    icon: IconModel,
    title: 'MODEL PERFORMANCE',
    desc: 'Compare response latency, token efficiency, and quality metrics across LLM providers and models.',
    tags: ['Latency tracking', 'Token efficiency', 'Provider compare'],
  },
]

export default function AnalyticsPage() {
  return (
    <div className="page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>SYSTEM</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>ANALYTICS</span>
      </div>
      <h1 className="page-title">Analytics</h1>
      <p className="page-subtitle">
        Insight into how River is being used, how memory grows, and how the system performs.
      </p>

      <div className="coming-soon-banner">
        <span className="coming-soon-tag">COMING SOON</span>
        <span className="coming-soon-text">
          Usage data is being collected. The analytics dashboard and visualisations ship in a future phase.
        </span>
      </div>

      <div className="feature-card-grid">
        {ANALYTICS_FEATURES.map(({ key, icon: Icon, title, desc, tags }) => (
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

function IconBarChart() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="11" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="8.5" y="7" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="14" y="4" width="3" height="13" rx="0.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="2" y1="17" x2="18" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconMemory() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="10" y1="3" x2="10" y2="17" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconRoutine() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <polyline points="11,2 6,11 10,11 9,18 14,9 10,9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}

function IconModel() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="10" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="10" cy="17" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="3" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="17" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="10" y1="4.5" x2="10" y2="7" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="10" y1="13" x2="10" y2="15.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="4.5" y1="10" x2="7" y2="10" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="13" y1="10" x2="15.5" y2="10" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}
