import React from 'react'
import EnvIcon from './EnvIcon.jsx'

/**
 * Foyer mode. Greeting + a composed flow of glass cards. Cards share a
 * common label/value rhythm (StatCard) so the page reads as one composition,
 * not floating islands.
 */
export default function PreviewDashboard({ displayName = 'Cheryl' }) {
  const now = new Date()
  const hour = now.getHours()
  const greeting =
    hour < 5  ? 'Still up' :
    hour < 12 ? 'Good morning' :
    hour < 18 ? 'Good afternoon' :
                'Good evening'

  return (
    <div className="rs-foyer">
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting}, {displayName}.</h1>
        <p className="rs-greeting-sub">Here's where things stand.</p>
      </header>

      <div className="rs-card-flow">
        <StatCard icon="mail"    label="Email"   value="3 unread" />
        <StatCard icon="weather" label="Weather" value="76°F · Clear" />

        <article className="rs-card is-wide is-tappable">
          <header className="rs-card-head">
            <span className="rs-card-label">
              <EnvIcon name="events" className="rs-card-label-icon" />
              Events · 2 today
            </span>
            <EnvIcon name="chevron_right" className="rs-card-chevron" />
          </header>
          <ul className="rs-event-list">
            <li><span className="rs-event-time">09:00</span><span>Team sync</span></li>
            <li><span className="rs-event-time">14:00</span><span>PT test</span></li>
          </ul>
        </article>

        <article className="rs-card is-elev is-tappable">
          <div className="rs-card-row">
            <EnvIcon name="memory" className="rs-card-icon" />
            <div className="rs-card-body">
              <div className="rs-card-label">Memory</div>
              <div className="rs-card-value">2 new facts</div>
              <div className="rs-card-meta">captured today</div>
            </div>
          </div>
        </article>
      </div>

      <footer className="rs-status-strip">
        <span className="rs-status-dot" aria-hidden="true" />
        System · Nominal · 7h uptime
      </footer>
    </div>
  )
}

/** Tiny stat card — icon + label + value, used for the grid of quick reads. */
function StatCard({ icon, label, value }) {
  return (
    <article className="rs-card is-tappable">
      <div className="rs-card-row">
        <EnvIcon name={icon} className="rs-card-icon" />
        <div className="rs-card-body">
          <div className="rs-card-label">{label}</div>
          <div className="rs-card-value">{value}</div>
        </div>
      </div>
    </article>
  )
}
