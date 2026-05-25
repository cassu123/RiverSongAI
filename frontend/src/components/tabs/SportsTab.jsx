import React, { useState, useEffect, useCallback, useRef } from 'react'
import { InlineSettingsSection } from '../TabSettingsPanel.jsx'

// All non-stub leagues available in the picker
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
          <img src={logo} alt={abbr} style={{ width: 24, height: 24, objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }} />
        )}
        <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{abbr}</span>
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

function GameCard({ game }) {
  const isScheduled = game.status !== 'STATUS_FINAL' && !game.is_live
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <StatusBadge game={game} />
        {game.venue && (
          <span className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.4 }}>{game.venue}</span>
        )}
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
        <div key={i} style={{ padding: '14px 0', borderBottom: '1px solid var(--md-outline-variant)' }}>
          <div style={{ height: 8, width: 60, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4, marginBottom: 12 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 10, width: 40, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
              <div style={{ height: 24, width: 30, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ height: 10, width: 40, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.4 }} />
              <div style={{ height: 24, width: 30, borderRadius: 4, background: 'var(--md-outline-variant)', opacity: 0.3 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Groups ALL_LEAGUES by category for the picker panel
const PICKER_GROUPS = ALL_LEAGUES.reduce((acc, l) => {
  if (!acc[l.category]) acc[l.category] = []
  acc[l.category].push(l)
  return acc
}, {})

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

export default function SportsTab({ token, active }) {
  const [favorites, setFavorites]       = useState(DEFAULT_LEAGUES)
  const [activeLeague, setActiveLeague] = useState(null)
  const [myTeams, setMyTeams]           = useState([])
  const [myTeamsMode, setMyTeamsMode]   = useState(false)
  const [games, setGames]               = useState([])
  const [fixtures, setFixtures]         = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const abortRef                        = useRef(null)
  const pollRef                         = useRef(null)

  const authHeaders = { Authorization: `Bearer ${token}` }

  // Load saved page settings + my teams on mount
  useEffect(() => {
    if (!active) return
    Promise.all([
      fetch('/api/settings/page', { headers: authHeaders }).then(r => r.ok ? r.json() : {}),
      fetch('/api/feeds/preferences', { headers: authHeaders }).then(r => r.ok ? r.json() : {}),
    ]).then(([pageSettings, feedPrefs]) => {
      const savedLeagues = pageSettings?.sports?.favorite_leagues
        || feedPrefs?.sports_favorite_leagues
        || DEFAULT_LEAGUES
      setFavorites(savedLeagues.length ? savedLeagues : DEFAULT_LEAGUES)
      setActiveLeague(l => l || (savedLeagues[0] || DEFAULT_LEAGUES[0]))
      const teams = feedPrefs?.sport_teams || []
      setMyTeams(teams)
    }).catch(() => {
      setActiveLeague(DEFAULT_LEAGUES[0])
    })
  }, [token, active])

  const fetchScoreboard = useCallback(async (leagueId, signal) => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feeds/sports/scoreboard/${leagueId}`, {
        headers: authHeaders, signal,
      })
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

  // Main fetch effect — fires on league change or mode toggle
  useEffect(() => {
    if (!activeLeague && !myTeamsMode) return
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    if (myTeamsMode) {
      fetchMyTeamsFeed(signal)
    } else {
      fetchScoreboard(activeLeague, signal)
    }

    return () => abortRef.current?.abort()
  }, [activeLeague, myTeamsMode, fetchScoreboard, fetchMyTeamsFeed])

  // Auto-refresh when live games are present
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    const hasLive = games.some(g => g.is_live)
    if (!hasLive || !active) return

    pollRef.current = setInterval(() => {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      if (myTeamsMode) fetchMyTeamsFeed(abortRef.current.signal)
      else fetchScoreboard(activeLeague, abortRef.current.signal)
    }, LIVE_POLL_MS)

    return () => clearInterval(pollRef.current)
  }, [games, active, activeLeague, myTeamsMode, fetchScoreboard, fetchMyTeamsFeed])

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

  const hasLiveGames = games.some(g => g.is_live)
  const allGames = myTeamsMode ? [...games, ...fixtures] : games

  return (
    <div>
      <InlineSettingsSection
        title="FAVORITE LEAGUES"
        icon="tune"
        subtitle={`${favorites.length} selected`}
      >
        <LeagueGrid favorites={favorites} onToggle={handleToggleLeague} />
      </InlineSettingsSection>

      {/* Header row: league pills + My Teams toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>

        {/* League pills (hidden in My Teams mode) */}
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

        {/* My Teams badge (replaces pills in my-teams mode) */}
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

        {/* Right side: My Teams toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {myTeams.length > 0 && (
            <button
              className={`rs-pill ${myTeamsMode ? 'is-active' : ''}`}
              onClick={() => setMyTeamsMode(m => !m)}
              style={{ fontSize: '0.62rem' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.85rem', marginRight: 4 }}>
                favorite
              </span>
              My Teams
            </button>
          )}

          {/* Live indicator dot */}
          {hasLiveGames && !myTeamsMode && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: '#f87171',
              boxShadow: '0 0 6px #f87171', flexShrink: 0,
            }} />
          )}
        </div>
      </div>

      {/* My Teams empty state */}
      {myTeamsMode && myTeams.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>group</span>
          <div className="rs-card-label" style={{ marginBottom: 6 }}>NO FAVORITE TEAMS</div>
          <div className="rs-card-meta">Add teams in Feed Preferences to use this view.</div>
        </div>
      )}

      {/* Game list */}
      {!(myTeamsMode && myTeams.length === 0) && (
        loading ? (
          <SportsSkeleton />
        ) : error ? (
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
            {games.map(g => <GameCard key={g.id} game={g} />)}
            {myTeamsMode && fixtures.length > 0 && (
              <>
                <div className="rs-card-label" style={{ fontSize: '0.55rem', opacity: 0.4, margin: '16px 0 8px' }}>UPCOMING</div>
                {fixtures.map(g => <GameCard key={g.id} game={g} />)}
              </>
            )}
          </div>
        )
      )}
    </div>
  )
}
