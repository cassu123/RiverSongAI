import React, { useState, useCallback, Suspense, lazy } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useConversation } from '../hooks/useConversation.js'
import AudioVisualizer from '../components/AudioVisualizer.jsx'
import RsMarkdown from '../components/RsMarkdown.jsx'

const RiverSong = lazy(() => import('../components/RiverSong.jsx'))

export default function ConversationPage({ setAction }) {
  const { token, user } = useAuth()
  const [muted, setMuted] = useState(false)
  
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
        <div className="rs-chat-textarea" style={{ display: 'flex', alignItems: 'center', minHeight: 40 }}>
          <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280', marginRight: 12 }} />
          <span style={{ fontWeight: 600, letterSpacing: '0.1em', fontSize: '0.85rem' }}>{convState.toUpperCase()}</span>
        </div>
        <div className="rs-chat-input-controls">
          <div className="rs-chat-input-left">
            <button className={`rs-pill ${muted ? 'is-active' : ''}`} onClick={handleToggleMute}>
              <span className="material-symbols-rounded">{muted ? 'mic_off' : 'mic'}</span>
              <span className="rs-speak-actions-label">{muted ? 'Muted' : 'Live'}</span>
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
  }, [setAction, isActive, convState, muted, handleToggleMute, handleStartListening, resetSession])

  return (
    <div className="rs-speak-stage">
      <div className="rs-speak-status">
        <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280' }} />
        <span style={{ fontWeight: 600, letterSpacing: '0.1em' }}>{convState.toUpperCase()}</span>
      </div>

      <div className="rs-speak-orb">
        <Suspense fallback={<div className="rs-speak-orb-fallback" />}>
          <RiverSong state={convState} audioLevel={visualLvl} />
        </Suspense>
        {convState === 'speaking' && (
          <div className="rs-speak-visualizer">
            <AudioVisualizer audioLevel={visualLvl} />
          </div>
        )}
      </div>

      {error && (
        <div className="rs-speak-error">
          <span style={{ color: '#f87171', fontSize: '0.8rem' }}>{error}</span>
        </div>
      )}

      {/* Floating Transcript Overlay */}
      <div className="rs-speak-transcript-float" style={{
        position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)',
        width: '80%', maxWidth: 600, maxHeight: 150, overflowY: 'auto',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)',
        borderRadius: 16, padding: '16px 20px', color: 'var(--fg)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column', gap: 8
      }}>
        {messages.slice(-2).map((m, i) => (
          <div key={i} style={{ 
            fontSize: '0.9rem', 
            opacity: m.role === 'assistant' ? 1 : 0.7,
            color: m.role === 'assistant' ? 'var(--primary)' : 'inherit'
          }}>
            <strong>{m.role === 'user' ? 'You' : 'River Song'}:</strong> {m.text}
          </div>
        ))}
        {streamingContent && (
          <div style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>
            <strong>River Song:</strong> {streamingContent}
          </div>
        )}
        {messages.length === 0 && !streamingContent && (
          <div style={{ fontSize: '0.9rem', opacity: 0.5, textAlign: 'center' }}>Listening...</div>
        )}
      </div>
    </div>
  )
}
