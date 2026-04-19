import React, { useState, useCallback, useRef, useEffect } from 'react'
import RiverSong        from '../components/RiverSong.jsx'
import ConversationPanel from '../components/ConversationPanel.jsx'
import { useWebSocket }  from '../hooks/useWebSocket.js'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import './ConversationPage.css'

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL      = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

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

const STATE_TABS = ['listening', 'thinking', 'speaking', 'idle']

export default function ConversationPage() {
  const [convState,         setConvState]         = useState('connecting')
  const [messages,          setMessages]          = useState([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [error,             setError]             = useState(null)
  const [inputText,         setInputText]         = useState('')
  const isPlayingRef = useRef(false)
  const inputRef     = useRef(null)

  const handleMessage = useCallback((event) => {
    const { type, text, message, data } = event
    switch (type) {
      case 'connected':    setConvState('connecting'); setError(null); break
      case 'listening':    setConvState('listening');  setStreamingResponse(''); setError(null); break
      case 'transcribing': setConvState('transcribing'); break
      case 'transcript':   if (text) setMessages(p => [...p, { role: 'user', text }]); break
      case 'thinking':     setConvState('thinking');   setStreamingResponse(''); break
      case 'response_chunk': setStreamingResponse(p => p + (text || '')); break
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

  const { sendMessage, connectionStatus } = useWebSocket(WS_URL, handleMessage)

  const handleAudioComplete = useCallback(wavB64 => {
    sendMessage({ type: 'audio_data', data: wavB64 })
  }, [sendMessage])

  const { startRecording, isRecording, audioLevel } = useAudioRecorder({
    onComplete: handleAudioComplete,
  })

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
    if (connectionStatus === 'connected') {
      sendMessage({ type: 'reset_history' })
      setMessages([])
      setStreamingResponse('')
      setError(null)
    }
  }, [connectionStatus, sendMessage])

  const handleSendText = useCallback(() => {
    const t = inputText.trim()
    if (!t || connectionStatus !== 'connected') return
    setMessages(p => [...p, { role: 'user', text: t }])
    sendMessage({ type: 'text_input', text: t })
    setInputText('')
    setConvState('thinking')
  }, [inputText, connectionStatus, sendMessage])

  const handleKeyDown = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText() }
  }, [handleSendText])

  return (
    <div className="conv-page">

      {/* Portrait zone */}
      <div className="conv-portrait-zone">
        <RiverSong state={convState} audioLevel={visualLvl} />

        {/* State indicator bar below portrait */}
        <div className="conv-state-bar">
          {STATE_TABS.map(s => (
            <div key={s} className={`conv-state-tab ${convState === s ? 'conv-state-tab--active' : ''}`}>
              <span className={`conv-state-tab-dot ${convState === s ? 'conv-state-tab-dot--active' : ''}`} />
              {s.toUpperCase()}
            </div>
          ))}
        </div>

        {error && (
          <div className="conv-error" role="alert">{error}</div>
        )}
      </div>

      {/* Messages + input zone */}
      <div className="conv-chat-zone">
        {/* Streaming response banner */}
        {streamingResponse && (
          <div className="conv-streaming" aria-live="polite">
            {streamingResponse}
            <span className="cursor-blink" aria-hidden="true">|</span>
          </div>
        )}

        {/* Message history */}
        <ConversationPanel messages={messages} />

        {/* Input bar */}
        <div className="conv-input-bar">
          <div className={`conv-mic-btn ${isActive ? 'conv-mic-btn--active' : ''} ${!canSpeak ? 'conv-mic-btn--disabled' : ''}`}
            onClick={handleStartListening}
            role="button"
            tabIndex={0}
            aria-label="Speak to River"
            onKeyDown={e => e.key === 'Enter' && handleStartListening()}
          >
            <MicIcon active={isActive} />
          </div>

          <input
            ref={inputRef}
            className="conv-text-input"
            type="text"
            placeholder="Type or speak..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={connectionStatus !== 'connected'}
          />

          <button
            className="conv-send-btn"
            onClick={handleSendText}
            disabled={!inputText.trim() || connectionStatus !== 'connected'}
          >
            SEND
          </button>

          <button className="conv-reset-btn" onClick={handleReset} title="Reset conversation">
            RESET
          </button>
        </div>
      </div>
    </div>
  )
}

function MicIcon({ active }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="6" y="1" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="9" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="6" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
