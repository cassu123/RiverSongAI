// =============================================================================
// src/App.jsx
//
// Root application component for River Song AI.
//
// Responsibilities:
//   - Maintain conversation state machine (idle/listening/thinking/speaking/etc.)
//   - Own the WebSocket connection via useWebSocket
//   - Capture mic level for visualization via useAudioLevel
//   - Render the holographic visual, audio visualizer, and conversation panel
//
// State machine transitions driven by server events:
//   connected -> idle
//   idle + user clicks SPEAK -> sends {type:"start"} -> listening
//   listening -> transcribing -> thinking -> speaking -> idle
//   any step -> error -> idle
// =============================================================================

import React, { useState, useCallback } from 'react'
import RiverSong from './components/RiverSong.jsx'
import AudioVisualizer from './components/AudioVisualizer.jsx'
import ConversationPanel from './components/ConversationPanel.jsx'
import { useWebSocket } from './hooks/useWebSocket.js'
import { useAudioLevel } from './hooks/useAudioLevel.js'

// Use the Vite proxy -- no hardcoded port, works in both dev and production.
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

export default function App() {
  // Conversation state mirrors the server event stream
  const [conversationState, setConversationState] = useState('connecting')

  // Messages accumulated across turns for the ConversationPanel
  const [messages, setMessages] = useState([])

  // Current streaming response (shown live before response_complete)
  const [streamingResponse, setStreamingResponse] = useState('')

  // Non-fatal error message to surface in the UI
  const [error, setError] = useState(null)

  // Handle all incoming server events
  const handleMessage = useCallback((event) => {
    const { type, text, message } = event

    switch (type) {
      case 'connected':
        // Socket open but providers still initializing -- show idle once ready
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
        if (text) {
          setMessages(prev => [...prev, { role: 'user', text }])
        }
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
        if (text) {
          setMessages(prev => [...prev, { role: 'assistant', text }])
        }
        break

      case 'speaking':
        setConversationState('speaking')
        break

      case 'idle':
        setConversationState('idle')
        break

      case 'error':
        setError(message || 'An unknown error occurred.')
        // State resets to idle on the next idle event from the server
        break

      default:
        break
    }
  }, [])

  const { sendMessage, connectionStatus } = useWebSocket(WS_URL, handleMessage)

  // Only capture mic level when actively listening to drive the visualizer
  const isListening = conversationState === 'listening'
  const audioLevel = useAudioLevel(isListening)

  const isActive = conversationState !== 'idle' && conversationState !== 'connecting'
  const canSpeak = conversationState === 'idle' && connectionStatus === 'connected'

  const handleStartListening = useCallback(() => {
    if (canSpeak) {
      setError(null)
      sendMessage({ type: 'start' })
    }
  }, [canSpeak, sendMessage])

  const handleResetHistory = useCallback(() => {
    if (connectionStatus === 'connected') {
      sendMessage({ type: 'reset_history' })
      setMessages([])
      setStreamingResponse('')
      setError(null)
    }
  }, [connectionStatus, sendMessage])

  // Visualizer gets audioLevel only while listening; otherwise 0
  const visualLevel = isListening ? audioLevel : 0

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">RIVER SONG</h1>
        <div className={`connection-status connection-status--${connectionStatus}`}>
          {connectionStatus.toUpperCase()}
        </div>
      </header>

      <main className="app-main">
        {/* Left panel: holographic figure + controls */}
        <div className="visual-section">
          <div className="figure-wrapper">
            {/* AudioVisualizer is behind RiverSong (z-order via CSS) */}
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

          {/* Live streaming response shown below controls while LLM is generating */}
          {streamingResponse && (
            <div className="streaming-response" aria-live="polite">
              {streamingResponse}
              <span className="cursor-blink" aria-hidden="true">|</span>
            </div>
          )}
        </div>

        {/* Right panel: conversation history */}
        <ConversationPanel messages={messages} />
      </main>
    </div>
  )
}
