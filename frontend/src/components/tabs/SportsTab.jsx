// Backend:
//   GET  /api/feeds/sports/scoreboard/{league_id}        — scores + schedule (today)
//   GET  /api/feeds/sports/boxscore/{league_id}/{event}  — boxscore + team stats + leaders
//   GET  /api/feeds/sports                                — combined "my teams" feed
//   GET  /api/feeds/sports/news                           — articles from user-selected RSS
//   GET  /api/feeds/sports/news/sources                   — sports RSS catalogue
//   GET  /api/feeds/preferences                           — sport_teams + sports_news_sources
//   PUT  /api/feeds/preferences                           — round-trips selections
//   PATCH /api/settings/page  { sports: { favorite_leagues } }
//
// View model:
//   subTab: 'scores' | 'news'
//   view:   'list'   | 'detail'  (only meaningful when subTab === 'scores')

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { InlineSettingsSection } from '../TabSettingsPanel.jsx'

const ALL_LEAGUES = [
  { id: 'nfl',        label: 'NFL',              icon: '🏈', category: 'American Pro' },
  { id: 'nba',        label: 'NBA',              icon: '🏀', category: 'American Pro' },
  { id: 'mlb',        label: 'MLB',              icon: '⚾', category: 'American Pro' },
  { id: 'nhl',        label: 'NHL',              icon: '🏒', category: 'American Pro' },
  { id: 'mls',        label: 'MLS',              icon: '⚽', category: 'American Pro' },
  { id: 'wnba',       label: 'WNBA',             icon: '🏀', category: 'American Pro' },
  { id: 'nwsl',       label: 'NWSL',             icon: '⚽', category: 'American Pro' },
  { id: 'ncaaf',      label: 'NCAAF',            icon: '🏈', category: 'College' },
  { id: 'ncaab',      label: 'NCAAB',            icon: '🏀', category: 'College' },
  { id: 'ncaabw',     label: 'NCAAB Women',      icon: '🏀', category: 'College' },
  { id: 'epl',        label: 'Premier League',   icon: '⚽', category: 'Global Soccer' },
  { id: 'laliga',     label: 'La Liga',          icon: '⚽', category: 'Global Soccer' },
  { id: 'seriea',     label: 'Serie A',          icon: '⚽', category: 'Global Soccer' },
  { id: 'bundesliga', label: 'Bundesliga',       icon: '⚽', category: 'Global Soccer' },
  { id: 'ligue1',     label: 'Ligue 1',          icon: '⚽', category: 'Global Soccer' },
  { id: 'ucl',        label: 'Champions League', icon: '⚽', category: 'Global Soccer' },
  { id: 'uel',        label: 'Europa League',    icon: '⚽', category: 'Global Soccer' },
  { id: 'ligamx',     label: 'Liga MX',          icon: '⚽', category: 'Global Soccer' },
  { id: 'atp',        label: 'ATP Tennis',       icon: '🎾', category: 'Racket' },
  { id: 'wta',        label: 'WTA Tennis',       icon: '🎾', category: 'Racket' },
  { id: 'pga',        label: 'PGA Tour',         icon: '⛳', category: 'Golf' },
  { id: 'lpga',       label: 'LPGA',             icon: '⛳', category: 'Golf' },
]
const LEAGUE_BY_ID = Object.fromEntries(ALL_LEAGUES.map(l => [l.id, l]))
const DEFAULT_LEAGUES = ['nba', 'nfl', 'mlb']
const LIVE_POLL_MS = 30_000

const PICKER_GROUPS = ALL_LEAGUES.reduce((acc, l) => {
  if (!acc[l.category]) acc[l.category] = []
  acc[l.category].push(l)
  return acc
}, {})

// ──────────────────────────────────────────────────────────────────────────────
// Game card
// ──────────────────────────────────────────────────────────────────────────────

function fmtGameTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

function StatusBadge({ game }) {
  if (game.is_live) return (
    <span style={{
      background: 'rgba(248,113,113,0.15)', color: '#f87171',
      fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em',
      padding: '3px 8px', borderRadius: 4,
    }}>
      LIVE · {game.status_detail}
    </span>
  )
  if (game.status === 'STATUS_FINAL') return (
    <span style={{
      background: 'rgba(74,222,128,0.12)', color: '#4ade80',
      fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em',
      padding: '3px 8px', borderRadius: 4,
    }}>
      FINAL
    </span>
  )
  return (
    <span style={{
      background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface-variant)',
      fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em',
      padding: '3px 8px', borderRadius: 4,
    }}>
      {fmtGameTime(game.date)}
    </span>
  )
}

function TeamSide({ abbr, name, logo, score, winner, showScore, align = 'left' }) {
  const isRight = align === 'right'
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: isRight ? 'flex-end' : 'flex-start', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: isRight ? 'row-reverse' : 'row' }}>
        {logo && (
          <img src={logo} alt={abbr} style={{ width: 28, height: 28, objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }} />
        )}
        <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{abbr}</span>
      </div>
      <span className="rs-card-meta" style={{ fontSize: '0.68rem' }}>{name}</span>
      {showScore && score !== '' && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 900,
          color: winner ? 'var(--primary)' : 'var(--md-on-surface)', lineHeight: 1,
        }}>
          {score}
        </span>
      )}
    </div>
  )
}

function GameCard({ game, onClick }) {
  const isScheduled = game.status !== 'STATUS_FINAL' && !game.is_live
  const clickable   = !isScheduled
  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{
        padding: '14px 12px',
        borderBottom: '1px solid var(--md-outline-variant)',
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 8,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.background = 'var(--md-surface-container)' }}
      onMouseLeave={e => { if (clickable) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <StatusBadge game={game} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {game.venue && (
            <span className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.4 }}>{game.venue}</span>
          )}
          {clickable && (
            <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', opacity: 0.35 }}>chevron_right</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <TeamSide abbr={game.away_abbr} name={game.away_team} logo={game.away_logo}
          score={game.away_score} winner={game.away_winner} showScore={!isScheduled} />
        <div style={{ padding: '0 16px', fontSize: '1.1rem', fontWeight: 900, opacity: 0.2, flexShrink: 0 }}>@</div>
        <TeamSide abbr={game.home_abbr} name={game.home_team} logo={game.home_logo}
          score={game.home_score} winner={game.home_winner} showScore={!isScheduled} align="right" />
      </div>
    </div>
  )
}

function SportsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ padding: '14px 12px', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ height: 8, width: 60, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4, marginBottom: 12 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            {[0, 1].map(j => (
              <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: j ? 'flex-end' : 'flex-start' }}>
                <div style={{ height: 10, width: 48, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
                <div style={{ height: 24, width: 32, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// League picker grid (inline; used inside InlineSettingsSection)
// ──────────────────────────────────────────────────────────────────────────────

function LeagueGrid({ favorites, onToggle }) {
  return (
    <div>
      {Object.entries(PICKER_GROUPS).map(([cat, leagues]) => (
        <div key={cat} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.12em', opacity: 0.4, marginBottom: 8 }}>
            {cat.toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {leagues.map(l => {
              const active = favorites.includes(l.id)
              return (
                <button
                  key={l.id}
                  onClick={() => onToggle(l.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 20,
                    fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer',
                    border: active ? '1px solid var(--primary)' : '1px solid var(--md-outline-variant)',
                    background: active ? 'rgba(var(--primary-rgb,100,100,255),0.12)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--md-on-surface-variant)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span>{l.icon}</span>
                  {l.label}
                  {active && (
                    <span className="material-symbols-rounded" style={{ fontSize: '0.75rem' }}>check</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// News list (sources picker + article rows)
// ──────────────────────────────────────────────────────────────────────────────

function NewsArticleCard({ a }) {
  return (
    <div
      onClick={() => window.open(a.url, '_blank')}
      style={{
        display: 'flex', gap: 16,
        padding: '14px 0',
        borderBottom: '1px solid var(--md-outline-variant)',
        cursor: 'pointer',
      }}
    >
      {a.image_url && (
        <img
          src={a.image_url} alt=""
          style={{
            width: 80, height: 64, objectFit: 'cover', borderRadius: 6, flexShrink: 0,
            background: 'var(--md-surface-container-highest)',
          }}
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className="rs-card-label" style={{ fontSize: '0.56rem', color: 'var(--primary)', opacity: 0.9 }}>
            {a.source?.toUpperCase()}
          </span>
          {a.category && (
            <span className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.4 }}>
              {a.category.toUpperCase()}
            </span>
          )}
        </div>
        <div style={{
          fontWeight: 650, fontSize: '0.9rem', lineHeight: 1.3, marginBottom: 4,
          color: 'var(--md-on-surface)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {a.title}
        </div>
        {a.summary && (
          <div className="rs-card-meta" style={{
            fontSize: '0.78rem',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {a.summary}
          </div>
        )}
        <div className="rs-card-label" style={{ fontSize: '0.52rem', opacity: 0.35, marginTop: 6 }}>
          {a.published_at ? new Date(a.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
      </div>
    </div>
  )
}

function NewsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{ display: 'flex', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ width: 80, height: 64, borderRadius: 6, background: 'var(--md-outline-variant)', flexShrink: 0, opacity: 0.4 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ height: 9, width: '35%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.5 }} />
            <div style={{ height: 12, width: '85%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
            <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Box score view — handles both nested ("stats" sub-arrays) and flat shapes.
// ──────────────────────────────────────────────────────────────────────────────

function flattenTeamStats(teamStatsBlock) {
  // ESPN returns either:
  //   [{ name, displayName, stats: [{ name, displayValue, ... }, ...] }, ...]  (NFL/MLB)
  //   [{ name, displayName, displayValue }, ...]                                 (NBA/EPL)
  // Normalise into a flat [{ name, label, value }] list.
  const flat = []
  for (const item of teamStatsBlock || []) {
    if (item && Array.isArray(item.stats)) {
      for (const s of item.stats) {
        flat.push({
          name: s.name || s.abbreviation,
          label: s.displayName || s.shortDisplayName || s.name,
          value: s.displayValue ?? s.value,
        })
      }
    } else if (item && (item.displayValue != null || item.value != null)) {
      flat.push({
        name: item.name,
        label: item.displayName || item.shortDisplayName || item.name,
        value: item.displayValue ?? item.value,
      })
    }
  }
  return flat
}

function BoxScoreView({ event, boxscore, loading, onBack }) {
  const teams = boxscore?.boxscore?.teams || []
  const header = boxscore?.header || {}
  const comp = header.competitions?.[0] || {}
  const competitors = comp.competitors || []
  const home = competitors.find(c => c.homeAway === 'home') || competitors[1] || {}
  const away = competitors.find(c => c.homeAway === 'away') || competitors[0] || {}
  const leaders = boxscore?.leaders || []  // ESPN: array of { team, leaders: [{ displayName, leaders: [{ displayValue, athlete }] }] }
  const statusText = header?.competitions?.[0]?.status?.type?.shortDetail || ''

  const homeStats = teams.find(t => t.homeAway === 'home') || teams[1] || {}
  const awayStats = teams.find(t => t.homeAway === 'away') || teams[0] || {}
  const homeFlat = flattenTeamStats(homeStats.statistics)
  const awayFlat = flattenTeamStats(awayStats.statistics)

  // Pair by stat name so we can render side-by-side
  const statNames = []
  const seen = new Set()
  for (const s of homeFlat) { if (!seen.has(s.name)) { seen.add(s.name); statNames.push({ name: s.name, label: s.label }) } }
  for (const s of awayFlat) { if (!seen.has(s.name)) { seen.add(s.name); statNames.push({ name: s.name, label: s.label }) } }
  const homeBy = Object.fromEntries(homeFlat.map(s => [s.name, s.value]))
  const awayBy = Object.fromEntries(awayFlat.map(s => [s.name, s.value]))

  return (
    <div>
      {/* Back nav */}
      <button
        onClick={onBack}
        className="rs-pill"
        style={{ marginBottom: 16, padding: '5px 12px' }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>arrow_back</span>
        Back to scores
      </button>

      {/* Header card — big score line */}
      <div className="rs-card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="rs-card-label" style={{ fontSize: '0.6rem', opacity: 0.55 }}>
            {(event.league_id || '').toUpperCase()}
          </span>
          <span className="rs-card-label" style={{ fontSize: '0.6rem', color: statusText.toLowerCase().includes('final') ? '#4ade80' : '#f87171' }}>
            {statusText || (event.is_live ? 'LIVE' : 'FINAL')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <BoxTeam c={away} />
          <div style={{ fontSize: '1.4rem', opacity: 0.2, fontWeight: 900 }}>—</div>
          <BoxTeam c={home} align="right" />
        </div>
      </div>

      {loading && (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <div className="rs-card-meta" style={{ fontSize: '0.75rem', opacity: 0.6 }}>Loading box score…</div>
        </div>
      )}

      {/* Team stats comparison */}
      {!loading && statNames.length > 0 && (
        <div className="rs-card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 12, opacity: 0.6 }}>TEAM STATS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px 12px', alignItems: 'center' }}>
            <div className="rs-card-label" style={{ fontSize: '0.55rem', textAlign: 'left', opacity: 0.5 }}>
              {away.team?.abbreviation || 'AWAY'}
            </div>
            <div></div>
            <div className="rs-card-label" style={{ fontSize: '0.55rem', textAlign: 'right', opacity: 0.5 }}>
              {home.team?.abbreviation || 'HOME'}
            </div>
            {statNames.map(({ name, label }) => (
              <React.Fragment key={name}>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem', textAlign: 'left' }}>
                  {awayBy[name] ?? '—'}
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.66rem', textAlign: 'center', opacity: 0.55 }}>
                  {label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem', textAlign: 'right' }}>
                  {homeBy[name] ?? '—'}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Player leaders */}
      {!loading && leaders.length > 0 && (
        <div className="rs-card" style={{ padding: 16 }}>
          <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 12, opacity: 0.6 }}>LEADERS</div>
          {leaders.map((teamBlock, ti) => (
            <div key={ti} style={{ marginBottom: 14 }}>
              <div className="rs-card-label" style={{ fontSize: '0.58rem', color: 'var(--primary)', marginBottom: 6 }}>
                {teamBlock.team?.displayName?.toUpperCase()}
              </div>
              {(teamBlock.leaders || []).map((cat, ci) => {
                const athleteEntry = (cat.leaders || [])[0]
                if (!athleteEntry) return null
                return (
                  <div key={ci} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0',
                    borderBottom: ci < (teamBlock.leaders.length - 1) ? '1px solid var(--md-outline-variant)' : 'none',
                  }}>
                    <div>
                      <div className="rs-card-meta" style={{ fontSize: '0.6rem', opacity: 0.5 }}>{cat.displayName?.toUpperCase()}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.78rem' }}>
                        {athleteEntry.athlete?.displayName || '—'}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.85rem' }}>
                      {athleteEntry.displayValue || '—'}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {!loading && statNames.length === 0 && leaders.length === 0 && (
        <div className="rs-card" style={{ padding: '32px 16px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>sports</span>
          <div className="rs-card-meta">Detailed stats not yet published for this event.</div>
        </div>
      )}
    </div>
  )
}

function BoxTeam({ c, align = 'left' }) {
  const t = c?.team || {}
  const score = c?.score ?? ''
  const winner = c?.winner
  const isRight = align === 'right'
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: isRight ? 'flex-end' : 'flex-start', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: isRight ? 'row-reverse' : 'row' }}>
        {t.logo && <img src={t.logo} alt={t.abbreviation} style={{ width: 40, height: 40, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
        <div style={{ textAlign: isRight ? 'right' : 'left' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{t.abbreviation || '—'}</div>
          <div className="rs-card-meta" style={{ fontSize: '0.66rem' }}>{t.displayName}</div>
        </div>
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '2.4rem', fontWeight: 900, lineHeight: 1,
        color: winner ? 'var(--primary)' : 'var(--md-on-surface)',
      }}>
        {score || '—'}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export default function SportsTab({ token, active }) {
  const [favorites, setFavorites]       = useState(DEFAULT_LEAGUES)
  const [activeLeague, setActiveLeague] = useState(null)
  const [myTeams, setMyTeams]           = useState([])
  const [myTeamsMode, setMyTeamsMode]   = useState(false)
  const [games, setGames]               = useState([])
  const [fixtures, setFixtures]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  // Sub-tab inside Sports
  const [subTab, setSubTab] = useState('scores') // 'scores' | 'news'

  // News state
  const [articles, setArticles]             = useState([])
  const [articlesLoading, setArticlesL]     = useState(false)
  const [articlesError, setArticlesError]   = useState(null)
  const [allNewsSources, setAllNewsSources] = useState([])
  const [newsCatMeta, setNewsCatMeta]       = useState({})
  const [prefs, setPrefs]                   = useState(null)

  // Box-score detail
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [boxscore, setBoxscore]           = useState(null)
  const [boxLoading, setBoxLoading]       = useState(false)

  const abortRef = useRef(null)
  const pollRef  = useRef(null)
  const authHeaders = { Authorization: `Bearer ${token}` }

  // ── Load page settings + my teams + news catalogue on mount ────────────────
  useEffect(() => {
    if (!active) return
    Promise.all([
      fetch('/api/settings/page', { headers: authHeaders }).then(r => r.ok ? r.json() : {}),
      fetch('/api/feeds/preferences', { headers: authHeaders }).then(r => r.ok ? r.json() : {}),
      fetch('/api/feeds/sports/news/sources').then(r => r.ok ? r.json() : null),
    ]).then(([pageSettings, feedPrefs, catData]) => {
      const savedLeagues = pageSettings?.sports?.favorite_leagues
        || feedPrefs?.sports_favorite_leagues
        || DEFAULT_LEAGUES
      setFavorites(savedLeagues.length ? savedLeagues : DEFAULT_LEAGUES)
      setActiveLeague(l => l || (savedLeagues[0] || DEFAULT_LEAGUES[0]))
      setMyTeams(feedPrefs?.sport_teams || [])
      setPrefs(feedPrefs || {})
      if (catData) {
        setAllNewsSources(catData.sources || [])
        setNewsCatMeta(catData.categories || {})
      }
    }).catch(() => {
      setActiveLeague(DEFAULT_LEAGUES[0])
    })
  }, [token, active])

  // ── Scoreboard fetchers ────────────────────────────────────────────────────
  const fetchScoreboard = useCallback(async (leagueId, signal) => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feeds/sports/scoreboard/${leagueId}`, { headers: authHeaders, signal })
      if (!res.ok) throw new Error(`No scoreboard for ${leagueId.toUpperCase()}`)
      setGames(await res.json())
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  const fetchMyTeamsFeed = useCallback(async (signal) => {
    if (!myTeams.length) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/feeds/sports', { headers: authHeaders, signal })
      if (!res.ok) throw new Error('Could not load your teams feed.')
      const data = await res.json()
      setGames(data.results || [])
      setFixtures(data.fixtures || [])
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, myTeams])

  useEffect(() => {
    if (subTab !== 'scores') return
    if (!activeLeague && !myTeamsMode) return
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    if (myTeamsMode) fetchMyTeamsFeed(signal)
    else fetchScoreboard(activeLeague, signal)
    return () => abortRef.current?.abort()
  }, [activeLeague, myTeamsMode, subTab, fetchScoreboard, fetchMyTeamsFeed])

  // Live polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (subTab !== 'scores') return
    const hasLive = games.some(g => g.is_live)
    if (!hasLive || !active) return
    pollRef.current = setInterval(() => {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      if (myTeamsMode) fetchMyTeamsFeed(abortRef.current.signal)
      else fetchScoreboard(activeLeague, abortRef.current.signal)
    }, LIVE_POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [games, active, activeLeague, myTeamsMode, subTab, fetchScoreboard, fetchMyTeamsFeed])

  // ── News fetcher (lazy — only when News sub-tab is opened) ─────────────────
  const fetchArticles = useCallback(async () => {
    setArticlesL(true)
    setArticlesError(null)
    try {
      const res = await fetch('/api/feeds/sports/news', { headers: authHeaders })
      if (!res.ok) throw new Error('Could not load sports news.')
      setArticles(await res.json())
    } catch (e) {
      setArticlesError(e.message)
    } finally {
      setArticlesL(false)
    }
  }, [token])

  useEffect(() => {
    if (subTab === 'news' && active) fetchArticles()
  }, [subTab, active, fetchArticles])

  // ── Save handlers ──────────────────────────────────────────────────────────
  const saveFavorites = async (newFavs) => {
    await fetch('/api/settings/page', {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sports: { favorite_leagues: newFavs } }),
    }).catch(() => {})
  }

  const handleToggleLeague = (id) => {
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      const safe = next.length ? next : prev
      saveFavorites(safe)
      if (!safe.includes(activeLeague)) setActiveLeague(safe[0])
      return safe
    })
  }

  const saveSportsSources = async (nextSources) => {
    if (!prefs) return
    const updated = { ...prefs, sports_news_sources: nextSources }
    setPrefs(updated)
    try {
      await fetch('/api/feeds/preferences', {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      fetchArticles()
    } catch {/* best-effort */}
  }

  // ── Box-score nav ──────────────────────────────────────────────────────────
  const openEvent = useCallback(async (game) => {
    const leagueId = game.league_id || activeLeague
    if (!leagueId || !game.id) return
    setSelectedEvent({ ...game, league_id: leagueId })
    setBoxscore(null)
    setBoxLoading(true)
    try {
      const res = await fetch(`/api/feeds/sports/boxscore/${leagueId}/${game.id}`, { headers: authHeaders })
      if (res.ok) setBoxscore(await res.json())
    } catch {/* show empty state */}
    finally { setBoxLoading(false) }
  }, [activeLeague, token])

  const closeEvent = useCallback(() => {
    setSelectedEvent(null)
    setBoxscore(null)
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasLiveGames = games.some(g => g.is_live)
  const allGames = myTeamsMode ? [...games, ...fixtures] : games
  const selectedNewsSources = prefs?.sports_news_sources || []

  // ── Detail view short-circuits the entire tab body ─────────────────────────
  if (selectedEvent) {
    return (
      <BoxScoreView
        event={selectedEvent}
        boxscore={boxscore}
        loading={boxLoading}
        onBack={closeEvent}
      />
    )
  }

  return (
    <div>
      {/* Favorite leagues — inline settings */}
      <InlineSettingsSection
        title="FAVORITE LEAGUES"
        icon="tune"
        subtitle={`${favorites.length} selected`}
      >
        <LeagueGrid favorites={favorites} onToggle={handleToggleLeague} />
      </InlineSettingsSection>

      {/* Scores ↔ News sub-tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { key: 'scores', label: 'SCORES', icon: 'sports_score' },
          { key: 'news',   label: 'NEWS',   icon: 'feed' },
        ].map(t => (
          <button
            key={t.key}
            className={`rs-pill ${subTab === t.key ? 'is-active' : ''}`}
            onClick={() => setSubTab(t.key)}
            style={{ fontSize: '0.65rem' }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 4 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'scores' && (
        <ScoresView
          favorites={favorites}
          activeLeague={activeLeague}
          setActiveLeague={setActiveLeague}
          myTeams={myTeams}
          myTeamsMode={myTeamsMode}
          setMyTeamsMode={setMyTeamsMode}
          hasLiveGames={hasLiveGames}
          loading={loading}
          error={error}
          games={games}
          fixtures={fixtures}
          allGames={allGames}
          openEvent={openEvent}
        />
      )}

      {subTab === 'news' && (
        <NewsView
          allNewsSources={allNewsSources}
          newsCatMeta={newsCatMeta}
          selectedNewsSources={selectedNewsSources}
          saveSportsSources={saveSportsSources}
          articles={articles}
          loading={articlesLoading}
          error={articlesError}
          onRetry={fetchArticles}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Scores sub-view
// ──────────────────────────────────────────────────────────────────────────────

function ScoresView({
  favorites, activeLeague, setActiveLeague,
  myTeams, myTeamsMode, setMyTeamsMode, hasLiveGames,
  loading, error, games, fixtures, allGames, openEvent,
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {!myTeamsMode && favorites.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {favorites.map(id => {
              const meta = LEAGUE_BY_ID[id] || { label: id.toUpperCase(), icon: '🏆' }
              return (
                <button
                  key={id}
                  className={`rs-pill ${activeLeague === id ? 'is-active' : ''}`}
                  onClick={() => setActiveLeague(id)}
                  style={{ fontSize: '0.65rem' }}
                >
                  <span style={{ marginRight: 4 }}>{meta.icon}</span>
                  {meta.label}
                </button>
              )
            })}
          </div>
        )}
        {myTeamsMode && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="rs-card-label" style={{ fontSize: '0.65rem' }}>MY TEAMS</span>
            {hasLiveGames && (
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: '#f87171',
                boxShadow: '0 0 6px #f87171', flexShrink: 0,
              }} />
            )}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {myTeams.length > 0 && (
            <button
              className={`rs-pill ${myTeamsMode ? 'is-active' : ''}`}
              onClick={() => setMyTeamsMode(m => !m)}
              style={{ fontSize: '0.62rem' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.85rem', marginRight: 4 }}>favorite</span>
              My Teams
            </button>
          )}
          {hasLiveGames && !myTeamsMode && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#f87171',
              boxShadow: '0 0 6px #f87171', flexShrink: 0,
            }} />
          )}
        </div>
      </div>

      {myTeamsMode && myTeams.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>group</span>
          <div className="rs-card-label" style={{ marginBottom: 6 }}>NO FAVORITE TEAMS</div>
          <div className="rs-card-meta">Add teams in Feed Preferences to use this view.</div>
        </div>
      )}

      {!(myTeamsMode && myTeams.length === 0) && (
        loading ? <SportsSkeleton /> :
        error ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>sports</span>
            <div className="rs-card-meta">{error}</div>
          </div>
        ) : allGames.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>event_available</span>
            <div className="rs-card-label" style={{ marginBottom: 6 }}>NO GAMES TODAY</div>
            <div className="rs-card-meta">Check back on game day or switch leagues above.</div>
          </div>
        ) : (
          <div>
            {myTeamsMode && fixtures.length > 0 && games.length > 0 && (
              <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.4, marginBottom: 8 }}>RESULTS</div>
            )}
            {games.map(g => <GameCard key={g.id} game={g} onClick={() => openEvent(g)} />)}
            {myTeamsMode && fixtures.length > 0 && (
              <>
                <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.4, margin: '16px 0 8px' }}>UPCOMING</div>
                {fixtures.map(g => <GameCard key={g.id} game={g} onClick={() => openEvent(g)} />)}
              </>
            )}
          </div>
        )
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// News sub-view
// ──────────────────────────────────────────────────────────────────────────────

function NewsView({
  allNewsSources, newsCatMeta, selectedNewsSources, saveSportsSources,
  articles, loading, error, onRetry,
}) {
  const activeCount = selectedNewsSources.length
  const renderPicker = () => {
    if (!Object.keys(newsCatMeta).length) {
      return <div className="rs-card-meta" style={{ fontSize: '0.72rem', opacity: 0.5 }}>Loading source catalogue…</div>
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '14px 24px',
        }}
      >
        {Object.entries(newsCatMeta).map(([cat, meta]) => {
          const catSources = allNewsSources.filter(s => s.category === cat)
          if (!catSources.length) return null
          return (
            <div key={cat}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '0.85rem', opacity: 0.7 }}>{meta.icon}</span>
                <span className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.6 }}>{meta.label.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {catSources.map(src => {
                  const isOn = selectedNewsSources.some(s => s.url === src.url)
                  return (
                    <button
                      key={src.url}
                      className={`rs-pill ${isOn ? 'is-active' : ''}`}
                      onClick={() => {
                        const next = isOn
                          ? selectedNewsSources.filter(s => s.url !== src.url)
                          : [...selectedNewsSources, src]
                        saveSportsSources(next)
                      }}
                      style={{ fontSize: '0.6rem' }}
                    >
                      {src.name.toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <InlineSettingsSection
        title="SPORTS NEWS SOURCES"
        icon="rss_feed"
        subtitle={activeCount > 0 ? `${activeCount} selected` : 'all sports feeds'}
      >
        {renderPicker()}
      </InlineSettingsSection>

      {loading ? <NewsSkeleton /> :
       error ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.3, display: 'block', marginBottom: 8 }}>wifi_off</span>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>{error}</div>
          <button className="rs-pill" onClick={onRetry}>RETRY</button>
        </div>
       ) : !articles.length ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem', opacity: 0.2, display: 'block', marginBottom: 12 }}>newspaper</span>
          <div className="rs-card-meta">No articles right now. Try expanding the sources panel above.</div>
        </div>
       ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {articles.map((a, i) => (<NewsArticleCard key={a.url || i} a={a} />))}
        </div>
       )
      }
    </div>
  )
}
