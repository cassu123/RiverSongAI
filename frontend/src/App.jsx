// =============================================================================
// src/App.jsx
//
// Root application component for River Song AI.
//
// Audio architecture:
//   Recording: useAudioRecorder captures browser mic via Web Audio API,
//   encodes PCM as a WAV file, and sends {"type":"audio_data","data":"<b64>"}
//   over the WebSocket when speech ends.
//
//   Playback: the server synthesizes speech with Piper and sends back
//   {"type":"audio","data":"<b64>"}. App decodes the WAV and plays it via
//   AudioContext.decodeAudioData(). No audio device access occurs server-side.
//
// State machine transitions:
//   connected  -> idle
//   idle + SPEAK click -> sends "start" -> listening (browser records)
//   browser VAD ends -> sends "audio_data" -> transcribing -> thinking -> speaking
//   speaking -> receives "audio" -> browser plays -> idle
// =============================================================================

import React, { useState, useCallback, useRef } from 'react'
import RiverSong from './components/RiverSong.jsx'
import AudioVisualizer from './components/AudioVisualizer.jsx'
import ConversationPanel from './components/ConversationPanel.jsx'
import { useWebSocket } from './hooks/useWebSocket.js'
import { useAudioRecorder } from './hooks/useAudioRecorder.js'

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

// ---------------------------------------------------------------------------
// Browser audio playback helper
// ---------------------------------------------------------------------------

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

    return new Promise((resolve) => {
      source.onended = () => { ctx.close(); resolve() }
      source.start()
    })
  } catch (err) {
    console.error('[playWavBase64] Playback failed:', err)
  }
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function App() {
  const [conversationState, setConversationState] = useState('connecting')
  const [messages,          setMessages]          = useState([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [error,             setError]             = useState(null)

  // True while browser is playing back a TTS response; suppresses premature
  // "idle" events from the server so the speaking animation continues.
  const isPlayingRef = useRef(false)

  // ---------------------------------------------------------------------------
  // WebSocket message handler
  // ---------------------------------------------------------------------------

  const handleMessage = useCallback((event) => {
    const { type, text, message, data } = event

    switch (type) {
      case 'connected':
        setConversationState('connecting')
        setError(null)
        break

      case 'listening':
        setConversationState('listening')
        setStreamingResponse('')
        setError(null)
        break

      case 'transcribing':
        setConversationState('transcribing')
        break

      case 'transcript':
        if (text) setMessages(prev => [...prev, { role: 'user', text }])
        break

      case 'thinking':
        setConversationState('thinking')
        setStreamingResponse('')
        break

      case 'response_chunk':
        setStreamingResponse(prev => prev + (text || ''))
        break

      case 'response_complete':
        setStreamingResponse('')
        if (text) setMessages(prev => [...prev, { role: 'assistant', text }])
        break

      case 'speaking':
        setConversationState('speaking')
        break

      case 'audio':
        // Server sent synthesized WAV. Play it in the browser; stay in
        // "speaking" state until playback finishes, then go idle ourselves.
        if (data) {
          isPlayingRef.current = true
          setConversationState('speaking')
          playWavBase64(data).then(() => {
            isPlayingRef.current = false
            setConversationState('idle')
          })
        }
        break

      case 'idle':
        // Ignore server's idle while we're still playing audio locally
        if (!isPlayingRef.current) setConversationState('idle')
        break

      case 'error':
        setError(message || 'An unknown error occurred.')
        break

      default:
        break
    }
  }, [])

  const { sendMessage, connectionStatus } = useWebSocket(WS_URL, handleMessage)

  // ---------------------------------------------------------------------------
  // Audio recorder
  // ---------------------------------------------------------------------------

  const handleAudioComplete = useCallback((wavB64) => {
    sendMessage({ type: 'audio_data', data: wavB64 })
  }, [sendMessage])

  const { startRecording, isRecording, audioLevel } = useAudioRecorder({
    onComplete: handleAudioComplete,
  })

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------

  const isActive  = conversationState !== 'idle' && conversationState !== 'connecting'
  const canSpeak  = conversationState === 'idle' && connectionStatus === 'connected'
  const visualLevel = (conversationState === 'listening' || conversationState === 'speaking')
    ? audioLevel
    : 0

  // ---------------------------------------------------------------------------
  // Button handlers
  // ---------------------------------------------------------------------------

  const handleStartListening = useCallback(async () => {
    if (!canSpeak) return
    setError(null)
    const granted = await startRecording()
    if (granted) {
      sendMessage({ type: 'start' })
    } else {
      setError('Microphone access denied. Please allow mic access and try again.')
    }
  }, [canSpeak, startRecording, sendMessage])

  const handleResetHistory = useCallback(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ type: 'reset_history' })
      setMessages([])
      setStreamingResponse('')
      setError(null)
    }
  }, [connectionStatus, sendMessage])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">RIVER SONG</h1>
        <div className={`connection-status connection-status--${connectionStatus}`}>
          {connectionStatus.toUpperCase()}
        </div>
      </header>

      <main className="app-main">
        <div className="visual-section">
          <div className="figure-wrapper">
            <AudioVisualizer audioLevel={visualLevel} state={conversationState} />
            <RiverSong state={conversationState} audioLevel={visualLevel} />
          </div>

          <div className="state-label">
            {conversationState.toUpperCase()}
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <div className="controls">
            <button
              className={`btn-listen ${isActive ? 'btn-listen--active' : ''}`}
              onClick={handleStartListening}
              disabled={!canSpeak}
              aria-label="Start listening"
            >
              {isActive ? conversationState.toUpperCase() : 'SPEAK'}
            </button>

            <button
              className="btn-reset"
              onClick={handleResetHistory}
              disabled={connectionStatus !== 'connected'}
              aria-label="Reset conversation history"
            >
              RESET
            </button>
          </div>

          {streamingResponse && (
            <div className="streaming-response" aria-live="polite">
              {streamingResponse}
              <span className="cursor-blink" aria-hidden="true">|</span>
            </div>
          )}
        </div>

        <ConversationPanel messages={messages} />
      </main>
    </div>
  )
}
