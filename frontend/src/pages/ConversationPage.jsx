import React, { useState, useCallback, Suspense, lazy, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useConversation } from '../hooks/useConversation.js'
import AudioVisualizer from '../components/AudioVisualizer.jsx'
import RsMarkdown from '../components/RsMarkdown.jsx'

// The avatar renders a VRM character and falls back to the orb on its own if
// no model is installed, so this is safe to point at either component.
// Set VITE_RIVER_USE_AVATAR=false to force the orb even with a model present.
const useAvatar = import.meta.env?.VITE_RIVER_USE_AVATAR !== 'false'

const RiverSong = lazy(() =>
  useAvatar
    ? import('../components/RiverAvatar.jsx')
    : import('../components/RiverSong.jsx'),
)

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

  // Simulate autonomous background thinking logs
  const [sysLogs, setSysLogs] = useState([])
  useEffect(() => {
    if (convState === 'listening' || convState === 'speaking') {
      setSysLogs([])
      return
    }
    const interval = setInterval(() => {
      const logs = [
        "Analyzing environment context...",
        "Optimizing subroutines...",
        "Awaiting auditory input...",
        "Background task: 0x4FA2 complete.",
        "Re-calibrating temporal nodes...",
        "Monitoring connected nodes..."
      ];
      setSysLogs(prev => {
        const newLogs = [...prev, logs[Math.floor(Math.random() * logs.length)]]
        return newLogs.slice(-5)
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [convState])

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
          <span style={{ fontWeight: 600, letterSpacing: '0.1em', fontSize: '0.85rem' }}>
            {convState === 'idle' ? 'AUTONOMOUS MODE' : convState.toUpperCase()}
          </span>
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
      <div className="rs-speak-status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#38bdf8' }} />
          <span style={{ fontWeight: 600, letterSpacing: '0.15em', fontSize: '1.2rem', color: isActive ? 'var(--fg)' : '#38bdf8' }}>
            {convState === 'idle' ? 'SYSTEM AUTONOMOUS' : convState.toUpperCase()}
          </span>
        </div>
        {convState === 'idle' && (
          <div style={{
            marginTop: 12, fontSize: '0.75rem', fontFamily: 'var(--font-mono)', 
            color: '#38bdf8', opacity: 0.7, textAlign: 'center', minHeight: 80,
            pointerEvents: 'none'
          }}>
            {sysLogs.map((log, i) => (
              <div key={i} style={{ animation: 'slideUpFade 0.3s ease-out' }}>&gt; {log}</div>
            ))}
          </div>
        )}
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

      {/* Holographic grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px)',
        backgroundSize: '40px 40px', zIndex: 1
      }} />

      {/* Floating Transcript Overlay */}
      <div className="rs-speak-transcript-float" style={{
        position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)',
        width: '80%', maxWidth: 600, maxHeight: 150, overflowY: 'auto',
        background: 'rgba(10, 20, 35, 0.6)', backdropFilter: 'blur(12px)',
        borderRadius: 16, padding: '16px 20px', color: 'var(--fg)',
        border: '1px solid rgba(56, 189, 248, 0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2
      }}>
        {messages.slice(-2).map((m, i) => (
          <div key={i} style={{ 
            fontSize: '0.95rem', 
            opacity: m.role === 'assistant' ? 1 : 0.7,
            color: m.role === 'assistant' ? '#38bdf8' : 'inherit'
          }}>
            <strong>{m.role === 'user' ? 'YOU' : 'RIVER'}:</strong> {m.text}
          </div>
        ))}
        {streamingContent && (
          <div style={{ fontSize: '0.95rem', color: '#38bdf8' }}>
            <strong>RIVER:</strong> {streamingContent}
          </div>
        )}
        {messages.length === 0 && !streamingContent && convState === 'listening' && (
          <div style={{ fontSize: '0.9rem', opacity: 0.5, textAlign: 'center', color: '#38bdf8' }}>Intercepting audio stream...</div>
        )}
      </div>
    </div>
  )
}
