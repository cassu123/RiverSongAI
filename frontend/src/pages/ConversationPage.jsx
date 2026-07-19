import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import PresetSelector from '../components/PresetSelector.jsx'
import ConversationPanel  from '../components/ConversationPanel.jsx'
import AudioVisualizer    from '../components/AudioVisualizer.jsx'
import { useAuth }        from '../context/AuthContext.jsx'
import RateIndicator      from '../components/RateIndicator.jsx'
import ModelPickerPopover from '../components/ModelPickerPopover.jsx'
import { useConversation } from '../hooks/useConversation.js'
import { API_BASE } from '../utils/useApi.js'

const RiverSong = lazy(() => import('../components/RiverSong.jsx'))

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ConversationPage({ setAction }) {
  const { token, user } = useAuth()

  const [activeModel,     setActiveModel]     = useState(null)
  const [activeVoice,     setActiveVoice]     = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)
  const [models,          setModels]          = useState({ local: [], cloud: [] })
  
  const [historySessions, setHistorySessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const [memoryMuted,       setMemoryMuted]       = useState(false)
  const [muted,             setMuted]             = useState(false)
  const [showTranscript,    setShowTranscript]    = useState(false)
  const [modelPickerOpen,   setModelPickerOpen]   = useState(false)
  const [popoverPos,        setPopoverPos]        = useState({ bottom: 100, right: 20 })

  const {
    convState,
    messages,
    streamingContent,
    toolEvents,
    error,
    setError,
    isRecording,
    startRecording,
    stopRecording,
    audioLevel,
    resetSession,
    sendMessage,
    setMessages,
    connectionStatus
  } = useConversation({ token, user, sessionId: currentSessionId })

  const isThinking = convState === 'thinking' || convState === 'speaking' || streamingContent !== ''
  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking') ? audioLevel : 0

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/models`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => setModels({ cloud: data.cloud || [], local: data.local || [] }))
      .catch(() => {})
  }, [token])

  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/settings/llm`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setActiveModel({ provider: d.provider, model_id: d.model, display_name: d.display_name || d.model }))
      .catch(() => {})

    fetch(`${API_BASE}/api/settings/voice`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setActiveVoice({ active_voice: d.active_voice }))
      .catch(() => {})
      
    if (user) {
      fetch(`${API_BASE}/api/chat/sessions`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
            if (data.sessions) {
                setHistorySessions(data.sessions)
            }
        })
        .catch(() => {})
    }
  }, [token, user])

  const localModels  = useMemo(() => models.local, [models.local])
  const nimModels    = useMemo(() => models.cloud.filter(m => m.provider === 'nvidia_nim'), [models.cloud])
  const cloudModels  = useMemo(() => models.cloud.filter(m => m.provider !== 'nvidia_nim'), [models.cloud])
  const hasNvidia    = nimModels.length > 0
  const hasCloud     = cloudModels.some(m => m.available)

  const closeModelPicker = () => { setModelPickerOpen(false) }
  const openModelPicker = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rawRight = window.innerWidth - rect.right
    setPopoverPos({
      bottom: window.innerHeight - rect.top + 8,
      right:  Math.max(8, Math.min(rawRight, window.innerWidth - 308)),
    })
    setModelPickerOpen(true)
  }, [])

  const selectedModelLabel = useMemo(() => {
    if (!activeModel) return 'Model'
    if (activeModel.provider === 'auto') return 'Auto'
    const all = [...models.local, ...models.cloud]
    const found = all.find(m => m.model_id === activeModel.model_id && m.provider === activeModel.provider)
    if (!found) return activeModel.model_id?.split('/').pop() || 'Model'
    return found.display_name.replace(/\s*\([^)]+\)/g, '').trim()
  }, [activeModel, models])

  const handleModelSelect = async (provider, model_id) => {
    setActiveModel({ provider, model_id, display_name: model_id })
    setSavingModel(true)
    try {
      await fetch(`${API_BASE}/api/settings/llm?user_id=${user?.id || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, model_id, cloud_fallback_enabled: false }),
      })
    } catch {}
    setSavingModel(false)
  }

  const handleStartListening = useCallback(async () => {
    if (muted) return
    if (convState === 'speaking' || convState === 'thinking') {
      sendMessage({ type: 'interrupt' })
    }
    if (!canSpeak && convState !== 'speaking' && convState !== 'thinking') return
    
    setError(null)
    const granted = await startRecording()
    if (!granted) setError('Microphone access denied.')
  }, [canSpeak, muted, startRecording, sendMessage, convState, setError])

  const handleToggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      if (next && convState === 'listening') {
        try { stopRecording() } catch {}
      }
      return next
    })
  }, [convState, stopRecording])

  const handleReset = useCallback(() => {
    resetSession()
    setCurrentSessionId(null)
    setViewingSession(null)
    setMemoryMuted(true)
  }, [resetSession])
  
  const loadSession = useCallback((sessionId) => {
    setCurrentSessionId(sessionId)
    sendMessage({ type: 'attach', session_id: sessionId })
    fetch(`${API_BASE}/api/chat/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(s => {
        setMessages(s.messages || [])
        setViewingSession(null)
        setShowHistory(false)
      })
      .catch(() => setError('Failed to load session'))
  }, [sendMessage, token, setMessages, setError])

  useEffect(() => {
    if (!setAction) return
    setAction(
      <div className="rs-chat-input-container">
        <div className="rs-chat-textarea" style={{ display: 'flex', alignItems: 'center', minHeight: 40, opacity: 0.8 }}>
          <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280', marginRight: 12 }} />
          <span style={{ fontWeight: 600, letterSpacing: '0.1em', fontSize: '0.85rem' }}>{convState.toUpperCase()}</span>
          {activeVoice?.active_voice && (
            <span className="rs-pill" style={{ fontSize: '0.65rem', marginLeft: 12 }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>settings_voice</span>
              {activeVoice.active_voice}
            </span>
          )}
        </div>

        <div className="rs-chat-input-controls">
          <div className="rs-chat-input-left">
            <button className={`rs-pill ${muted ? 'is-active' : ''}`} onClick={handleToggleMute} title={muted ? 'Unmute mic' : 'Mute mic'}>
              <span className="material-symbols-rounded">{muted ? 'mic_off' : 'mic'}</span>
              <span className="rs-speak-actions-label">{muted ? 'Muted' : 'Live'}</span>
            </button>

            <button className={`rs-pill ${showTranscript ? 'is-active' : ''}`} onClick={() => setShowTranscript(s => !s)}>
              <span className="material-symbols-rounded">notes</span>
              <span className="rs-speak-actions-label">Transcript</span>
            </button>
            
            <button className={`rs-pill ${showHistory ? 'is-active' : ''}`} onClick={() => setShowHistory(s => !s)}>
              <span className="material-symbols-rounded">history</span>
              <span className="rs-speak-actions-label">History</span>
            </button>
          </div>

          <div className="rs-chat-input-right">
            <PresetSelector />
            <button className="rs-pill" onClick={openModelPicker} disabled={savingModel}>
              <span className="material-symbols-rounded">
                {activeModel?.provider === 'auto' ? 'auto_awesome' : activeModel?.provider === 'nvidia_nim' ? 'memory_alt' : activeModel?.provider === 'ollama' ? 'memory' : 'cloud'}
              </span>
              <span className="rs-speak-actions-label">{savingModel ? 'Syncing…' : selectedModelLabel}</span>
            </button>

            <button
              className="rs-btn-primary rs-icon-btn rs-send-btn"
              onClick={handleStartListening}
              disabled={muted || (isActive && convState !== 'speaking' && convState !== 'thinking')}
              style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>
                {convState === 'listening' ? 'stop'
                 : convState === 'speaking'  ? 'front_hand'
                 : convState === 'thinking'  ? 'front_hand'
                 : 'mic'}
              </span>
            </button>

            <button className="rs-pill" onClick={handleReset} title="Reset session">
              <span className="material-symbols-rounded">refresh</span>
            </button>
          </div>
        </div>
      </div>
    )
  }, [
    muted, handleToggleMute,
    handleStartListening, canSpeak, isActive, convState,
    selectedModelLabel, savingModel,
    showTranscript, showHistory, handleReset, setAction, activeVoice, openModelPicker, activeModel
  ])
  
  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingContent

  return (
    <div className="rs-speak-stage">
      <div className="rs-speak-status">
        <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280' }} />
        <span style={{ fontWeight: 600, letterSpacing: '0.1em' }}>{convState.toUpperCase()}</span>
        {activeVoice && (
          <span className="rs-pill" style={{ fontSize: '0.65rem' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>settings_voice</span>
            {activeVoice.active_voice}
          </span>
        )}
        {memoryMuted && (
          <span className="rs-pill" style={{ fontSize: '0.65rem', color: '#facc15', fontWeight: 700 }}>
            MEMORY MUTED
          </span>
        )}
        <RateIndicator activeModel={activeModel} token={token} />
      </div>

      {showHistory ? (
        <div className="rs-card-flow" style={{ position: 'absolute', top: 60, left: 20, right: 20, bottom: 20, overflowY: 'auto', zIndex: 10, background: 'var(--bg-base)', padding: 20, borderRadius: 16 }}>
          {historySessions.length === 0 ? (
            <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center' }}>Neural archives empty.</div>
          ) : (
            historySessions.map(s => (
              <div key={s.id} className="rs-card is-tappable is-wide animate-page-in" onClick={() => loadSession(s.id)}>
                <div className="rs-card-inner">
                  <div className="rs-card-head">
                    <span className="rs-card-label">{fmtDate(s.updated_at)}</span>
                    <span className="rs-card-label" style={{ background: 'var(--primary)', color: 'var(--bg-base)', padding: '2px 8px', borderRadius: 4 }}>{s.title}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
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
      )}

      {error && (
        <div className="rs-speak-error">
          <span style={{ color: '#f87171', fontSize: '0.8rem' }}>{error}</span>
        </div>
      )}

      {showTranscript && !showHistory && (
        <div className="rs-speak-transcript">
          <div className="rs-speak-transcript-head">
            <span className="rs-card-label">Transcript</span>
            <button className="rs-pill" onClick={() => setShowTranscript(false)} aria-label="Close transcript">
              <span className="material-symbols-rounded">close</span>
            </button>
          </div>
          <div className="rs-speak-transcript-body">
            {viewingSession && (
              <div style={{ marginBottom: 24 }}>
                <button className="rs-pill is-active" onClick={() => setViewingSession(null)}>
                   <span className="material-symbols-rounded">live_tv</span>
                   RETURN TO LIVE STREAM
                </button>
              </div>
            )}
            <ConversationPanel
              messages={displayMessages}
              streamingContent={displayStreaming}
              toolEvents={toolEvents}
            />
          </div>
        </div>
      )}

      <ModelPickerPopover
        isOpen={modelPickerOpen}
        onClose={closeModelPicker}
        pos={popoverPos}
        selectedModel={activeModel}
        onSelect={(p, m) => { handleModelSelect(p, m); closeModelPicker(); }}
        localModels={localModels}
        nimModels={nimModels}
        cloudModels={cloudModels}
        hasNvidia={hasNvidia}
        hasCloud={hasCloud}
      />
    </div>
  )
}
