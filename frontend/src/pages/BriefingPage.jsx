import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import RsMarkdown from '../components/RsMarkdown.jsx'
import { MusicDiscoveryCard } from '../components/widgets/MusicDiscoveryCard.jsx'
import FeedTabsContainer from '../components/FeedTabsContainer.jsx'
import PulseWidget from '../components/PulseWidget.jsx'

/**
 * BriefingPage — Daily Briefing
 * -----------------------------------------------------------------------------
 * A focused hub for the user's daily information: weather, calendar, 
 * news, market pulse, and system notifications.
 */

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  })
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end === -1) return content
  return content.slice(end + 4).replace(/^\s*\n/, '')
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

/** Map WMO weather codes to Material Symbols icon names */
function weatherIcon(code) {
  if (code == null) return 'wb_sunny'
  if (code === 0) return 'wb_sunny'            // Clear
  if (code <= 3) return 'partly_cloudy_day'     // Partly cloudy
  if (code <= 48) return 'foggy'                // Fog / depositing rime fog
  if (code <= 57) return 'grain'                // Drizzle
  if (code <= 67) return 'rainy'                // Rain
  if (code <= 77) return 'weather_snowy'        // Snow
  if (code <= 82) return 'thunderstorm'         // Showers
  if (code <= 86) return 'weather_snowy'        // Snow showers
  return 'thunderstorm'                         // Thunderstorm
}

/** Format a Google Calendar event start into HH:MM */
function fmtEventTime(event) {
  const raw = event?.start?.dateTime || event?.start?.date
  if (!raw) return ''
  const d = new Date(raw)
  // All-day events have no time component
  if (event?.start?.date && !event?.start?.dateTime) return 'All day'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function BriefingPage({ onNavigate }) {
  const { user, token } = useAuth()
  const EMPTY_HINT = 'No entries yet today. Once you chat with River or save notes, they\'ll show up in your daily [[Daily/' + new Date().toISOString().slice(0, 10) + ']] log.'
  const [calendar, setCalendar] = useState([])
  const [calendarError, setCalendarError] = useState(null)
  const [summary, setSummary] = useState(EMPTY_HINT)
  const [dailyPath, setDailyPath] = useState(null)
  const [loading, setLoading] = useState(true)

  const [musicPrefs, setMusicPrefs] = useState({ music_provider: 'youtube_music' })
  const [musicTracks, setMusicTracks] = useState([])
  const [musicLoading, setMusicLoading] = useState(false)

  // Fetch daily note
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/vault/daily/today', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDailyPath(data.virtual_path)
        const body = stripFrontmatter(data.content || '')
        if (body.trim()) setSummary(body)
      }
    } catch (e) {
      console.error('Daily note fetch failed', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  // Fetch live calendar from Google — check connection first
  const fetchCalendar = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/google/status', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const statusData = await statusRes.json()
      if (!statusData.connected) {
        setCalendarError('disconnected')
        return
      }

      const res = await fetch('/api/google/calendar/upcoming?days=1&max_results=5', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCalendar(data.events || [])
        setCalendarError(null)
      } else {
        setCalendarError('offline')
      }
    } catch {
      setCalendarError('offline')
    }
  }, [token])

  // Fetch music discovery
  const fetchMusic = useCallback(async () => {
    try {
      const prefRes = await fetch('/api/settings', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (prefRes.ok) {
        const prefData = await prefRes.json()
        setMusicPrefs(prefData)

        if (prefData.music_provider === 'youtube_music') {
          setMusicLoading(true)
          const res = await fetch('/api/google/music/home', {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (res.ok) {
            const data = await res.json()
            if (data.success) {
              setMusicTracks(data.data || [])
            }
          }
        }
      }
    } catch (e) {
      console.error('Music fetch failed', e)
    } finally {
      setMusicLoading(false)
    }
  }, [token])

  const handlePlayMusic = async (videoId) => {
    try {
      await fetch(`/api/google/music/play/${videoId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      console.error('Playback failed', e)
    }
  }

  useEffect(() => {
    fetchData()
    fetchCalendar()
    fetchMusic()
  }, [fetchData, fetchCalendar, fetchMusic])

  const firstName = user?.display_name?.split(' ')[0] || 'Operator'

  return (
    <div className="rs-foyer animate-fade-in">
      
      <header className="rs-foyer-head">
        <h1 className="rs-greeting">{greeting()}, {firstName}.</h1>
        <div className="rs-greeting-sub">Your daily briefing is ready. {fmtDate()}.</div>
      </header>

      <div className="rs-card-flow">

        {/* Daily Summary */}
        <div className="rs-card is-elev is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">DAILY LOG</span>
            <button
              className="rs-pill"
              onClick={() => openDailyInChronos(dailyPath)}
              disabled={!dailyPath}
              title="Open today's daily note in CHRONOS"
              style={{ fontSize: '0.65rem', padding: '4px 10px' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem', marginRight: 4 }}>auto_stories</span>
              OPEN IN CHRONOS
            </button>
          </div>
          <div style={{ lineHeight: 1.6, fontSize: '1rem', color: 'rgba(255,255,255,0.9)' }}>
            <RsMarkdown onNavigate={onNavigate}>{summary}</RsMarkdown>
          </div>
          <div className="rs-card-meta" style={{ marginTop: 12 }}>
            Compiled from conversation summaries and your CHRONOS daily note.
          </div>
        </div>

        {/* Market & News Pulse */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">MARKET & NEWS PULSE</span>
            <span className="material-symbols-rounded" style={{ opacity: 0.2 }}>sensors</span>
          </div>
          <div className="rs-widget-pulse-wrapper">
            <PulseWidget token={token} />
          </div>
          <div className="rs-card-meta">Real-time activity reports</div>
        </div>

        {/* Live Feed Tabs — News / Weather / Sports / Stocks */}
        <FeedTabsContainer token={token} />

        {/* Music Discovery */}
        {musicPrefs?.music_provider === 'youtube_music' && (
          <MusicDiscoveryCard
            tracks={musicTracks}
            isLoading={musicLoading}
            onPlay={handlePlayMusic}
          />
        )}

        {/* Calendar — live from /api/google/calendar/upcoming */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">UPCOMING</span>
          </div>
          {calendarError === 'disconnected' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', padding: '8px 0' }}>
              <div className="rs-card-meta">
                <span className="material-symbols-rounded" style={{ fontSize: '1.2rem', verticalAlign: 'middle', marginRight: 8, opacity: 0.5 }}>link_off</span>
                Google Calendar not connected.
              </div>
              <button className="rs-pill" onClick={() => onNavigate('google')}>CONNECT GOOGLE</button>
            </div>
          ) : calendarError === 'offline' ? (
            <div className="rs-card-meta" style={{ padding: '8px 0' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem', verticalAlign: 'middle', marginRight: 8, opacity: 0.5 }}>sync_problem</span>
              Calendar sync unavailable.
            </div>
          ) : calendar.length === 0 ? (
            <div className="rs-card-meta" style={{ padding: '8px 0' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem', verticalAlign: 'middle', marginRight: 8, opacity: 0.5 }}>event_available</span>
              No events today. Clear schedule ahead.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {calendar.map((event, i) => (
                <div key={event.id || i} className="rs-pill" style={{ justifyContent: 'flex-start', background: i === 0 ? 'var(--md-surface-container-high)' : undefined }}>
                  <span style={{ opacity: 0.5, marginRight: 12, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', minWidth: 48 }}>{fmtEventTime(event)}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.summary || 'Untitled event'}</span>
                </div>
              ))}
            </div>
          )}
          <button className="rs-btn-primary" style={{ marginTop: 16, width: '100%' }} onClick={() => onNavigate('google')}>
            VIEW FULL CALENDAR
          </button>
        </div>

        {/* Quick Utilities */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">QUICK ACTIONS</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 12 }}>
            <button className="rs-pill" onClick={() => onNavigate('chat')}>NEW CHAT</button>
            <button className="rs-pill" onClick={() => onNavigate('chronos')}>NOTES</button>
            <button className="rs-pill" onClick={() => onNavigate('inventory')}>STASH</button>
            <button className="rs-pill" onClick={() => onNavigate('culinary')}>KITCHEN</button>
          </div>
        </div>

      </div>
    </div>
  )
}
