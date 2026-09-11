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
  { id: 'nfl',        label: 'NFL',              icon: 'sports_football', category: 'American Pro' },
  { id: 'nba',        label: 'NBA',              icon: 'sports_basketball', category: 'American Pro' },
  { id: 'mlb',        label: 'MLB',              icon: 'sports_baseball', category: 'American Pro' },
  { id: 'nhl',        label: 'NHL',              icon: 'sports_hockey', category: 'American Pro' },
  { id: 'mls',        label: 'MLS',              icon: 'sports_soccer', category: 'American Pro' },
  { id: 'wnba',       label: 'WNBA',             icon: 'sports_basketball', category: 'American Pro' },
  { id: 'nwsl',       label: 'NWSL',             icon: 'sports_soccer', category: 'American Pro' },
  { id: 'ncaaf',      label: 'NCAAF',            icon: 'sports_football', category: 'College' },
  { id: 'ncaab',      label: 'NCAAB',            icon: 'sports_basketball', category: 'College' },
  { id: 'ncaabw',     label: 'NCAAB Women',      icon: 'sports_basketball', category: 'College' },
  { id: 'epl',        label: 'Premier League',   icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'laliga',     label: 'La Liga',          icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'seriea',     label: 'Serie A',          icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'bundesliga', label: 'Bundesliga',       icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'ligue1',     label: 'Ligue 1',          icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'ucl',        label: 'Champions League', icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'uel',        label: 'Europa League',    icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'ligamx',     label: 'Liga MX',          icon: 'sports_soccer', category: 'Global Soccer' },
  { id: 'atp',        label: 'ATP Tennis',       icon: 'sports_tennis', category: 'Racket' },
  { id: 'wta',        label: 'WTA Tennis',       icon: 'sports_tennis', category: 'Racket' },
  { id: 'pga',        label: 'PGA Tour',         icon: 'golf_course', category: 'Golf' },
  { id: 'lpga',       label: 'LPGA',             icon: 'golf_course', category: 'Golf' },
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
    <span className="rs-type-nano rs-c-critical rs-fw-800" style={{
      background: 'color-mix(in srgb, var(--rs-status-critical) 15%, transparent)',
      letterSpacing: '0.08em',
      padding: '3px 8px',
      borderRadius: 'var(--md-shape-xs)',
    }}>
      LIVE · {game.status_detail}
    </span>
  )
  if (game.status === 'STATUS_FINAL') return (
    <span className="rs-type-nano rs-c-nominal rs-fw-800" style={{
      background: 'color-mix(in srgb, var(--rs-status-nominal) 12%, transparent)',
      letterSpacing: '0.08em',
      padding: '3px 8px',
      borderRadius: 'var(--md-shape-xs)',
    }}>
      FINAL
    </span>
  )
  return (
    <span className="rs-type-nano rs-fw-700" style={{
      background: 'var(--md-surface-container-high)',
      color: 'var(--md-on-surface-variant)',
      letterSpacing: '0.06em',
      padding: '3px 8px',
      borderRadius: 'var(--md-shape-xs)',
    }}>
      {fmtGameTime(game.date)}
    </span>
  )
}

function TeamSide({ abbr, name, logo, score, winner, showScore, align = 'left' }) {
  const isRight = align === 'right'
  return (
    <div className="rs-grow rs-flex rs-flex-col rs-gap-1" style={{ alignItems: isRight ? 'flex-end' : 'flex-start' }}>
      <div className="rs-flex rs-items-center rs-gap-2" style={{ flexDirection: isRight ? 'row-reverse' : 'row' }}>
        {logo && (
          <img src={logo} alt={abbr} style={{ width: 28, height: 28, objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }} />
        )}
        <span className="rs-type-small rs-fw-800">{abbr}</span>
      </div>
      <span className="rs-card-meta rs-type-nano">{name}</span>
      {showScore && score !== '' && (
        <span className="rs-mono rs-fw-900" style={{
          fontSize: '1.6rem',
          color: winner ? 'var(--primary)' : 'var(--md-on-surface)',
          lineHeight: 1,
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
        padding: 'var(--rs-space-4) var(--rs-space-3)',
        borderBottom: '1px solid var(--md-outline-variant)',
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 'var(--md-shape-sm)',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.background = 'var(--md-surface-container)' }}
      onMouseLeave={e => { if (clickable) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="rs-flex rs-items-center rs-justify-between rs-mb-3">
        <StatusBadge game={game} />
        <div className="rs-flex rs-items-center rs-gap-2">
          {game.venue && (
            <span className="rs-card-label rs-muted rs-type-nano">{game.venue}</span>
          )}
          {clickable && (
            <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', opacity: 0.35 }}>chevron_right</span>
          )}
        </div>
      </div>
      <div className="rs-flex rs-items-center" style={{ gap: 0 }}>
        <TeamSide abbr={game.away_abbr} name={game.away_team} logo={game.away_logo}
          score={game.away_score} winner={game.away_winner} showScore={!isScheduled} />
        <div className="rs-type-body rs-no-shrink rs-fw-900" style={{ padding: '0 var(--rs-space-4)', opacity: 0.2 }}>@</div>
        <TeamSide abbr={game.home_abbr} name={game.home_team} logo={game.home_logo}
          score={game.home_score} winner={game.home_winner} showScore={!isScheduled} align="right" />
      </div>
    </div>
  )
}

function SportsSkeleton() {
  return (
    <div className="rs-flex rs-flex-col">
      {[0, 1, 2].map(i => (
        <div key={i} style={{ padding: 'var(--rs-space-4) var(--rs-space-3)', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-mb-3" style={{ height: 8, width: 60, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
          <div className="rs-flex rs-justify-between">
            {[0, 1].map(j => (
              <div key={j} className="rs-flex rs-flex-col rs-gap-2" style={{ alignItems: j ? 'flex-end' : 'flex-start' }}>
                <div style={{ height: 10, width: 48, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
                <div style={{ height: 24, width: 32, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.3 }} />
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
        <div key={cat} className="rs-mb-4">
          <div className="rs-mb-2 rs-muted rs-type-nano rs-fw-700" style={{ letterSpacing: '0.12em' }}>
            {cat.toUpperCase()}
          </div>
          <div className="rs-flex rs-flex-wrap rs-gap-2">
            {leagues.map(l => {
              const active = favorites.includes(l.id)
              return (
                <button
                  key={l.id}
                  onClick={() => onToggle(l.id)}
                  className="rs-flex rs-items-center rs-type-nano rs-pointer rs-fw-700" style={{
                    gap: 5,
                    padding: '5px 10px',
                    borderRadius: 'var(--md-shape-xl)',
                    border: active ? '1px solid var(--primary)' : '1px solid var(--md-outline-variant)',
                    background: active ? 'rgba(var(--primary-rgb,100,100,255),0.12)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--md-on-surface-variant)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>{l.icon}</span>
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
      className="rs-flex rs-gap-4 rs-pointer" style={{
        padding: 'var(--rs-space-4) 0',
        borderBottom: '1px solid var(--md-outline-variant)',
      }}
    >
      {a.image_url && (
        <img
          src={a.image_url} alt=""
          className="rs-no-shrink" style={{
            width: 80,
            height: 64,
            objectFit: 'cover',
            borderRadius: 'var(--md-shape-xs)',
            background: 'var(--md-surface-container-highest)',
          }}
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      <div className="rs-grow rs-min-w-0">
        <div className="rs-flex rs-items-center rs-gap-2" style={{ marginBottom: 5 }}>
          <span className="rs-card-label rs-type-nano rs-c-accent" style={{ opacity: 0.9 }}>
            {a.source?.toUpperCase()}
          </span>
          {a.category && (
            <span className="rs-card-label rs-muted rs-type-nano">
              {a.category.toUpperCase()}
            </span>
          )}
        </div>
        <div className="rs-mb-1 rs-type-small rs-clip" style={{
          fontWeight: 650,
          lineHeight: 1.3,
          color: 'var(--md-on-surface)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {a.title}
        </div>
        {a.summary && (
          <div className="rs-card-meta rs-type-micro rs-clip" style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {a.summary}
          </div>
        )}
        <div className="rs-card-label rs-mt-2 rs-muted rs-type-nano">
          {a.published_at ? new Date(a.published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </div>
      </div>
    </div>
  )
}

function NewsSkeleton() {
  return (
    <div className="rs-flex rs-flex-col rs-gap-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rs-flex rs-gap-4" style={{ padding: 'var(--rs-space-4) 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div className="rs-no-shrink" style={{ width: 80, height: 64, borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
          <div className="rs-grow rs-flex rs-flex-col rs-gap-2">
            <div style={{ height: 9, width: '35%', borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.5 }} />
            <div style={{ height: 12, width: '85%', borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.4 }} />
            <div style={{ height: 12, width: '70%', borderRadius: 'var(--md-shape-xs)', background: 'var(--md-outline-variant)', opacity: 0.3 }} />
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
        className="rs-pill rs-mb-4"
        style={{ padding: '5px 12px' }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 'var(--rs-space-1)' }}>arrow_back</span>
        Back to scores
      </button>

      {/* Header card — big score line */}
      <div className="rs-card rs-p-5 rs-mb-4">
        <div className="rs-flex rs-justify-between rs-items-center rs-mb-3">
          <span className="rs-card-label rs-muted rs-type-nano">
            {(event.league_id || '').toUpperCase()}
          </span>
          <span className="rs-card-label rs-type-nano" style={{ color: statusText.toLowerCase().includes('final') ? '#4ade80' : '#f87171' }}>
            {statusText || (event.is_live ? 'LIVE' : 'FINAL')}
          </span>
        </div>
        <div className="rs-flex rs-items-center rs-gap-3">
          <BoxTeam c={away} />
          <div className="rs-fw-900" style={{ fontSize: '1.4rem', opacity: 0.2 }}>—</div>
          <BoxTeam c={home} align="right" />
        </div>
      </div>

      {loading && (
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-6) 0' }}>
          <div className="rs-card-meta rs-muted rs-type-micro">Loading box score…</div>
        </div>
      )}

      {/* Team stats comparison */}
      {!loading && statNames.length > 0 && (
        <div className="rs-card rs-p-4 rs-mb-4">
          <div className="rs-card-label rs-mb-3 rs-muted rs-type-nano">TEAM STATS</div>
          <div className="rs-items-center" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--rs-space-2) var(--rs-space-3)' }}>
            <div className="rs-card-label rs-muted rs-type-nano rs-text-left">
              {away.team?.abbreviation || 'AWAY'}
            </div>
            <div></div>
            <div className="rs-card-label rs-muted rs-type-nano rs-text-right">
              {home.team?.abbreviation || 'HOME'}
            </div>
            {statNames.map(({ name, label }) => (
              <React.Fragment key={name}>
                <div className="rs-mono rs-type-micro rs-text-left rs-fw-700">
                  {awayBy[name] ?? '—'}
                </div>
                <div className="rs-card-meta rs-text-center rs-muted rs-type-nano">
                  {label}
                </div>
                <div className="rs-mono rs-type-micro rs-text-right rs-fw-700">
                  {homeBy[name] ?? '—'}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Player leaders */}
      {!loading && leaders.length > 0 && (
        <div className="rs-card rs-p-4">
          <div className="rs-card-label rs-mb-3 rs-muted rs-type-nano">LEADERS</div>
          {leaders.map((teamBlock, ti) => (
            <div key={ti} className="rs-mb-4">
              <div className="rs-card-label rs-mb-2 rs-type-nano rs-c-accent">
                {teamBlock.team?.displayName?.toUpperCase()}
              </div>
              {(teamBlock.leaders || []).map((cat, ci) => {
                const athleteEntry = (cat.leaders || [])[0]
                if (!athleteEntry) return null
                return (
                  <div key={ci} className="rs-flex rs-items-center rs-justify-between" style={{
                    padding: 'var(--rs-space-2) 0',
                    borderBottom: ci < (teamBlock.leaders.length - 1) ? '1px solid var(--md-outline-variant)' : 'none',
                  }}>
                    <div>
                      <div className="rs-card-meta rs-muted rs-type-nano">{cat.displayName?.toUpperCase()}</div>
                      <div className="rs-type-micro rs-fw-700">
                        {athleteEntry.athlete?.displayName || '—'}
                      </div>
                    </div>
                    <div className="rs-mono rs-type-tiny rs-fw-800">
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
        <div className="rs-card rs-text-center" style={{ padding: 'var(--rs-space-6) var(--rs-space-4)' }}>
          <span className="material-symbols-rounded rs-mb-2 rs-empty-glyph" style={{ fontSize: '2rem' }}>sports</span>
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
    <div className="rs-grow rs-flex rs-flex-col rs-gap-2" style={{ alignItems: isRight ? 'flex-end' : 'flex-start' }}>
      <div className="rs-flex rs-items-center rs-gap-2" style={{ flexDirection: isRight ? 'row-reverse' : 'row' }}>
        {t.logo && <img src={t.logo} alt={t.abbreviation} style={{ width: 40, height: 40, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />}
        <div style={{ textAlign: isRight ? 'right' : 'left' }}>
          <div className="rs-type-small rs-fw-800">{t.abbreviation || '—'}</div>
          <div className="rs-card-meta rs-type-nano">{t.displayName}</div>
        </div>
      </div>
      <div className="rs-mono rs-fw-900" style={{
        fontSize: '2.4rem',
        lineHeight: 1,
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
      <div className="rs-flex rs-gap-2 rs-mb-4">
        {[
          { key: 'scores', label: 'SCORES', icon: 'sports_score' },
          { key: 'news',   label: 'NEWS',   icon: 'feed' },
        ].map(t => (
          <button
            key={t.key}
            className={`rs-pill ${subTab === t.key ? 'is-active' : ''}`}
            onClick={() => setSubTab(t.key)}
            style={{ fontSize: 'var(--rs-fs-nano)' }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 'var(--rs-space-1)' }}>{t.icon}</span>
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
      <div className="rs-flex rs-items-start rs-gap-2 rs-mb-5 rs-flex-wrap">
        {!myTeamsMode && favorites.length > 0 && (
          <div className="rs-flex rs-gap-2 rs-flex-wrap rs-grow">
            {favorites.map(id => {
              const meta = LEAGUE_BY_ID[id] || { label: id.toUpperCase(), icon: 'emoji_events' }
              return (
                <button
                  key={id}
                  className={`rs-pill ${activeLeague === id ? 'is-active' : ''}`}
                  onClick={() => setActiveLeague(id)}
                  style={{ fontSize: 'var(--rs-fs-nano)' }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 'var(--rs-space-1)', verticalAlign: '-2px' }}>{meta.icon}</span>
                  {meta.label}
                </button>
              )
            })}
          </div>
        )}
        {myTeamsMode && (
          <div className="rs-grow rs-flex rs-items-center rs-gap-2">
            <span className="rs-card-label rs-type-nano">MY TEAMS</span>
            {hasLiveGames && (
              <span className="rs-no-shrink" style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#f87171',
                boxShadow: '0 0 6px #f87171',
              }} />
            )}
          </div>
        )}
        <div className="rs-flex rs-items-center rs-gap-2 rs-no-shrink">
          {myTeams.length > 0 && (
            <button
              className={`rs-pill ${myTeamsMode ? 'is-active' : ''}`}
              onClick={() => setMyTeamsMode(m => !m)}
              style={{ fontSize: 'var(--rs-fs-nano)' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.85rem', marginRight: 'var(--rs-space-1)' }}>favorite</span>
              My Teams
            </button>
          )}
          {hasLiveGames && !myTeamsMode && (
            <span className="rs-no-shrink" style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#f87171',
              boxShadow: '0 0 6px #f87171',
            }} />
          )}
        </div>
      </div>

      {myTeamsMode && myTeams.length === 0 && (
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
          <span className="material-symbols-rounded rs-mb-2 rs-empty-glyph" style={{ fontSize: '2rem' }}>group</span>
          <div className="rs-card-label rs-mb-2">NO FAVORITE TEAMS</div>
          <div className="rs-card-meta">Add teams in Feed Preferences to use this view.</div>
        </div>
      )}

      {!(myTeamsMode && myTeams.length === 0) && (
        loading ? <SportsSkeleton /> :
        error ? (
          <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
            <span className="material-symbols-rounded rs-mb-2 rs-empty-glyph" style={{ fontSize: '2rem' }}>sports</span>
            <div className="rs-card-meta">{error}</div>
          </div>
        ) : allGames.length === 0 ? (
          <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
            <span className="material-symbols-rounded rs-mb-2 rs-empty-glyph" style={{ fontSize: '2rem' }}>event_available</span>
            <div className="rs-card-label rs-mb-2">NO GAMES TODAY</div>
            <div className="rs-card-meta">Check back on game day or switch leagues above.</div>
          </div>
        ) : (
          <div>
            {myTeamsMode && fixtures.length > 0 && games.length > 0 && (
              <div className="rs-card-label rs-mb-2 rs-muted rs-type-nano">RESULTS</div>
            )}
            {games.map(g => <GameCard key={g.id} game={g} onClick={() => openEvent(g)} />)}
            {myTeamsMode && fixtures.length > 0 && (
              <>
                <div className="rs-card-label rs-muted rs-type-nano" style={{ margin: 'var(--rs-space-4) 0 var(--rs-space-2)' }}>UPCOMING</div>
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
      return <div className="rs-card-meta rs-muted rs-type-micro">Loading source catalogue…</div>
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--rs-space-4) var(--rs-space-5)',
        }}
      >
        {Object.entries(newsCatMeta).map(([cat, meta]) => {
          const catSources = allNewsSources.filter(s => s.category === cat)
          if (!catSources.length) return null
          return (
            <div key={cat}>
              <div className="rs-flex rs-items-center rs-gap-2 rs-mb-2">
                <span className="material-symbols-rounded" style={{ fontSize: '0.85rem', opacity: 0.7 }}>{meta.icon}</span>
                <span className="rs-card-label rs-muted rs-type-nano">{meta.label.toUpperCase()}</span>
              </div>
              <div className="rs-flex rs-gap-2 rs-flex-wrap">
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
                      style={{ fontSize: 'var(--rs-fs-nano)' }}
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
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-5) 0' }}>
          <span className="material-symbols-rounded rs-mb-2" style={{ fontSize: '2rem', opacity: 0.3, display: 'block' }}>wifi_off</span>
          <div className="rs-card-meta rs-mb-3">{error}</div>
          <button className="rs-pill" onClick={onRetry}>RETRY</button>
        </div>
       ) : !articles.length ? (
        <div className="rs-text-center" style={{ padding: 'var(--rs-space-6) 0' }}>
          <span className="material-symbols-rounded rs-mb-3 rs-empty-glyph" style={{ fontSize: '2.5rem' }}>newspaper</span>
          <div className="rs-card-meta">No articles right now. Try expanding the sources panel above.</div>
        </div>
       ) : (
        <div className="rs-flex rs-flex-col rs-gap-3">
          {articles.map((a, i) => (<NewsArticleCard key={a.url || i} a={a} />))}
        </div>
       )
      }
    </div>
  )
}
