// =============================================================================
// src/pages/ConversationPage.jsx
//
// The main conversation interface: holographic figure, mic button, live
// transcript, and the scrollable conversation history panel.
//
// Audio architecture:
//   Browser mic → WAV bytes → WebSocket → Whisper → Ollama/LLM
//   Piper TTS → WAV bytes → WebSocket → AudioContext playback
//   sounddevice is never used server-side.
// =============================================================================

import React, { useState, useCallback, useRef } from 'react'
import RiverSong from '../components/RiverSong.jsx'
import ConversationPanel from '../components/ConversationPanel.jsx'
import { useWebSocket } from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL      = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

// ---------------------------------------------------------------------------
// WAV playback helper
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
// Component
// ---------------------------------------------------------------------------

export default function ConversationPage() {
  const [convState,        setConvState]        = useState('connecting')
  const [messages,         setMessages]         = useState([])
  const [streamingResponse,setStreamingResponse]= useState('')
  const [error,            setError]            = useState(null)

  const isPlayingRef = useRef(false)

  // ---- WebSocket message handler ----
  const handleMessage = useCallback((event) => {
    const { type, text, message, data } = event

    switch (type) {
      case 'connected':
        setConvState('connecting')
        setError(null)
        break
      case 'listening':
        setConvState('listening')
        setStreamingResponse('')
        setError(null)
        break
      case 'transcribing':
        setConvState('transcribing')
        break
      case 'transcript':
        if (text) setMessages(prev => [...prev, { role: 'user', text }])
        break
      case 'thinking':
        setConvState('thinking')
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
        setConvState('speaking')
        break
      case 'audio':
        if (data) {
          isPlayingRef.current = true
          setConvState('speaking')
          playWavBase64(data).then(() => {
            isPlayingRef.current = false
            setConvState('idle')
          })
        }
        break
      case 'idle':
        if (!isPlayingRef.current) setConvState('idle')
        break
      case 'routing':
        setConvState('routing')
        break
      case 'error':
        setError(message || 'An unknown error occurred.')
        break
      default:
        break
    }
  }, [])

  const { sendMessage, connectionStatus } = useWebSocket(WS_URL, handleMessage)

  // ---- Audio recorder ----
  const handleAudioComplete = useCallback((wavB64) => {
    sendMessage({ type: 'audio_data', data: wavB64 })
  }, [sendMessage])

  const { startRecording, isRecording, audioLevel } = useAudioRecorder({
    onComplete: handleAudioComplete,
  })

  // ---- Derived state ----
  const isActive  = convState !== 'idle' && convState !== 'connecting'
  const canSpeak  = convState === 'idle' && connectionStatus === 'connected'
  const visualLvl = (convState === 'listening' || convState === 'speaking') ? audioLevel : 0

  // ---- Handlers ----
  const handleStartListening = useCallback(async () => {
    if (!canSpeak) return
    setError(null)
    const granted = await startRecording()
    if (granted) {
      sendMessage({ type: 'start' })
    } else {
      setError('Microphone access denied. Allow mic access and try again.')
    }
  }, [canSpeak, startRecording, sendMessage])

  const handleReset = useCallback(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ type: 'reset_history' })
      setMessages([])
      setStreamingResponse('')
      setError(null)
    }
  }, [connectionStatus, sendMessage])

  // ---- Render ----
  return (
    <div className="conversation-page">

      {/* Left column: figure + controls */}
      <div className="visual-section">

        {/* Connection status strip */}
        <div className={`conn-status conn-status--${connectionStatus}`}>
          <span className="conn-dot" />
          {connectionStatus.toUpperCase()}
        </div>

        {/* Holographic figure */}
        <div className="figure-wrapper">
          <RiverSong state={convState} audioLevel={visualLvl} />
        </div>

        {/* State label */}
        <div className="state-label" aria-live="polite">
          {convState.toUpperCase()}
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="controls">
          <button
            className={`btn-listen ${isActive ? 'btn-listen--active' : ''}`}
            onClick={handleStartListening}
            disabled={!canSpeak}
            aria-label="Start listening"
          >
            {isActive ? convState.toUpperCase() : 'SPEAK'}
          </button>

          <button
            className="btn-secondary"
            onClick={handleReset}
            disabled={connectionStatus !== 'connected'}
            aria-label="Reset conversation history"
          >
            RESET
          </button>
        </div>

        {/* Live streaming response */}
        {streamingResponse && (
          <div className="streaming-response" aria-live="polite">
            {streamingResponse}
            <span className="cursor-blink" aria-hidden="true">|</span>
          </div>
        )}
      </div>

      {/* Right column: conversation history */}
      <ConversationPanel messages={messages} />
    </div>
  )
}
