import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { apiFetch, toast } from '../lib/api.js'
import RsMarkdown from '../components/RsMarkdown.jsx'
import { MusicDiscoveryCard } from '../components/widgets/MusicDiscoveryCard.jsx'

/**
 * BriefingPage — Daily Briefing
 * -----------------------------------------------------------------------------
 * The user's first screen: what's happening today, what needs their attention,
 * and what changed while they were away.
 *
 * Data comes from ONE aggregate call (`/api/briefing/summary`) rather than the
 * four independent fetches this page used to make. Each section of that payload
 * carries its own `status`, which is what lets the cards below tell "nothing
 * scheduled" apart from "not connected" apart from "upstream is down" — the old
 * version collapsed all three into an identical empty card.
 */

/** Local calendar date (YYYY-MM-DD). Never use toISOString() here: that is UTC,
 *  and it put tomorrow's date on the evening briefing for any zone behind it. */
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4).replace(/^\s*\n/, '')
}

/** New daily notes are templated as "# YYYY-MM-DD". Rendering that verbatim
 *  showed a giant date heading and nothing else, which read as a broken card. */
function stripDateHeading(body) {
  return body.replace(/^\s*#\s*\d{4}-\d{2}-\d{2}\s*$/m, '').trim()
}

function openDailyInChronos(virtualPath) {
  if (!virtualPath) return
  const parts = virtualPath.split('/')
  const root = parts.shift()
  const title = parts.join('/').replace(/\.md$/, '')
  try {
    localStorage.setItem('rs-chronos-open', JSON.stringify({ title, root }))
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('rs-navigate', { detail: { page: 'chronos' } }))
  } catch {}
}

function fmtEventTime(ev) {
  if (ev.all_day) return 'All day'
  if (!ev.start) return ''
  const d = new Date(ev.start)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDue(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const today = localDateKey()
  const due = localDateKey(d)
  if (due === today) return 'Today'
  const tomorrow = localDateKey(new Date(Date.now() + 86400000))
  if (due === tomorrow) return 'Tomorrow'
  if (due < today) return 'Overdue'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* ── Small presentational helpers ─────────────────────────────────────────── */

function CardLabel({ icon, children, tone }) {
  return (
    <span className="rs-card-label" data-tone={tone}>
      <span className="material-symbols-rounded rs-card-label-icon">{icon}</span>
      {children}
    </span>
  )
}

/** Neutral, self-explaining state for a card that has nothing to show. */
function CardState({ icon, message, actionLabel, onAction }) {
  return (
    <div className="rs-card-state">
      <span className="material-symbols-rounded rs-card-state-icon">{icon}</span>
      <p className="rs-card-state-msg">{message}</p>
      {actionLabel && onAction && (
        <button className="rs-pill" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

function Skeleton({ lines = 3 }) {
  return (
    <div className="rs-skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="rs-skeleton-line" />
      ))}
    </div>
  )
}

const SEVERITY_ICON = {
  critical: 'e_mobiledata_badge',
  warning: 'warning',
  info: 'info',
}

export default function BriefingPage({ onNavigate }) {
  const { user, token } = useAuth()

  const [brief, setBrief] = useState(null)
  const [briefError, setBriefError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [summary, setSummary] = useState('')
  const [dailyPath, setDailyPath] = useState(null)
  const [dailyLoading, setDailyLoading] = useState(true)

  const [musicPrefs, setMusicPrefs] = useState({ music_provider: 'youtube_music' })
  const [musicTracks, setMusicTracks] = useState([])
  const [musicLoading, setMusicLoading] = useState(true)
  const [musicError, setMusicError] = useState(null)

  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef(null)

  const todayKey = localDateKey()

  /* ── Aggregate briefing ─────────────────────────────────────────────── */
  const fetchBrief = useCallback(async () => {
    setBriefError(null)
    try {
      const data = await apiFetch('/api/briefing/summary', { silent: true })
      setBrief(data)
    } catch (e) {
      setBriefError(e.message || 'Briefing unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  /* ── Today's daily note ─────────────────────────────────────────────── */
  const fetchDaily = useCallback(async () => {
    try {
      const data = await apiFetch('/api/vault/daily/today', { silent: true })
      setDailyPath(data.virtual_path)
      setSummary(stripDateHeading(stripFrontmatter(data.content || '')))
    } catch {
      setSummary('')
    } finally {
      setDailyLoading(false)
    }
  }, [])

  /* ── Music discovery ────────────────────────────────────────────────── */
  const fetchMusic = useCallback(async () => {
    setMusicError(null)
    try {
      const prefs = await apiFetch('/api/settings', { silent: true })
      setMusicPrefs(prefs)
      if (prefs.music_provider !== 'youtube_music') {
        setMusicLoading(false)
        return
      }
      const data = await apiFetch('/api/google/music/home', { silent: true })
      if (data.success) setMusicTracks(data.data || [])
      else setMusicError('Charts unavailable right now.')
    } catch (e) {
      // Previously swallowed, which rendered as a permanently blank card.
      setMusicError(e.status === 502
        ? 'Music service is not responding.'
        : 'Could not load music.')
    } finally {
      setMusicLoading(false)
    }
  }, [])

  const refreshAll = useCallback(() => {
    setLoading(true)
    setDailyLoading(true)
    setMusicLoading(true)
    fetchBrief(); fetchDaily(); fetchMusic()
  }, [fetchBrief, fetchDaily, fetchMusic])

  useEffect(() => {
    if (!token) return
    fetchBrief(); fetchDaily(); fetchMusic()
  }, [token, fetchBrief, fetchDaily, fetchMusic])

  // Release the object URL for any briefing audio still held at unmount.
  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
  }, [])

  /* ── Spoken briefing ────────────────────────────────────────────────── */
  const handlePlayBriefing = useCallback(async () => {
    if (speaking && audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    try {
      const res = await apiFetch('/api/briefing/speak', {
        method: 'POST', body: {}, raw: true, silent: true,
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        setSpeaking(false)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        setSpeaking(false)
        toast('Could not play the briefing audio.')
      }
      await audio.play()
    } catch (e) {
      setSpeaking(false)
      toast(e.status === 503
        ? 'Voice engine is unavailable.'
        : 'Could not play the briefing.')
    }
  }, [speaking])

  const handlePlayMusic = async (videoId) => {
    try {
      await apiFetch(`/api/google/music/play/${videoId}`, { method: 'POST', silent: true })
    } catch {
      toast('Playback failed.')
    }
  }

  const firstName = brief?.name || user?.display_name?.split(' ')[0] || 'Operator'
  const weather = brief?.weather
  const agenda = brief?.agenda
  const reminders = brief?.reminders
  const updates = brief?.updates
  const headlines = brief?.headlines

  const dateLabel = brief?.date_label ||
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="rs-foyer rs-briefing animate-fade-in">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header className="rs-briefing-hero">
        <div className="rs-briefing-hero-text">
          <h1 className="rs-greeting">
            {brief?.greeting || 'Hello'}, {firstName}.
          </h1>

          <div className="rs-briefing-meta">
            {weather?.status === 'ok' && weather.temperature != null ? (
              <span className="rs-briefing-weather">
                <span className="material-symbols-rounded">{weather.icon}</span>
                <strong>{weather.temperature}°{weather.unit}</strong>
                <span className="rs-briefing-weather-desc">{weather.description}</span>
                {weather.high != null && weather.low != null && (
                  <span className="rs-briefing-weather-range">
                    H {weather.high}° · L {weather.low}°
                  </span>
                )}
              </span>
            ) : weather?.status === 'unconfigured' ? (
              <button className="rs-briefing-weather is-action" onClick={() => onNavigate('feeds')}>
                <span className="material-symbols-rounded">add_location_alt</span>
                Set your location for weather
              </button>
            ) : weather?.status === 'unavailable' ? (
              <span className="rs-briefing-weather is-muted">
                <span className="material-symbols-rounded">cloud_off</span>
                Weather unavailable
              </span>
            ) : loading ? (
              <span className="rs-briefing-weather is-muted">
                <span className="rs-skeleton-line" style={{ width: 140 }} />
              </span>
            ) : null}

            <span className="rs-briefing-date">{dateLabel}</span>
          </div>
        </div>

        <div className="rs-briefing-hero-actions">
          <button
            className="rs-btn-primary rs-briefing-play"
            onClick={handlePlayBriefing}
            disabled={loading || !!briefError}
            aria-pressed={speaking}
          >
            <span className="material-symbols-rounded">
              {speaking ? 'stop_circle' : 'play_circle'}
            </span>
            {speaking ? 'Stop' : 'Play briefing'}
          </button>
          <button
            className="rs-icon-btn"
            onClick={refreshAll}
            title="Refresh briefing"
            aria-label="Refresh briefing"
          >
            <span className="material-symbols-rounded">refresh</span>
          </button>
        </div>
      </header>

      {briefError && (
        <div className="rs-briefing-banner" role="status">
          <span className="material-symbols-rounded">error</span>
          <span>{briefError}</span>
          <button className="rs-pill" onClick={refreshAll}>Retry</button>
        </div>
      )}

      {/* ── Cards ────────────────────────────────────────────────────── */}
      <div className="rs-briefing-grid">

        {/* Needs attention — the "important stuff" */}
        {(loading || (updates?.items?.length > 0)) && (
          <section className="rs-card is-elev rs-span-2">
            <div className="rs-card-head">
              <CardLabel icon="priority_high" tone="alert">Needs attention</CardLabel>
              {updates?.items?.length > 0 && (
                <span className="rs-count-chip">{updates.items.length}</span>
              )}
            </div>
            {loading ? <Skeleton lines={2} /> : (
              <ul className="rs-update-list">
                {updates.items.slice(0, 6).map((u, i) => (
                  <li key={i} className={`rs-update-item is-${u.severity || 'info'}`}>
                    <span className="material-symbols-rounded rs-update-icon">
                      {SEVERITY_ICON[u.severity] || 'info'}
                    </span>
                    <span className="rs-update-body">
                      <span className="rs-update-title">{u.title || 'Update'}</span>
                      {u.body && <span className="rs-update-text">{u.body}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Agenda */}
        <section className="rs-card">
          <div className="rs-card-head">
            <CardLabel icon="calendar_today">Agenda</CardLabel>
            {agenda?.status === 'ok' && agenda.events.length > 0 && (
              <span className="rs-count-chip">{agenda.events.length}</span>
            )}
          </div>

          {loading ? <Skeleton /> :
            agenda?.status === 'disconnected' ? (
              <CardState
                icon="link_off"
                message="Google Calendar isn't connected."
                actionLabel="Connect Google"
                onAction={() => onNavigate('google')}
              />
            ) : agenda?.status === 'unavailable' ? (
              <CardState icon="sync_problem" message="Calendar sync is unavailable right now."
                         actionLabel="Retry" onAction={refreshAll} />
            ) : agenda?.events?.length ? (
              <ul className="rs-agenda-list">
                {agenda.events.map((ev, i) => (
                  <li key={ev.id || i} className={`rs-agenda-item ${i === 0 ? 'is-next' : ''}`}>
                    <span className="rs-agenda-time">{fmtEventTime(ev)}</span>
                    <span className="rs-agenda-title">{ev.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardState icon="event_available" message="Nothing scheduled today." />
            )
          }

          <button className="rs-card-action" onClick={() => onNavigate('google')}>
            View calendar
            <span className="material-symbols-rounded">chevron_right</span>
          </button>
        </section>

        {/* Reminders */}
        <section className="rs-card">
          <div className="rs-card-head">
            <CardLabel icon="task_alt">Reminders</CardLabel>
            {reminders?.status === 'ok' && reminders.items.length > 0 && (
              <span className="rs-count-chip">{reminders.items.length}</span>
            )}
          </div>

          {loading ? <Skeleton /> :
            reminders?.status !== 'ok' ? (
              <CardState
                icon="link_off"
                message="Connect Google to see your reminders."
                actionLabel="Connect Google"
                onAction={() => onNavigate('google')}
              />
            ) : reminders.items.length ? (
              <ul className="rs-reminder-list">
                {reminders.items.slice(0, 6).map((r, i) => {
                  const due = fmtDue(r.due)
                  return (
                    <li key={r.id || i} className="rs-reminder-item">
                      <span className="material-symbols-rounded rs-reminder-dot">
                        radio_button_unchecked
                      </span>
                      <span className="rs-reminder-title">{r.title}</span>
                      {due && (
                        <span className={`rs-reminder-due ${due === 'Overdue' ? 'is-overdue' : ''}`}>
                          {due}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <CardState icon="check_circle" message="No open reminders." />
            )
          }
        </section>

        {/* Daily log */}
        <section className="rs-card rs-span-2">
          <div className="rs-card-head">
            <CardLabel icon="history_edu">Daily log</CardLabel>
            <button
              className="rs-pill"
              onClick={() => openDailyInChronos(dailyPath)}
              disabled={!dailyPath}
              title="Open today's daily note in CHRONOS"
            >
              <span className="material-symbols-rounded">auto_stories</span>
              Open in Chronos
            </button>
          </div>

          {dailyLoading ? <Skeleton lines={2} /> : summary ? (
            <div className="rs-briefing-prose">
              <RsMarkdown onNavigate={onNavigate}>{summary}</RsMarkdown>
            </div>
          ) : (
            <CardState
              icon="edit_note"
              message={`Nothing logged yet today. Chats and saved notes land in your ${todayKey} note.`}
              actionLabel={dailyPath ? 'Open today\'s note' : undefined}
              onAction={dailyPath ? () => openDailyInChronos(dailyPath) : undefined}
            />
          )}
        </section>

        {/* Headlines */}
        <section className="rs-card rs-span-2">
          <div className="rs-card-head">
            <CardLabel icon="feed">Headlines</CardLabel>
            <button className="rs-pill" onClick={() => onNavigate('feeds')}>
              All feeds
            </button>
          </div>

          {loading ? <Skeleton /> :
            headlines?.status !== 'ok' ? (
              <CardState icon="cloud_off" message="Feeds are unavailable right now."
                         actionLabel="Retry" onAction={refreshAll} />
            ) : headlines.items.length ? (
              <ul className="rs-headline-list">
                {headlines.items.map((h, i) => (
                  <li key={i} className="rs-headline-item">
                    <a href={h.url} target="_blank" rel="noreferrer" className="rs-headline-link">
                      <span className="rs-headline-title">{h.title}</span>
                      {h.source && <span className="rs-headline-source">{h.source}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <CardState
                icon="rss_feed"
                message="No news sources selected yet."
                actionLabel="Choose sources"
                onAction={() => onNavigate('feeds')}
              />
            )
          }
        </section>

        {/* Music */}
        {musicPrefs?.music_provider === 'youtube_music' && (
          <MusicDiscoveryCard
            tracks={musicTracks}
            isLoading={musicLoading}
            error={musicError}
            onRetry={fetchMusic}
            onPlay={handlePlayMusic}
          />
        )}

        {/* Quick actions */}
        <section className="rs-card rs-span-2">
          <div className="rs-card-head">
            <CardLabel icon="bolt">Quick actions</CardLabel>
          </div>
          <div className="rs-quick-grid">
            {[
              { key: 'chat', icon: 'chat', label: 'New chat' },
              { key: 'chronos', icon: 'edit_note', label: 'Notes' },
              { key: 'inventory', icon: 'inventory_2', label: 'Stash' },
              { key: 'culinary', icon: 'restaurant', label: 'Kitchen' },
            ].map(a => (
              <button key={a.key} className="rs-quick-btn" onClick={() => onNavigate(a.key)}>
                <span className="material-symbols-rounded">{a.icon}</span>
                <span className="rs-quick-label">{a.label}</span>
              </button>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
