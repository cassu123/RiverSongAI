// Audit: Sports backend uses ESPN public API (no key required).
// Available endpoints:
//   GET /api/feeds/sports/leagues         → { leagues: [{id, label, icon, category}] }
//   GET /api/feeds/sports/scoreboard/{id} → array of game objects:
//     { id, name, short_name, date, status, status_detail, is_live,
//       home_team, home_abbr, home_logo, home_score, home_winner,
//       away_team, away_abbr, away_logo, away_score, away_winner,
//       venue, league_id }
//   GET /api/feeds/sports/teams/{id}      → team list
// Cache: 60s at ESPN provider level; no additional client cache.
// Missing: no team-specific filter in scoreboard (shows all games in league).
// Frontend uses prefs.sports_favorite_leagues for default league order.

import React, { useState, useEffect, useCallback, useRef } from 'react'

const LEAGUE_META = {
  nfl:    { label: 'NFL',    icon: '🏈' },
  nba:    { label: 'NBA',    icon: '🏀' },
  mlb:    { label: 'MLB',    icon: '⚾' },
  nhl:    { label: 'NHL',    icon: '🏒' },
  mls:    { label: 'MLS',    icon: '⚽' },
  ncaaf:  { label: 'NCAAF',  icon: '🏈' },
  ncaab:  { label: 'NCAAB',  icon: '🏀' },
  epl:    { label: 'EPL',    icon: '⚽' },
  laliga: { label: 'La Liga',icon: '⚽' },
  wnba:   { label: 'WNBA',   icon: '🏀' },
}

const DEFAULT_LEAGUES = ['nba', 'nfl', 'mlb']

function fmtGameTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function StatusBadge({ game }) {
  if (game.is_live) return (
    <span style={{
      background: 'rgba(248,113,113,0.15)',
      color: '#f87171',
      fontSize: '0.58rem',
      fontWeight: 800,
      letterSpacing: '0.08em',
      padding: '3px 8px',
      borderRadius: 4,
    }}>
      LIVE · {game.status_detail}
    </span>
  )
  if (game.status === 'STATUS_FINAL') return (
    <span style={{
      background: 'rgba(74,222,128,0.12)',
      color: '#4ade80',
      fontSize: '0.58rem',
      fontWeight: 800,
      letterSpacing: '0.08em',
      padding: '3px 8px',
      borderRadius: 4,
    }}>
      FINAL
    </span>
  )
  return (
    <span style={{
      background: 'var(--md-surface-container-high)',
      color: 'var(--md-on-surface-variant)',
      fontSize: '0.58rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '3px 8px',
      borderRadius: 4,
    }}>
      {fmtGameTime(game.date)}
    </span>
  )
}

function GameCard({ game }) {
  const isScheduled = game.status !== 'STATUS_FINAL' && !game.is_live
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--md-outline-variant)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <StatusBadge game={game} />
        {game.venue && (
          <span className="rs-card-label" style={{ fontSize: '0.5rem', opacity: 0.4 }}>
            {game.venue}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {/* Away */}
        <TeamSide
          abbr={game.away_abbr}
          name={game.away_team}
          logo={game.away_logo}
          score={game.away_score}
          winner={game.away_winner}
          showScore={!isScheduled}
        />

        <div style={{
          padding: '0 16px',
          fontSize: '1.1rem',
          fontWeight: 900,
          opacity: 0.2,
          flexShrink: 0,
        }}>
          @
        </div>

        {/* Home */}
        <TeamSide
          abbr={game.home_abbr}
          name={game.home_team}
          logo={game.home_logo}
          score={game.home_score}
          winner={game.home_winner}
          showScore={!isScheduled}
          align="right"
        />
      </div>
    </div>
  )
}

function TeamSide({ abbr, name, logo, score, winner, showScore, align = 'left' }) {
  const isRight = align === 'right'
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: isRight ? 'flex-end' : 'flex-start',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: isRight ? 'row-reverse' : 'row' }}>
        {logo && (
          <img
            src={logo}
            alt={abbr}
            style={{ width: 24, height: 24, objectFit: 'contain' }}
            onError={e => { e.target.style.display = 'none' }}
          />
        )}
        <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{abbr}</span>
      </div>
      <span className="rs-card-meta" style={{ fontSize: '0.68rem' }}>{name}</span>
      {showScore && score !== '' && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 900,
          color: winner ? 'var(--primary)' : 'var(--md-on-surface)',
          lineHeight: 1,
        }}>
          {score}
        </span>
      )}
    </div>
  )
}

export default function SportsTab({ token, active }) {
  const [prefs, setPrefs]         = useState(null)
  const [leagues, setLeagues]     = useState(DEFAULT_LEAGUES)
  const [activeLeague, setActive] = useState(null)
  const [games, setGames]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const abortRef                  = useRef(null)

  // Load prefs once to get favorite leagues
  useEffect(() => {
    if (!active) return
    fetch('/api/feeds/preferences', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        const favs = p?.sports_favorite_leagues
        const list = (favs?.length ? favs : DEFAULT_LEAGUES)
        setLeagues(list)
        setActive(l => l || list[0])
        setPrefs(p)
      })
      .catch(() => {})
  }, [token, active])

  const fetchScoreboard = useCallback(async (leagueId) => {
    if (!leagueId || !active) return
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/feeds/sports/scoreboard/${leagueId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortRef.current.signal,
      })
      if (!res.ok) throw new Error(`No scoreboard for ${leagueId.toUpperCase()}`)
      setGames(await res.json())
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, active])

  useEffect(() => {
    if (activeLeague) fetchScoreboard(activeLeague)
  }, [activeLeague, fetchScoreboard])

  return (
    <div>
      {/* League selector */}
      {leagues.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {leagues.map(id => {
            const meta = LEAGUE_META[id] || { label: id.toUpperCase(), icon: '🏆' }
            return (
              <button
                key={id}
                className={`rs-pill ${activeLeague === id ? 'is-active' : ''}`}
                onClick={() => setActive(id)}
                style={{ fontSize: '0.65rem' }}
              >
                <span style={{ marginRight: 4 }}>{meta.icon}</span>
                {meta.label}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <SportsSkeleton />
      ) : error ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>sports</span>
          <div className="rs-card-meta">{error}</div>
        </div>
      ) : games.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '2rem', opacity: 0.2, display: 'block', marginBottom: 8 }}>event_available</span>
          <div className="rs-card-label" style={{ marginBottom: 6 }}>NO GAMES TODAY</div>
          <div className="rs-card-meta">Check back on game day or switch leagues above.</div>
        </div>
      ) : (
        <div>
          {games.map(g => <GameCard key={g.id} game={g} />)}
        </div>
      )}
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
