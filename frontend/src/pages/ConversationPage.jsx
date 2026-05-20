import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react'
import ConversationPanel  from '../components/ConversationPanel.jsx'
import AudioVisualizer    from '../components/AudioVisualizer.jsx'
import Sheet, { SheetRow } from '../chrome/Sheet.jsx'
import { useWebSocket }   from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import { useAuth }        from '../context/AuthContext.jsx'
import { AudioPlayer }    from '../utils/AudioPlayer.js'
import {
  MODEL_FAMILIES,
  applyFamilyOverrides,
  findFamilyForModel,
  buildAvailabilitySet,
  familyHasAnyTier,
  TIER_ORDER,
} from '../utils/modelFamilies.js'

// NOTE: Future avatar work loads from /avatar.glb (frontend/public/avatar.glb).
// Swap the <RiverSong> orb below for an <AvatarModel> component once the rig
// is wired with facial + body animation.
const RiverSong = lazy(() => import('../components/RiverSong.jsx'))

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const MAX_HISTORY_SESSIONS = 30

function historyKey(userId) { return `rs-history:${userId}` }

function loadHistory(userId) {
  try { return JSON.parse(localStorage.getItem(historyKey(userId)) || '[]') } catch { return [] }
}
function saveHistory(userId, sessions) {
  try { localStorage.setItem(historyKey(userId), JSON.stringify(sessions.slice(-MAX_HISTORY_SESSIONS))) } catch {}
}

/** Pick the first available tier of a family. Voice doesn't need Thinking/Pro
 *  — we default to Fast for low latency. */
function pickVoiceTier(family) {
  for (const tier of TIER_ORDER) {
    if (family.tiers?.[tier]) return tier
  }
  return null
}

export default function ConversationPage({ setAction }) {
  const { token, user } = useAuth()
  const wsUrl = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

  const [convState,         setConvState]         = useState('connecting')
  const [messages,          setMessages]          = useState([])
  const [streamingContent,  setStreamingContent]  = useState('')
  const [error,             setError]             = useState(null)
  const [memoryMuted,       setMemoryMuted]       = useState(false)
  const [muted,             setMuted]             = useState(false)
  const [showTranscript,    setShowTranscript]    = useState(false)
  const [familySheetOpen,   setFamilySheetOpen]   = useState(false)

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

  const [activeModel,     setActiveModel]     = useState(null)  // { provider, model_id, display_name }
  const [activeVoice,     setActiveVoice]     = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)
  const [models,          setModels]          = useState({ local: [], cloud: [] })
  const [familyOverrides, setFamilyOverrides] = useState({})
  const [history,         setHistory]         = useState([])
  const [toolEvents,      setToolEvents]      = useState([])

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

  const { startRecording, stopRecording, audioLevel } = useAudioRecorder({
    onComplete: wavB64 => sendMessage({ type: 'audio_data', data: wavB64 }),
    onNoSpeech: () => setConvState(s => (s === 'listening' ? 'idle' : s)),
  })

  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const visualLvl = (convState === 'listening' || convState === 'speaking') ? audioLevel : 0

  const handleStartListening = useCallback(async () => {
    if (!canSpeak || muted) return
    setError(null)
    setConvState('listening')
    const granted = await startRecording()
    if (granted) {
      sendMessage({ type: 'start' })
    } else {
      setConvState('idle')
      setError('Microphone access denied.')
    }
  }, [canSpeak, muted, startRecording, sendMessage])

  const handleToggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev
      // If we're listening when the user mutes, stop the recorder immediately.
      if (next && convState === 'listening') {
        try { stopRecording() } catch {}
        setConvState('idle')
      }
      return next
    })
  }, [convState, stopRecording])

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
    setMemoryMuted(true)
  }, [connectionStatus, messages, sendMessage, user, activeModel])

  useEffect(() => {
    if (user) {
      const h = loadHistory(user.id)
      setHistory(Array.isArray(h) ? h : [])
    }
  }, [user])

  // Load models + family overrides + current selection.
  useEffect(() => {
    if (!token) return
    fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setModels({
          cloud: (data.cloud || []).filter(m => m.available),
          local: (data.local || []).filter(m => m.available),
        })
        setFamilyOverrides(data.family_overrides || {})
      })
      .catch(() => {})

    fetch('/api/settings/llm', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setActiveModel({
        provider:     d.provider,
        model_id:     d.model,
        display_name: d.display_name || d.model,
      }))
      .catch(() => {})

    fetch('/api/settings/voice', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setActiveVoice({ active_voice: d.active_voice }))
      .catch(() => {})
  }, [token])

  const visibleFamilies = useMemo(
    () => applyFamilyOverrides(MODEL_FAMILIES, familyOverrides),
    [familyOverrides],
  )

  const availabilitySet = useMemo(() => buildAvailabilitySet(models), [models])

  const currentMapping = useMemo(
    () => findFamilyForModel(activeModel?.provider, activeModel?.model_id, visibleFamilies),
    [activeModel?.provider, activeModel?.model_id, visibleFamilies],
  )

  const pickerLabel = currentMapping?.family?.displayName
    || activeModel?.display_name
    || 'Model'

  const handlePickFamily = useCallback(async (family) => {
    const tier = pickVoiceTier(family)
    const model_id = tier ? family.tiers[tier] : null
    if (!model_id) return
    setFamilySheetOpen(false)
    setSavingModel(true)
    setActiveModel({ provider: family.provider, model_id, display_name: family.displayName })
    try {
      await fetch(`/api/settings/llm?user_id=${user?.id || ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider: family.provider, model_id, cloud_fallback_enabled: false }),
      })
    } catch {}
    setSavingModel(false)
  }, [user?.id, token])

  // ---- Bottom action slot --------------------------------------------------
  useEffect(() => {
    if (!setAction) return
    setAction(
      <div className="rs-chat-input-container">
        {/* Row 1: Status / Text Info (Since this is voice-first, we use it for status) */}
        <div className="rs-chat-textarea" style={{ display: 'flex', alignItems: 'center', minHeight: 40, opacity: 0.8 }}>
          <span className="rs-status-dot" style={{ background: isActive ? '#4ade80' : '#6b7280', marginRight: 12 }} />
          <span style={{ fontWeight: 600, letterSpacing: '0.1em', fontSize: '0.85rem' }}>{convState.toUpperCase()}</span>
          {activeVoice && (
            <span className="rs-pill" style={{ fontSize: '0.65rem', marginLeft: 12 }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1rem', marginRight: 4 }}>settings_voice</span>
              {activeVoice.active_voice}
            </span>
          )}
        </div>

        {/* Row 2: Controls */}
        <div className="rs-chat-input-controls">
          <div className="rs-chat-input-left">
            <button
              className={`rs-pill ${muted ? 'is-active' : ''}`}
              onClick={handleToggleMute}
              title={muted ? 'Unmute mic' : 'Mute mic'}
            >
              <span className="material-symbols-rounded">{muted ? 'mic_off' : 'mic'}</span>
              <span className="rs-speak-actions-label">{muted ? 'Muted' : 'Live'}</span>
            </button>

            <button
              className={`rs-pill ${showTranscript ? 'is-active' : ''}`}
              onClick={() => setShowTranscript(s => !s)}
              title={showTranscript ? 'Hide transcript' : 'Show transcript'}
            >
              <span className="material-symbols-rounded">notes</span>
              <span className="rs-speak-actions-label">Transcript</span>
            </button>
          </div>

          <div className="rs-chat-input-right">
            <button
              className="rs-pill"
              onClick={() => setFamilySheetOpen(true)}
              title="Choose AI model"
              disabled={savingModel}
            >
              <span className="material-symbols-rounded">smart_toy</span>
              <span className="rs-speak-actions-label">{savingModel ? 'Syncing…' : pickerLabel}</span>
            </button>

            <button
              className="rs-btn-primary rs-icon-btn rs-send-btn"
              onClick={isActive ? undefined : handleStartListening}
              disabled={!canSpeak || muted}
              aria-label={isActive ? convState : 'Tap to speak'}
              style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>
                {convState === 'listening' ? 'stop'
                 : convState === 'speaking'  ? 'volume_up'
                 : convState === 'thinking'  ? 'hourglass_top'
                 : 'mic'}
              </span>
            </button>

            <button
              className="rs-pill"
              onClick={handleReset}
              title="Reset session"
            >
              <span className="material-symbols-rounded">refresh</span>
            </button>
          </div>
        </div>
      </div>
    )
  }, [
    muted, handleToggleMute,
    handleStartListening, canSpeak, isActive, convState,
    pickerLabel, savingModel,
    showTranscript, handleReset, setAction, activeVoice,
  ])

  return (
    <div className="rs-speak-stage">
      {/* Status strip — top of the stage */}
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
      </div>

      {/* Orb — front and center, fills the stage. Future: swap for avatar.glb. */}
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

      {/* Transcript overlay — slides up from the bottom when toggled on. */}
      {showTranscript && (
        <div className="rs-speak-transcript">
          <div className="rs-speak-transcript-head">
            <span className="rs-card-label">Transcript</span>
            <button className="rs-pill" onClick={() => setShowTranscript(false)} aria-label="Close transcript">
              <span className="material-symbols-rounded">close</span>
            </button>
          </div>
          <div className="rs-speak-transcript-body">
            <ConversationPanel
              messages={messages}
              streamingContent={streamingContent}
              toolEvents={toolEvents}
            />
          </div>
        </div>
      )}

      {/* Model family picker — single step, no tier (voice = Fast default). */}
      <Sheet open={familySheetOpen} onClose={() => setFamilySheetOpen(false)} title="AI model">
        {visibleFamilies.map(family => {
          const anyAvail = familyHasAnyTier(family, availabilitySet)
          const isActiveFam = currentMapping?.family?.id === family.id
          return (
            <SheetRow
              key={family.id}
              icon={family.icon || 'chat'}
              title={family.displayName}
              sub={anyAvail ? family.blurb : `${family.blurb} — unavailable`}
              active={isActiveFam}
              onClick={() => anyAvail && handlePickFamily(family)}
            />
          )
        })}
      </Sheet>
    </div>
  )
}
