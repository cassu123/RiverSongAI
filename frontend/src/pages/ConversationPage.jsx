import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import ConversationPanel  from '../components/ConversationPanel.jsx'
import AudioVisualizer    from '../components/AudioVisualizer.jsx'
import { useWebSocket }   from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import { useAuth }        from '../context/AuthContext.jsx'
import { AudioPlayer }    from '../utils/AudioPlayer.js'
import './ConversationPage.css'

const RiverSong = lazy(() => import('../components/RiverSong.jsx'))

const API_BASE    = import.meta.env.VITE_API_URL || ''
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const MAX_HISTORY_SESSIONS = 30

function historyKey(userId) { return `rs-history:${userId}` }
function avatarKey(userId)  { return `rs-avatar:${userId}`  }

function loadHistory(userId) {
  try { return JSON.parse(localStorage.getItem(historyKey(userId)) || '[]') } catch { return [] }
}
function saveHistory(userId, sessions) {
  try { localStorage.setItem(historyKey(userId), JSON.stringify(sessions.slice(-MAX_HISTORY_SESSIONS))) } catch {}
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STATE_TABS = ['listening', 'thinking', 'speaking', 'idle']

export default function ConversationPage() {
  const { token, user } = useAuth()

  const wsUrl = token
    ? `${WS_PROTOCOL}//${window.location.host}/ws/conversation?token=${token}`
    : `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

  const [convState,         setConvState]         = useState('connecting')
  const [messages,          setMessages]          = useState([])
  const [streamingContent,  setStreamingContent]  = useState('')
  const [error,             setError]             = useState(null)
  const [ambientEnabled,    setAmbientEnabled]    = useState(false)

  const streamTimeoutRef = useRef(null)

  const finalizeStream = useCallback(() => {
    setStreamingContent(current => {
      if (current) {
        setMessages(p => [...p, { role: 'assistant', text: current }])
      }
      return ''
    })
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = null
    }
  }, [])

  const [showAvatar, setShowAvatar] = useState(() => {
    if (!user) return true
    try { const v = localStorage.getItem(avatarKey(user.id)); return v === null ? true : v === 'true' } catch { return true }
  })

  const [showTranscript, setShowTranscript] = useState(() => {
    if (!user) return true
    try { const v = localStorage.getItem(`rs-transcript:${user?.id}`); return v === null ? true : v === 'true' } catch { return true }
  })

  const toggleAvatar = () => {
    const next = !showAvatar
    setShowAvatar(next)
    if (user) localStorage.setItem(avatarKey(user.id), String(next))
  }

  const toggleTranscript = () => {
    const next = !showTranscript
    setShowTranscript(next)
    if (user) localStorage.setItem(`rs-transcript:${user.id}`, String(next))
  }

  // Read-only: active model + voice from settings (display only — change in Settings)
  const [activeModel, setActiveModel] = useState(null)
  const [activeVoice, setActiveVoice] = useState(null)

  const [history,        setHistory]        = useState([])
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const audioPlayer = useMemo(() => new AudioPlayer(), [])
  const isPlayingRef = useRef(false)

  const handleMessage = useCallback((event) => {
    const { type, text, content, message, data } = event
    switch (type) {
      case 'connected':       setConvState('idle');       setError(null); break
      case 'listening':       setConvState('listening');  setStreamingContent(''); setError(null); break
      case 'transcribing':    setConvState('transcribing'); break
      case 'transcript':      if (text) setMessages(p => [...p, { role: 'user', text }]); break
      case 'thinking':        setConvState('thinking');   setStreamingContent(''); break
      case 'proactive_briefing_start':
        console.log('Proactive briefing starting:', text || 'Routine')
        if (text) setMessages(p => [...p, { role: 'assistant', text }])
        setConvState('thinking')
        setStreamingContent('')
        setError(null)
        break
      case 'response_chunk':  setStreamingContent(p => p + (text || '')); break
      case 'token':
        setStreamingContent(p => p + (content || ''))
        // Reset 30s timeout on every token
        if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = setTimeout(() => {
          console.warn('Streaming timed out after 30s, finalizing.')
          finalizeStream()
        }, 30000)
        break
      case 'stream_done':
        finalizeStream()
        break
      case 'response_complete':
        if (text) {
          setMessages(p => {
            const last = p[p.length - 1]
            if (last?.role === 'assistant' && last.text === text) return p
            return [...p, { role: 'assistant', text }]
          })
        }
        setStreamingContent('')
        break
      case 'speaking': 
        setConvState('speaking')
        audioPlayer.stop()
        break
      case 'audio':
        if (data) {
          isPlayingRef.current = true
          setConvState('speaking')
          const fmt = event.format || 'wav'
          audioPlayer.playBase64(data, fmt).then(() => {
            isPlayingRef.current = false
            // Note: with streaming audio, "idle" should only fire after the full queue is done
            // But for now, we rely on the backend sending "idle" at the end of the turn
          })
        }
        break
      case 'wake_word_detected':
        // Automatically switch from ambient to active listening
        console.log('Wake word detected!')
        setConvState('listening_trigger') // Temporary state to trigger transition
        break
      case 'idle':    
        if (!isPlayingRef.current) setConvState('idle')
        break
      case 'routing': setConvState('routing'); break
      case 'error':   setError(message || 'An unknown error occurred.'); break
      default: break
    }
  }, [audioPlayer, finalizeStream])

  const { sendMessage, connectionStatus } = useWebSocket(wsUrl, handleMessage)

  useEffect(() => {
    if (connectionStatus === 'connected') {
      setConvState(s => (s === 'connecting' ? 'idle' : s))
    } else if (connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') {
      setConvState('connecting')
    }
  }, [connectionStatus])

  const handleAudioComplete = useCallback(wavB64 => {
    sendMessage({ type: 'audio_data', data: wavB64 })
  }, [sendMessage])

  const handleNoSpeech = useCallback(() => {
    setConvState(s => (s === 'listening' ? 'idle' : s))
  }, [])

  const handleAmbientChunk = useCallback(b64 => {
    sendMessage({ type: 'ambient_audio', data: b64 })
  }, [sendMessage])

  const { startRecording, stopRecording, audioLevel, toggleAmbient, isAmbient } = useAudioRecorder({
    onComplete: handleAudioComplete,
    onNoSpeech: handleNoSpeech,
    onAmbientChunk: handleAmbientChunk,
  })

  useEffect(() => {
    if (convState === 'listening' && isAmbient) {
      console.log('Transitioning from ambient to listening turn...')
      toggleAmbient(false).then(() => {
        sendMessage({ type: 'start' })
      })
    }
  }, [convState, isAmbient, toggleAmbient, sendMessage])

  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking' || isAmbient) ? audioLevel : 0

  const handleToggleAmbient = useCallback(async () => {
    const next = !ambientEnabled
    setAmbientEnabled(next)
    sendMessage({ type: 'ambient_mode', enabled: next })
    await toggleAmbient(next)
  }, [ambientEnabled, toggleAmbient, sendMessage])

  const handleStartListening = useCallback(async () => {
    if (!canSpeak) return
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not available. Use https://riversongai.com — mic requires HTTPS.')
      return
    }
    setConvState('listening')
    const granted = await startRecording()
    if (granted) {
      sendMessage({ type: 'start' })
    } else {
      setConvState('idle')
      setError('Microphone access denied. Click the lock icon in your browser address bar and allow the microphone.')
    }
  }, [canSpeak, startRecording, sendMessage])

  useEffect(() => {
    if (convState === 'listening_trigger') {
      handleToggleAmbient().then(() => {
        handleStartListening()
      })
    }
  }, [convState, handleToggleAmbient, handleStartListening])

  const handleReset = useCallback(() => {
    if (connectionStatus !== 'connected') return
    if (messages.length > 0 && user) {
      const session = {
        id:       Date.now(),
        date:     new Date().toISOString(),
        model:    activeModel?.display_name || 'Default',
        messages: [...messages],
      }
      const updated = [...loadHistory(user.id), session]
      saveHistory(user.id, updated)
      setHistory(updated)
    }
    sendMessage({ type: 'reset_history' })
    setMessages([])
    setStreamingContent('')
    setError(null)
    setViewingSession(null)
  }, [connectionStatus, messages, sendMessage, user, activeModel])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingContent

  // Load history on mount
  useEffect(() => {
    if (user) {
      setHistory(loadHistory(user.id))
    }
  }, [user])

  // Load current model/voice display
  useEffect(() => {
    if (!token) return
    fetch('/api/settings/llm', { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json())
      .then(d => setActiveModel({ display_name: d.model }))
      .catch(() => {})
    fetch('/api/settings/voice', { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json())
      .then(d => setActiveVoice({ active_voice: d.active_voice }))
      .catch(() => {})
  }, [token])

  return (
    <div className="conv-page">

      {/* Avatar zone */}
      {showAvatar && (
        <div className="conv-portrait-zone">
          <div className="conv-avatar-container">
            <Suspense fallback={<div className="conv-avatar-loading" />}>
              <RiverSong state={convState} audioLevel={visualLvl} />
            </Suspense>
            {convState === 'speaking' && (
              <div className="conv-visualizer-overlay">
                <AudioVisualizer audioLevel={visualLvl} />
              </div>
            )}
          </div>

          {/* Ambient indicator */}
          <div className="conv-ambient-indicator">
            <span className={`conv-ambient-dot ${ambientEnabled ? 'conv-ambient-dot--on' : ''}`} />
            <span className="conv-ambient-label">
              {ambientEnabled ? 'AMBIENT — always listening' : 'PUSH TO TALK'}
            </span>
          </div>

          {/* State pill */}
          <div className="conv-state-pill-wrap">
            <div className={`conv-state-pill conv-state-pill--${convState}`}>
              {convState === 'listening' && "◉ LISTENING"}
              {convState === 'thinking' && "◌ THINKING..."}
              {convState === 'speaking' && "◈ SPEAKING"}
              {convState === 'idle' && "◌ IDLE"}
              {['connecting', 'transcribing', 'routing'].includes(convState) && convState.toUpperCase()}
            </div>
          </div>

          {/* State tabs (Legacy but kept for layout) */}
          <div className="conv-state-bar">
            {STATE_TABS.map(s => (
              <div key={s} className={`conv-state-tab ${convState === s ? 'conv-state-tab--active' : ''}`}>
                <span className={`conv-state-tab-dot ${convState === s ? 'conv-state-tab-dot--active' : ''}`} />
                {s.toUpperCase()}
              </div>
            ))}
          </div>

          {/* Active config strip */}
          <div className="conv-config-strip">
            {activeModel ? (
              <span className="conv-config-chip">
                <GpuIcon />
                {activeModel.display_name}
              </span>
            ) : (
              <span className="conv-config-chip conv-config-chip--dim">No model selected</span>
            )}
            <span className="conv-config-sep">·</span>
            <span className="conv-config-chip">
              <VoiceIcon />
              {activeVoice?.active_voice || 'No voice'}
            </span>
          </div>
        </div>
      )}

      {/* Chat zone */}
      <div className="conv-chat-zone">
        <div className="conv-top-bar">
          <div className="conv-top-left">
            <button className={`conv-icon-btn ${showAvatar ? 'conv-icon-btn--on' : ''}`} onClick={toggleAvatar} title={showAvatar ? 'Hide avatar' : 'Show avatar'}><AvatarIcon /></button>
            <button className={`conv-icon-btn ${showTranscript ? 'conv-icon-btn--on' : ''}`} onClick={toggleTranscript} title={showTranscript ? 'Hide transcript' : 'Show transcript'}><TranscriptIcon /></button>
          </div>

          <div className="conv-top-right">
            {!showAvatar && (
              <div className="conv-ambient-indicator conv-ambient-indicator--compact">
                <span className={`conv-ambient-dot ${ambientEnabled ? 'conv-ambient-dot--on' : ''}`} />
              </div>
            )}
            <button className={`conv-icon-btn ${showHistory ? 'conv-icon-btn--on' : ''}`} onClick={() => { setShowHistory(h => !h); setViewingSession(null) }} title="Conversation history">
              <HistoryIcon />
              {history.length > 0 && <span className="conv-history-count">{history.length}</span>}
            </button>
          </div>
        </div>

        {showHistory ? (
          <div className="conv-history-panel">
            {viewingSession ? (
              <>
                <div className="conv-history-session-header">
                  <button className="conv-history-back" onClick={() => setViewingSession(null)}>← Back</button>
                  <span className="conv-history-session-meta">{fmtDate(viewingSession.date)}</span>
                </div>
                <ConversationPanel messages={viewingSession.messages} />
              </>
            ) : (
              <div className="conv-history-list">
                {[...history].reverse().map(s => (
                  <button key={s.id} className="conv-history-item" onClick={() => setViewingSession(s)}>
                    <span className="conv-history-item-date">{fmtDate(s.date)}</span>
                    <span className="conv-history-item-count">{s.messages.length} msg</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : showTranscript ? (
          <ConversationPanel messages={displayMessages} streamingContent={displayStreaming} />
        ) : (
          <div className="conv-transcript-off">Transcript hidden</div>
        )}

        {(error || convState === 'connecting') && (
          <div className="conv-status-strip">
            {error ? <span className="conv-status-error">{error}</span> : <span className="conv-status-waiting">Connecting...</span>}
          </div>
        )}

        <div className="conv-input-bar conv-input-bar--speak">
          <button className={`conv-ambient-btn ${ambientEnabled ? 'conv-ambient-btn--on' : ''}`} onClick={handleToggleAmbient} title="Ambient Mode"><SparkleIcon on={ambientEnabled} /></button>
          <button className={`conv-mic-btn conv-mic-btn--large ${isActive ? 'conv-mic-btn--active' : ''} ${!canSpeak ? 'conv-mic-btn--disabled' : ''}`} onClick={handleStartListening} disabled={!canSpeak}><MicIcon /></button>
          <button className="conv-reset-btn" onClick={handleReset} title="Save & reset"><ResetIcon /></button>
        </div>
      </div>
    </div>
  )
}

function SparkleIcon({ on }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill={on ? "currentColor" : "none"}>
      <path d="M8 1L9.5 5.5L14 7L9.5 8.5L8 13L6.5 8.5L2 7L6.5 5.5L8 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 11L12.5 12.5L14 13L12.5 13.5L12 15L11.5 13.5L10 13L11.5 12.5L12 11Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function GpuIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="4" y="5.5" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  )
}

function VoiceIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
      <path d="M8 1v14M4 3v10M12 3v10M1 6v4M15 6v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 18 18" fill="none">
      <rect x="6" y="1" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="9" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 8a6 6 0 1 0 1.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <polyline points="2,4 2,8 6,8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function TranscriptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function AvatarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2 14c0-2.5 2.7-4 6-4s6 1.5 6 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="8,4 8,8 11,10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
