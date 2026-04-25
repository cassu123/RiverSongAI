import React, { useState, useCallback, useRef, useEffect } from 'react'
import RiverSong          from '../components/RiverSong.jsx'
import ConversationPanel  from '../components/ConversationPanel.jsx'
import { useWebSocket }   from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import { useAuth }        from '../context/AuthContext.jsx'
import './ConversationPage.css'

const API_BASE    = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const MAX_HISTORY_SESSIONS = 30

async function playWavBase64(b64) {
  try {
    const binary = atob(b64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const ctx    = new AudioContext()
    const buffer = await ctx.decodeAudioData(bytes.buffer)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    return new Promise(resolve => {
      source.onended = () => { ctx.close(); resolve() }
      source.start()
    })
  } catch (err) {
    console.error('[playWavBase64]', err)
  }
}

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
  const [streamingResponse, setStreamingResponse] = useState('')
  const [error,             setError]             = useState(null)
  // Avatar visibility — persisted per user
  const [showAvatar, setShowAvatar] = useState(() => {
    if (!user) return true
    try { const v = localStorage.getItem(avatarKey(user.id)); return v === null ? true : v === 'true' } catch { return true }
  })

  // Model selector
  const [models,          setModels]          = useState({ cloud: [], local: [] })
  const [selectedModel,   setSelectedModel]   = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)

  // History panel
  const [history,        setHistory]        = useState([])
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const isPlayingRef = useRef(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/models`)
      .then(r => r.json())
      .then(data => {
        setModels({
          cloud: (data.cloud || []).filter(m => m.available),
          local: (data.local || []).filter(m => m.available),
        })
      })
      .catch(() => {})

    if (user) {
      fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(s => setSelectedModel({ provider: s.provider, model_id: s.model }))
        .catch(() => {})

      setHistory(loadHistory(user.id))
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAvatar = () => {
    const next = !showAvatar
    setShowAvatar(next)
    if (user) { try { localStorage.setItem(avatarKey(user.id), String(next)) } catch {} }
  }

  const handleModelChange = async (e) => {
    const [provider, model_id] = e.target.value.split('::')
    setSelectedModel({ provider, model_id })
    setSavingModel(true)
    try {
      await fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, model_id, cloud_fallback_enabled: false }),
      })
    } catch {}
    setSavingModel(false)
  }

  const handleMessage = useCallback((event) => {
    const { type, text, message, data } = event
    switch (type) {
      case 'connected':       setConvState('connecting'); setError(null); break
      case 'listening':       setConvState('listening');  setStreamingResponse(''); setError(null); break
      case 'transcribing':    setConvState('transcribing'); break
      case 'transcript':      if (text) setMessages(p => [...p, { role: 'user', text }]); break
      case 'thinking':        setConvState('thinking');   setStreamingResponse(''); break
      case 'response_chunk':  setStreamingResponse(p => p + (text || '')); break
      case 'response_complete':
        setStreamingResponse('')
        if (text) setMessages(p => [...p, { role: 'assistant', text }])
        break
      case 'speaking': setConvState('speaking'); break
      case 'audio':
        if (data) {
          isPlayingRef.current = true
          setConvState('speaking')
          playWavBase64(data).then(() => { isPlayingRef.current = false; setConvState('idle') })
        }
        break
      case 'idle':    if (!isPlayingRef.current) setConvState('idle'); break
      case 'routing': setConvState('routing'); break
      case 'error':   setError(message || 'An unknown error occurred.'); break
      default: break
    }
  }, [])

  const { sendMessage, connectionStatus } = useWebSocket(wsUrl, handleMessage)

  const handleAudioComplete = useCallback(wavB64 => {
    sendMessage({ type: 'audio_data', data: wavB64 })
  }, [sendMessage])

  const { startRecording, audioLevel } = useAudioRecorder({ onComplete: handleAudioComplete })

  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking') ? audioLevel : 0

  const handleStartListening = useCallback(async () => {
    if (!canSpeak) return
    setError(null)
    const granted = await startRecording()
    if (granted) sendMessage({ type: 'start' })
    else setError('Microphone access denied.')
  }, [canSpeak, startRecording, sendMessage])

  const handleReset = useCallback(() => {
    if (connectionStatus !== 'connected') return
    if (messages.length > 0 && user) {
      const session = {
        id: Date.now(),
        date: new Date().toISOString(),
        model: selectedModel ? `${selectedModel.provider} / ${selectedModel.model_id}` : 'default',
        messages: [...messages],
      }
      const updated = [...loadHistory(user.id), session]
      saveHistory(user.id, updated)
      setHistory(updated)
    }
    sendMessage({ type: 'reset_history' })
    setMessages([])
    setStreamingResponse('')
    setError(null)
    setViewingSession(null)
  }, [connectionStatus, messages, sendMessage, user, selectedModel])

  const modelValue = selectedModel ? `${selectedModel.provider}::${selectedModel.model_id}` : ''
  const modelLabel = selectedModel ? `${selectedModel.provider} / ${selectedModel.model_id}` : 'DEFAULT'
  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse
  const allModels = [...models.cloud, ...models.local]

  return (
    <div className="conv-page">

      {/* Avatar zone — collapsible */}
      {showAvatar && (
        <div className="conv-portrait-zone">
          <RiverSong state={convState} audioLevel={visualLvl} />
          <div className="conv-state-bar">
            {STATE_TABS.map(s => (
              <div key={s} className={`conv-state-tab ${convState === s ? 'conv-state-tab--active' : ''}`}>
                <span className={`conv-state-tab-dot ${convState === s ? 'conv-state-tab-dot--active' : ''}`} />
                {s.toUpperCase()}
              </div>
            ))}
          </div>
          {/* Inline model picker */}
          <div className="conv-model-inline">
            <button
              className="conv-model-inline-btn"
              onClick={() => setShowModelPicker(p => !p)}
              title="Switch model"
            >
              <span className="conv-model-inline-label">MODEL</span>
              <span className="conv-model-inline-val">{modelLabel}</span>
              <ChevronIcon open={showModelPicker} />
            </button>
            {showModelPicker && allModels.length > 0 && (
              <div className="conv-model-dropdown">
                {models.cloud.length > 0 && (
                  <div className="conv-model-group">
                    <span className="conv-model-group-label">☁ CLOUD</span>
                    {models.cloud.map(m => (
                      <button
                        key={`${m.provider}::${m.model_id}`}
                        className={`conv-model-option ${modelValue === `${m.provider}::${m.model_id}` ? 'conv-model-option--active' : ''}`}
                        onClick={() => { handleModelChange({ target: { value: `${m.provider}::${m.model_id}` } }); setShowModelPicker(false) }}
                      >{m.display_name}</button>
                    ))}
                  </div>
                )}
                {models.local.length > 0 && (
                  <div className="conv-model-group">
                    <span className="conv-model-group-label">⬡ LOCAL</span>
                    {models.local.map(m => (
                      <button
                        key={`${m.provider}::${m.model_id}`}
                        className={`conv-model-option ${modelValue === `${m.provider}::${m.model_id}` ? 'conv-model-option--active' : ''}`}
                        onClick={() => { handleModelChange({ target: { value: `${m.provider}::${m.model_id}` } }); setShowModelPicker(false) }}
                      >{m.display_name}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {error && <div className="conv-error" role="alert">{error}</div>}
        </div>
      )}

      {/* Chat zone */}
      <div className="conv-chat-zone">

        {/* Top bar */}
        <div className="conv-top-bar">
          <div className="conv-top-left">
            {/* Avatar toggle */}
            <button
              className={`conv-icon-btn ${showAvatar ? 'conv-icon-btn--on' : ''}`}
              onClick={toggleAvatar}
              title={showAvatar ? 'Hide avatar' : 'Show avatar'}
            >
              <AvatarIcon />
            </button>
            {savingModel && <span className="conv-model-saving">saving...</span>}
          </div>

          <div className="conv-top-right">
            {!showAvatar && error && (
              <span className="conv-error-inline">{error}</span>
            )}
            {!showAvatar && (
              <div className="conv-status-dot-wrap" title={convState}>
                <span className={`conv-status-dot ${isActive ? 'conv-status-dot--active' : ''}`} />
                <span className="conv-status-label">{convState.toUpperCase()}</span>
              </div>
            )}
            <button
              className={`conv-icon-btn ${showHistory ? 'conv-icon-btn--on' : ''}`}
              onClick={() => { setShowHistory(h => !h); setViewingSession(null) }}
              title="Conversation history"
            >
              <HistoryIcon />
              {history.length > 0 && <span className="conv-history-count">{history.length}</span>}
            </button>
          </div>
        </div>

        {/* History panel */}
        {showHistory ? (
          <div className="conv-history-panel">
            {viewingSession ? (
              <>
                <div className="conv-history-session-header">
                  <button className="conv-history-back" onClick={() => setViewingSession(null)}>← BACK</button>
                  <span className="conv-history-session-meta">{fmtDate(viewingSession.date)} · {viewingSession.model}</span>
                </div>
                <ConversationPanel messages={viewingSession.messages} />
              </>
            ) : history.length === 0 ? (
              <div className="conv-history-empty">No saved sessions yet. Conversations save when you hit RESET.</div>
            ) : (
              <div className="conv-history-list">
                {[...history].reverse().map(s => (
                  <button key={s.id} className="conv-history-item" onClick={() => setViewingSession(s)}>
                    <span className="conv-history-item-date">{fmtDate(s.date)}</span>
                    <span className="conv-history-item-model">{s.model}</span>
                    <span className="conv-history-item-count">{s.messages.length} msg</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ConversationPanel messages={displayMessages} streamingResponse={displayStreaming} />
        )}

        {/* Input bar — voice only */}
        <div className="conv-input-bar conv-input-bar--speak">
          <button
            className={`conv-mic-btn conv-mic-btn--large ${isActive ? 'conv-mic-btn--active' : ''} ${!canSpeak ? 'conv-mic-btn--disabled' : ''}`}
            onClick={handleStartListening}
            aria-label="Speak to River"
            disabled={!canSpeak}
          >
            <MicIcon active={isActive} />
          </button>
          <button className="conv-reset-btn" onClick={handleReset} title="Save &amp; reset">
            <ResetIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function MicIcon({ active }) {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
      <rect x="6" y="1" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="9" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="6" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M14 8 2 2l3 6-3 6 12-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
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

function ChevronIcon({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
      <polyline points="2,3 5,7 8,3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
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
