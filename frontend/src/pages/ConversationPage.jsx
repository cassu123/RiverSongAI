import React, { useState, useCallback, Suspense, lazy, useEffect } from 'react'
import { useAuth } from '@context/AuthContext.jsx'
import { useConversation } from '@hooks/useConversation.js'
import RsMarkdown from '@components/RsMarkdown.jsx'
import RiverOrb from '@/presence/RiverOrb.jsx'

// The VRM character path is intact and unchanged — set VITE_RIVER_USE_AVATAR=true
// (with a model at public/models/river.vrm) to render it.
//
// It is now opt-IN rather than opt-out. It used to default to on, which meant
// every visit to this page downloaded three.js (~268 kB gzipped, the largest
// chunk in the build), spun up a WebGL context and compiled shaders — and then
// fell straight back to the orb, because no VRM is shipped. The orb is one small
// shader and costs none of that.
const useAvatar = import.meta.env?.VITE_RIVER_USE_AVATAR === 'true'

const RiverAvatar = lazy(() => import('@components/RiverAvatar.jsx'))

// Whether the floating transcript is shown. Per device, so a phone and a
// desk can differ; defaults to shown.
const TRANSCRIPT_KEY = 'rs-voice-transcript'
function readTranscriptPref() {
  try { return localStorage.getItem(TRANSCRIPT_KEY) !== 'off' } catch { return true }
}

export default function ConversationPage({ setAction }) {
  const { token, user } = useAuth()
  const [muted, setMuted] = useState(false)
  const [showTranscript, setShowTranscript] = useState(readTranscriptPref)
  const toggleTranscript = useCallback(() => {
    setShowTranscript((on) => {
      const next = !on
      try { localStorage.setItem(TRANSCRIPT_KEY, next ? 'on' : 'off') } catch { /* private mode: keep it for this visit */ }
      return next
    })
  }, [])
  
  const {
    convState,
    messages,
    streamingContent,
    error,
    setError,
    isRecording,
    startRecording,
    stopRecording,
    audioLevel,
    resetSession,
    connectionStatus
  } = useConversation({ token, user })

  const isThinking = convState === 'thinking' || convState === 'speaking' || streamingContent !== ''
  const isActive = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking') ? audioLevel : 0

  const handleToggleMute = useCallback(() => {
    if (muted && convState === 'listening') stopRecording()
    setMuted(!muted)
  }, [muted, convState, stopRecording])

  const handleStartListening = useCallback(() => {
    if (convState === 'listening') {
      stopRecording()
    } else {
      startRecording()
    }
  }, [convState, startRecording, stopRecording])

  React.useEffect(() => {
    if (!setAction) return
    setAction(
      <div className="rs-chat-input-container">
        <div className="rs-chat-textarea rs-flex rs-items-center" style={{ minHeight: 40 }}>
          <span className="rs-status-dot" style={{ background: isActive ? 'var(--rs-status-nominal)' : '#6b7280', marginRight: 'var(--rs-space-3)' }} />
          <span className="rs-type-tiny rs-fw-600" style={{ letterSpacing: '0.1em' }}>
            {convState === 'idle' ? 'READY' : convState.toUpperCase()}
          </span>
        </div>
        <div className="rs-chat-input-controls">
          <div className="rs-chat-input-left">
            <button className={`rs-pill ${muted ? 'is-active' : ''}`} onClick={handleToggleMute}>
              <span className="material-symbols-rounded">{muted ? 'mic_off' : 'mic'}</span>
              <span className="rs-speak-actions-label">{muted ? 'Muted' : 'Live'}</span>
            </button>
            {/* State shows in the icon, not a fill: a lit pill here would
                compete with the mic button, the one control that matters. */}
            <button
              className="rs-pill"
              onClick={toggleTranscript}
              aria-pressed={showTranscript}
              aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
              title={showTranscript ? 'Hide transcript' : 'Show transcript'}
            >
              <span className="material-symbols-rounded">{showTranscript ? 'subtitles' : 'subtitles_off'}</span>
              <span className="rs-speak-actions-label">Transcript</span>
            </button>
          </div>
          <div className="rs-chat-input-right">
            <button
              className="rs-btn-primary rs-icon-btn rs-send-btn"
              onClick={handleStartListening}
              disabled={muted || (isActive && convState !== 'speaking' && convState !== 'thinking')}
              style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>
                {convState === 'listening' ? 'stop' : 'mic'}
              </span>
            </button>
            <button className="rs-pill" onClick={resetSession} title="Reset session">
              <span className="material-symbols-rounded">refresh</span>
            </button>
          </div>
        </div>
      </div>
    )
  }, [setAction, isActive, convState, muted, handleToggleMute, handleStartListening, resetSession, showTranscript, toggleTranscript])

  // Drives whether the transcript panel is laid out at all.
  const hasTranscript = messages.length > 0 || !!streamingContent || convState === 'listening'

  return (
    <div className="rs-speak-stage">
      <div className="rs-speak-status rs-flex rs-flex-col rs-items-center">
        <div className="rs-flex rs-items-center rs-gap-2">
          <span className="rs-status-dot" style={{ background: isActive ? 'var(--md-tertiary, #4ade80)' : 'var(--primary)' }} />
          <span className="rs-type-h3 rs-fw-600" style={{ letterSpacing: '0.15em', color: isActive ? 'var(--fg)' : 'var(--primary)' }}>
            {convState === 'idle' ? 'READY' : convState.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="rs-speak-orb">
        {useAvatar ? (
          <Suspense fallback={<div className="rs-speak-orb-fallback" />}>
            <RiverAvatar state={convState} audioLevel={visualLvl} />
          </Suspense>
        ) : (
          <RiverOrb detail="full" className="rs-speak-river" label={`River is ${convState}`} />
        )}
      </div>

      {error && (
        <div className="rs-speak-error">
          <span className="rs-type-tiny rs-c-critical">{error}</span>
        </div>
      )}

      {/* The holographic grid overlay lived here. Removed: it painted 40px
          graph paper across a photographic backdrop, and because the stage is
          inset by the content zone's padding, the grid's own boundary drew a
          rectangle that read as a panel floating over the Stage. */}

      {/* Floating transcript. Only mounted when there is something to show —
          it used to paint its glass panel unconditionally, leaving an empty
          grey pill hovering over the orb on an idle screen. */}
      <div
        className={`rs-speak-transcript-float rs-c-fg rs-flex-col ${hasTranscript && showTranscript ? 'is-live' : ''}`}
        style={{ position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)', width: '80%', maxWidth: 600, maxHeight: 150, overflowY: 'auto', background: 'color-mix(in srgb, var(--bg-base) 72%, transparent)', backdropFilter: 'blur(12px)', borderRadius: 'var(--md-shape-lg)', padding: 'var(--rs-space-4) var(--rs-space-5)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', gap: 'var(--rs-space-2)', zIndex: 2 }}>
        {messages.slice(-2).map((m, i) => (
          <div key={i} className="rs-type-small" style={{
            opacity: m.role === 'assistant' ? 1 : 0.7,
            color: m.role === 'assistant' ? 'var(--primary)' : 'inherit',
          }}>
            <strong>{m.role === 'user' ? 'YOU' : 'RIVER'}:</strong> {m.text}
          </div>
        ))}
        {streamingContent && (
          <div className="rs-type-small rs-c-accent">
            <strong>RIVER:</strong> {streamingContent}
          </div>
        )}
        {messages.length === 0 && !streamingContent && convState === 'listening' && (
          <div className="rs-text-center rs-type-small rs-c-accent">Intercepting audio stream...</div>
        )}
      </div>
    </div>
  )
}
