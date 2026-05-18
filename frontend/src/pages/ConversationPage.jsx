import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import ConversationPanel  from '../components/ConversationPanel.jsx'
import AudioVisualizer    from '../components/AudioVisualizer.jsx'
import { useWebSocket }   from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import { useAuth }        from '../context/AuthContext.jsx'
import { AudioPlayer }    from '../utils/AudioPlayer.js'

const RiverSong = lazy(() => import('../components/RiverSong.jsx'))

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

export default function ConversationPage({ setAction }) {
  const { token, user } = useAuth()
  const wsUrl = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

  const [convState,         setConvState]         = useState('connecting')
  const [messages,          setMessages]          = useState([])
  const [streamingContent,  setStreamingContent]  = useState('')
  const [error,             setError]             = useState(null)
  const [ambientEnabled,    setAmbientEnabled]    = useState(false)
  const [webSearch,         setWebSearch]         = useState(false)
  const [memoryMuted,       setMemoryMuted]       = useState(false)

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
    try { const v = localStorage.getItem(`rs-transcript:${user.id}`); return v === null ? true : v === 'true' } catch { return true }
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

  const [activeModel, setActiveModel] = useState(null)
  const [activeVoice, setActiveVoice] = useState(null)
  const [history,        setHistory]        = useState([])
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const audioPlayer = useMemo(() => new AudioPlayer(), [])
  const isPlayingRef = useRef(false)

  const [toolEvents, setToolEvents] = useState([])

  const handleMessage = useCallback((event) => {
    const { type, text, content, message, data } = event
    switch (type) {
      case 'connected':       setConvState('idle');       setError(null); break
      case 'listening':       setConvState('listening');  setStreamingContent(''); setError(null); break
      case 'transcribing':    setConvState('transcribing'); break
      case 'transcript':      if (text) setMessages(p => [...p, { role: 'user', text }]); break
      case 'thinking':        setConvState('thinking');   setStreamingContent(''); break
      case 'response_chunk':  setStreamingContent(p => p + (text || '')); break
      case 'token':
        setStreamingContent(p => p + (content || ''))
        if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = setTimeout(finalizeStream, 30000)
        break
      case 'tool_use':
      case 'tool_result':
        setToolEvents(p => [...p, event])
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
          audioPlayer.playBase64(data, event.format || 'wav').then(() => {
            isPlayingRef.current = false
          })
        }
        break
      case 'idle':    
        if (!isPlayingRef.current) setConvState('idle')
        break
      case 'error':   setError(message || 'An unknown error occurred.'); break
      default: break
    }
  }, [audioPlayer, finalizeStream])

  const { sendMessage, connectionStatus, authError } = useWebSocket(wsUrl, handleMessage, { token })

  useEffect(() => {
    if (authError) setError('Session expired.')
  }, [authError])

  useEffect(() => {
    if (connectionStatus === 'connected') {
      setConvState(s => (s === 'connecting' ? 'idle' : s))
    } else if (connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') {
      setConvState('connecting')
    }
  }, [connectionStatus])

  const { startRecording, stopRecording, audioLevel, toggleAmbient, isAmbient } = useAudioRecorder({
    onComplete: wavB64 => sendMessage({ type: 'audio_data', data: wavB64 }),
    onNoSpeech: () => setConvState(s => (s === 'listening' ? 'idle' : s)),
    onAmbientChunk: b64 => sendMessage({ type: 'ambient_audio', data: b64 }),
  })

  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking' || isAmbient) ? audioLevel : 0

  const handleToggleAmbient = useCallback(async () => {
    const next = !ambientEnabled
    setAmbientEnabled(next)
    sendMessage({ type: 'ambient_mode', enabled: next })
    await toggleAmbient(next)
  }, [ambientEnabled, toggleAmbient, sendMessage])

  const handleToggleWebSearch = useCallback(() => {
    const next = !webSearch
    setWebSearch(next)
    sendMessage({ type: 'settings', web_search: next })
  }, [webSearch, sendMessage])

  const handleStartListening = useCallback(async () => {
    if (!canSpeak) return
    setError(null)
    setConvState('listening')
    const granted = await startRecording()
    if (granted) {
      sendMessage({ type: 'start' })
    } else {
      setConvState('idle')
      setError('Microphone access denied.')
    }
  }, [canSpeak, startRecording, sendMessage])

  const handleReset = useCallback(() => {
    if (connectionStatus !== 'connected') return
    if (messages.length > 0 && user) {
      const session = {
        id:       Date.now(),
        date:     new Date().toISOString(),
        model:    activeModel?.display_name || 'Default',
        messages: [...messages],
      }
      const existing = loadHistory(user.id)
      const updated = Array.isArray(existing) ? [...existing, session] : [session]
      saveHistory(user.id, updated)
      setHistory(updated)
    }
    sendMessage({ type: 'reset_history', flush_memory: true })
    setMessages([])
    setStreamingContent('')
    setToolEvents([])
    setError(null)
    setViewingSession(null)
    setMemoryMuted(true)
  }, [connectionStatus, messages, sendMessage, user, activeModel])

  useEffect(() => {
    if (user) {
      const h = loadHistory(user.id)
      setHistory(Array.isArray(h) ? h : [])
    }
  }, [user])

  useEffect(() => {
    if (!token) return
    fetch('/api/settings/llm', { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json())
      .then(d => setActiveModel({ display_name: d.display_name || d.model }))
    fetch('/api/settings/voice', { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.json())
      .then(d => setActiveVoice({ active_voice: d.active_voice }))
  }, [token])

  useEffect(() => {
    if (setAction) setAction(
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'center', width: '100%', padding: '0 20px' }}>
        <button 
          className={ambientEnabled ? 'rs-pill is-active' : 'rs-pill'} 
          onClick={handleToggleAmbient}
          title="Ambient Mode"
        >
          <span className="material-symbols-rounded">auto_awesome</span>
        </button>
        
        <button 
          className={webSearch ? 'rs-pill is-active' : 'rs-pill'} 
          onClick={handleToggleWebSearch}
          title="Web Search"
        >
          <span className="material-symbols-rounded">public</span>
        </button>

        <button 
          className="rs-btn-primary" 
          style={{ 
            width: 72, height: 72, borderRadius: '50%', padding: 0,
            boxShadow: isActive ? '0 0 24px var(--primary)' : undefined,
            background: isActive ? 'var(--primary)' : undefined,
            color: isActive ? '#000' : undefined,
            opacity: !canSpeak ? 0.5 : 1
          }}
          onClick={handleStartListening}
          disabled={!canSpeak}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '2.5rem' }}>mic</span>
        </button>

        <button className="rs-pill" onClick={handleReset} title="Save & reset">
          <span className="material-symbols-rounded">history_edu</span>
        </button>
      </div>
    )
  }, [canSpeak, isActive, ambientEnabled, webSearch, handleToggleAmbient, handleToggleWebSearch, handleStartListening, handleReset, setAction])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingContent

  return (
    <div className="rs-foyer animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', gap: 24 }}>
        
        {/* Left: Avatar & State */}
        {showAvatar && (
          <div style={{ flex: '1 1 40%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, padding: '24px 0' }}>
            <div className="rs-card" style={{ width: '100%', maxWidth: 360, aspectRatio: '1/1', padding: 0, borderRadius: '50%', overflow: 'hidden', position: 'relative' }}>
              <Suspense fallback={<div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)' }} />}>
                <RiverSong state={convState} audioLevel={visualLvl} />
              </Suspense>
              {convState === 'speaking' && (
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  <AudioVisualizer audioLevel={visualLvl} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="rs-status-strip">
                <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280', animation: isActive ? undefined : 'none' }} />
                <span style={{ fontWeight: 600 }}>{convState.toUpperCase()}</span>
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                {activeModel && (
                  <span className="rs-pill" style={{ fontSize: '0.65rem' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>memory</span>
                    {activeModel.display_name}
                  </span>
                )}
                {activeVoice && (
                  <span className="rs-pill" style={{ fontSize: '0.65rem' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>settings_voice</span>
                    {activeVoice.active_voice}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right: Transcript / History */}
        <div style={{ flex: '1 1 60%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={showAvatar ? 'rs-pill is-active' : 'rs-pill'} onClick={toggleAvatar}>
                <span className="material-symbols-rounded">person</span>
              </button>
              <button className={showTranscript ? 'rs-pill is-active' : 'rs-pill'} onClick={toggleTranscript}>
                <span className="material-symbols-rounded">notes</span>
              </button>
            </div>
            <button className={showHistory ? 'rs-pill is-active' : 'rs-pill'} onClick={() => { setShowHistory(!showHistory); setViewingSession(null) }}>
              <span className="material-symbols-rounded">history</span>
              {(history || []).length > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>{history.length}</span>}
            </button>
          </div>

          <div className="rs-card" style={{ flex: 1, overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
            {showHistory ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                {viewingSession ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: 12 }}>
                      <button className="rs-pill" onClick={() => setViewingSession(null)}>BACK</button>
                      <span className="rs-card-meta">{fmtDate(viewingSession.date)}</span>
                    </div>
                    <ConversationPanel messages={viewingSession.messages || []} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(history || []).slice().reverse().map(s => (
                      <button key={s.id} className="rs-card is-tappable" style={{ padding: 12, display: 'flex', justifyContent: 'space-between' }} onClick={() => setViewingSession(s)}>
                        <span className="rs-card-label">{fmtDate(s.date)}</span>
                        <span className="rs-card-meta">{(s.messages || []).length} msg</span>
                      </button>
                    ))}
                    {(history || []).length === 0 && <div className="rs-card-meta" style={{ textAlign: 'center', padding: 40 }}>No history recorded.</div>}
                  </div>
                )}
              </div>
            ) : showTranscript ? (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <ConversationPanel messages={displayMessages || []} streamingContent={displayStreaming} toolEvents={toolEvents} />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="rs-card-meta">Transcript hidden</span>
              </div>
            )}
          </div>

          {(error || convState === 'connecting') && (
            <div style={{ padding: '8px 12px', textAlign: 'center' }}>
              {error ? <span style={{ color: '#f87171', fontSize: '0.8rem' }}>{error}</span> : <span className="rs-card-meta">Connecting...</span>}
            </div>
          )}
        </div>

      </div>

      {memoryMuted && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)' }} className="rs-pill">
          <span style={{ color: '#facc15', fontSize: '0.7rem', fontWeight: 700 }}>MEMORY MUTED</span>
        </div>
      )}
    </div>
  )
}
