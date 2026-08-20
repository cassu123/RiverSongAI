import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useWebSocket } from './useWebSocket.js'
import { useAudioRecorder } from './useAudioRecorder.js'
import { AudioPlayer } from '../utils/AudioPlayer.js'
import { API_BASE } from '../utils/useApi.js'

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

/**
 * Safety net for a turn that dies mid-stream without the server ever sending
 * `stream_done`. It is NOT how a normal turn ends — `stream_done` and
 * `response_complete` do that — so it should be long enough never to fire on a
 * turn that is merely slow.
 *
 * It used to be 30s, rearmed only by `token`. A turn that paused longer than
 * that while a tool ran got finalised early, and the tokens that arrived
 * afterwards opened a second message: one reply, split in two, with no
 * indication why. On a home server doing local inference, a 30s gap around a
 * tool call is ordinary.
 */
const STREAM_WATCHDOG_MS = 180000

export function useConversation({ token, user, sessionId, onSessionId, extraQueryParams = {} }) {
  const backendHost = API_BASE ? new URL(API_BASE).host : window.location.host;
  const wsProtocol = API_BASE ? (API_BASE.startsWith('https') ? 'wss:' : 'ws:') : WS_PROTOCOL;
  
  const params = new URLSearchParams(extraQueryParams);
  if (sessionId) params.append('session_id', sessionId);
  const qStr = params.toString();
  const wsUrl = `${wsProtocol}//${backendHost}/ws/conversation${qStr ? '?' + qStr : ''}`

  const [convState, setConvState] = useState('connecting')
  const [messages, setMessages] = useState([])
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState(null)
  const [toolEvents, setToolEvents] = useState([])

  const streamTimeoutRef = useRef(null)
  const expectedGenIdRef = useRef(0)

  const finalizeStream = useCallback(() => {
    setStreamingContent(current => {
      if (current) {
        setMessages(p => {
          const last = p[p.length - 1]
          if (last?.role === 'assistant' && last.text === current) return p
          return [...p, { role: 'assistant', text: current }]
        })
      }
      return ''
    })
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = null
    }
  }, [])

  /**
   * (Re)arm the watchdog. Anything that proves the turn is still alive should
   * call this — not just tokens. A tool call in flight is a live turn even
   * though nothing is being emitted.
   */
  const armStreamWatchdog = useCallback(() => {
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
    streamTimeoutRef.current = setTimeout(finalizeStream, STREAM_WATCHDOG_MS)
  }, [finalizeStream])

  const audioPlayer = useMemo(() => new AudioPlayer((isPlaying) => {
    if (!isPlaying) {
      setConvState(s => (s === 'speaking' ? 'idle' : s))
    }
  }), [])

  const handleMessage = useCallback((event) => {
    const { type, text, content, message, data, session_id, title } = event
    switch (type) {
      case 'connected':       setConvState('idle');       setError(null); break
      case 'listening':       setConvState('listening');  setStreamingContent(''); setError(null); break
      case 'transcribing':    setConvState('transcribing'); break
      case 'transcript':      if (text) setMessages(p => [...p, { role: 'user', text }]); break
      case 'thinking':
        setConvState('thinking')
        setStreamingContent('')
        armStreamWatchdog()
        break
      case 'response_chunk':
        setStreamingContent(p => p + (text || ''))
        armStreamWatchdog()
        break
      case 'token':
        setStreamingContent(p => p + (content || ''))
        armStreamWatchdog()
        break
      case 'tool_use':
      case 'tool_result':
        setToolEvents(p => [...p, event])
        // A tool running is the commonest reason for a long silence mid-turn.
        armStreamWatchdog()
        break
      case 'stream_done':
        finalizeStream()
        break
      case 'response_complete':
        if (text) {
          setMessages(p => {
            const last = p[p.length - 1]
            const msgObj = { role: 'assistant', text }
            if (event.receipts) msgObj.meta = { receipts: event.receipts }
            if (last?.role === 'assistant' && last.text === text) return p
            return [...p, msgObj]
          })
        }
        setStreamingContent('')
        break
      case 'speaking':
        setConvState('speaking')
        audioPlayer.stop()
        break
      case 'audio_chunk': {
        const buffer = data
        if (buffer.byteLength < 4) return
        const header = new DataView(buffer, 0, 4)
        const gen_id = header.getUint16(0, true)
        
        if (gen_id < expectedGenIdRef.current) {
          return
        }
        
        const pcm = new Int16Array(buffer, 4)
        setConvState('speaking')
        audioPlayer.playChunk(pcm).catch(console.error)
        break
      }
      case 'idle':
        if (!audioPlayer.isPlaying) setConvState('idle')
        break
      case 'error':   setError(message || 'An unknown error occurred.'); break
      case 'session':
        if (onSessionId) onSessionId(session_id)
        break
      case 'session_attached':
        if (onSessionId) onSessionId(session_id)
        break
      default: break
    }
  }, [audioPlayer, finalizeStream, armStreamWatchdog])

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

  const { startRecording, stopRecording, isRecording, audioLevel } = useAudioRecorder({
    onComplete: pcm => {
      setConvState('thinking')
      sendMessage(pcm)
    },
    onNoSpeech: () => setConvState(s => (s === 'listening' ? 'idle' : s)),
  })

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('rs-presence', { detail: { state: convState } }))
    return () => {
      window.dispatchEvent(new CustomEvent('rs-presence', { detail: { state: 'idle' } }))
    }
  }, [convState])

  // Amplitude on its own event. PresenceOrb has always documented
  // `rs-presence {state, level}` but only the state was ever dispatched, so
  // every avatar outside this page was deaf to the voice and could not pulse.
  // Kept separate from the state effect so a 60fps level never re-runs it.
  useEffect(() => {
    if (convState !== 'listening' && convState !== 'speaking') return
    window.dispatchEvent(new CustomEvent('rs-presence', {
      detail: { state: convState, level: audioLevel },
    }))
  }, [audioLevel, convState])

  const bargeIn = useCallback(() => {
    if (convState === 'speaking' || convState === 'thinking') {
      audioPlayer.interrupt()
      expectedGenIdRef.current += 1
      sendMessage({ type: 'interrupt' })
      setConvState('idle')
    }
  }, [convState, audioPlayer, sendMessage])

  const sendText = useCallback((text, overrides = {}) => {
    if (!text.trim()) return
    setError(null)
    setMessages(p => [...p, { role: 'user', text }])
    setStreamingContent('')
    setToolEvents([])
    // The server switches on the top-level `type` and has no "text" branch:
    // `elif msg_type == "text_input"` is the only thing that reads typed
    // input. This used to send {type:'text', text:'{"type":"text_input",...}'}
    // — a JSON string nested inside a field the server never parses — so
    // every typed message fell through the dispatch chain and was dropped.
    // The user saw their own message appear (it is added optimistically just
    // above) and River never answered.
    sendMessage({ type: 'text_input', text, ...overrides })
  }, [sendMessage])

  const resetSession = useCallback(() => {
    sendMessage({ type: 'reset_history', flush_memory: true })
    setMessages([])
    setStreamingContent('')
    setToolEvents([])
    setError(null)
  }, [sendMessage])

  const abortGeneration = useCallback(() => {
    bargeIn()
  }, [bargeIn])

  return {
    convState,
    setConvState,
    messages,
    setMessages,
    streamingContent,
    toolEvents,
    error,
    setError,
    audioLevel,
    isRecording,
    startRecording,
    stopRecording,
    bargeIn,
    sendText,
    resetSession,
    abortGeneration,
    sendMessage,
    connectionStatus,
    audioPlayer
  }
}
