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

/** What a stopped turn may still send, and is ignored once stopped. */
const STOPPED_TURN_EVENTS = new Set([
  'transcribing', 'transcript', 'thinking', 'response_chunk', 'token',
  'tool_use', 'tool_result', 'speaking', 'audio', 'response_complete',
])

/** How long an error stays visible before River settles back to idle. */
const ERROR_HOLD_MS = 4000

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
  const errorTimerRef = useRef(null)
  // Set when the user stops a turn. Messages from that turn can still be in
  // flight; without this a late "speaking" or token would bring it back.
  // Cleared when the user starts a new turn.
  const stoppedTurnRef = useRef(false)
  const settleTimerRef = useRef(null)
  const expectedGenIdRef = useRef(0)
  // Newest generation id seen on an audio chunk. The server bumps its id once
  // per turn; interrupting must skip past the one actually playing, or late
  // chunks from the cut-off reply still play.
  const lastGenIdRef = useRef(-1)

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
    if (isPlaying) {
      // A decoded clip can start after the server has already said idle.
      setConvState('speaking')
    } else {
      setConvState(s => (s === 'speaking' ? 'idle' : s))
    }
  }), [])

  const handleMessage = useCallback((event) => {
    const { type, text, content, message, data, session_id, title } = event
    if (stoppedTurnRef.current && STOPPED_TURN_EVENTS.has(type)) return
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
        // Tell River's body she is doing something, so it shows: she reaches
        // out when a tool starts and gathers back in when it returns.
        window.dispatchEvent(new CustomEvent('rs-activity', {
          detail: { phase: type === 'tool_use' ? 'start' : 'end' },
        }))
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
        // The server sends this before every sentence's audio, not once per
        // reply. Flushing here cut each sentence off when the next arrived.
        // Stale audio from an earlier turn is dropped by gen_id instead, and
        // a new turn from the user interrupts her (bargeIn).
        setConvState('speaking')
        break
      case 'audio_chunk': {
        const buffer = data
        if (buffer.byteLength < 4) return
        const header = new DataView(buffer, 0, 4)
        const gen_id = header.getUint16(0, true)
        
        if (gen_id < expectedGenIdRef.current) {
          return
        }
        lastGenIdRef.current = Math.max(lastGenIdRef.current, gen_id)
        
        const pcm = new Int16Array(buffer, 4)
        setConvState('speaking')
        audioPlayer.playChunk(pcm).catch(console.error)
        break
      }
      case 'audio': {
        // Whole clips arrive as base64 JSON rather than binary chunks: replies
        // the intent router answers, the startup briefing, and chat replies
        // River is asked to speak. Nothing handled this, so all of those were
        // silent while the orb sat on "speaking".
        if (!event.data) break
        const bin = atob(event.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        setConvState('speaking')
        audioPlayer.playEncoded(bytes.buffer).catch(console.error)
        break
      }
      case 'idle':
        // An error is held for ERROR_HOLD_MS; the idle the server sends right
        // after one must not wipe it before it has been seen.
        //
        // The server also sends idle straight after its last audio, before
        // that audio has started playing. Going idle then made River drop to
        // idle for a moment and come back as "speaking". Wait for playback;
        // if it never starts (audio locked on a phone), settle anyway.
        clearTimeout(settleTimerRef.current)
        if (!audioPlayer.isBusy()) {
          setConvState(s => (s === 'error' ? s : 'idle'))
        } else {
          const settle = () => {
            if (audioPlayer.isBusy()) settleTimerRef.current = setTimeout(settle, 250)
            else setConvState(s => (s === 'speaking' ? 'idle' : s))
          }
          settleTimerRef.current = setTimeout(settle, 250)
        }
        break
      case 'error':
        // Nothing used to set the error state, so River never showed one.
        setError(message || 'An unknown error occurred.')
        setConvState('error')
        clearTimeout(errorTimerRef.current)
        errorTimerRef.current = setTimeout(() => setConvState(s => (s === 'error' ? 'idle' : s)), ERROR_HOLD_MS)
        break
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

  useEffect(() => {
    return () => {
      audioPlayer.close()
      clearTimeout(errorTimerRef.current)
      clearTimeout(settleTimerRef.current)
    }
  }, [audioPlayer])

  // Set by cancelListening: the recording that is about to finish is thrown
  // away instead of sent. The recorder reports synchronously from stop.
  const discardNextRef = useRef(false)

  const { startRecording: openMic, stopRecording, isRecording, audioLevel } = useAudioRecorder({
    onComplete: pcm => {
      if (discardNextRef.current) {
        discardNextRef.current = false
        setConvState(s => (s === 'listening' ? 'idle' : s))
        return
      }
      setConvState('thinking')
      sendMessage(pcm)
    },
    onNoSpeech: () => {
      discardNextRef.current = false
      setConvState(s => (s === 'listening' ? 'idle' : s))
    },
  })

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('rs-presence', { detail: { state: convState } }))
  }, [convState])

  // When this conversation goes away, River goes back to idle. This used to
  // be the cleanup of the effect above, which React runs before every re-run
  // — so River was told "idle" between every two states, and loosened for
  // about 4 s on each transition.
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('rs-presence', { detail: { state: 'idle' } }))
  }, [])

  // Amplitude on its own event. River's mind (presence/riverMind.js) reads
  // `rs-presence {state, level}`. Kept separate from the state effect so a
  // 60fps level never re-runs it.
  //
  // Listening: your voice, from the mic recorder.
  useEffect(() => {
    if (convState !== 'listening') return
    window.dispatchEvent(new CustomEvent('rs-presence', {
      detail: { state: convState, level: audioLevel },
    }))
  }, [audioLevel, convState])

  // Speaking: her voice, measured from what the player is actually playing.
  // This used to send the mic level here too — and the mic is closed by the
  // time she speaks, so her level was always 0.
  useEffect(() => {
    if (convState !== 'speaking') return undefined
    let raf = 0
    const tick = () => {
      window.dispatchEvent(new CustomEvent('rs-presence', {
        detail: { state: 'speaking', level: audioPlayer.getLevel() },
      }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [convState, audioPlayer])

  const bargeIn = useCallback(() => {
    if (convState === 'speaking' || convState === 'thinking' || convState === 'transcribing') {
      stoppedTurnRef.current = true
      audioPlayer.interrupt()
      expectedGenIdRef.current = Math.max(expectedGenIdRef.current, lastGenIdRef.current) + 1
      sendMessage({ type: 'interrupt' })
      finalizeStream()   // keep what she had said so far
      setConvState('idle')
    }
  }, [convState, audioPlayer, sendMessage, finalizeStream])

  /**
   * Start a voice turn. The server ignores any recorded audio that is not
   * preceded by {type:'start'} (conversation.py: waiting_for_audio), so tell
   * it first, then open the mic. If River is mid-reply, talking cuts her off.
   */
  const startListening = useCallback(async () => {
    // With no connection the recording would go nowhere and the turn would
    // hang on "thinking". Say so instead.
    if (connectionStatus !== 'connected') {
      setError('Not connected to River yet. Try again in a moment.')
      return false
    }
    if (convState === 'speaking' || convState === 'thinking' || convState === 'transcribing') bargeIn()
    stoppedTurnRef.current = false
    sendMessage({ type: 'start' })
    setConvState('listening')
    const opened = await openMic()
    if (!opened) {
      setConvState(s => (s === 'listening' ? 'idle' : s))
      setError("Microphone unavailable. Check this site's microphone permission.")
    }
    return opened
  }, [connectionStatus, convState, bargeIn, sendMessage, openMic])

  /** Stop listening and throw away what the mic heard (Mute). */
  const cancelListening = useCallback(() => {
    if (isRecording) {
      discardNextRef.current = true
      stopRecording()
    }
    setConvState(s => (s === 'listening' ? 'idle' : s))
  }, [isRecording, stopRecording])

  /**
   * The Stop button: whatever River is doing, stop. Listening, the recording
   * is thrown away; transcribing, thinking or speaking, the whole turn is
   * cancelled on the server and anything still arriving from it ignored.
   */
  const stop = useCallback(() => {
    if (convState === 'listening') cancelListening()
    else bargeIn()
  }, [convState, cancelListening, bargeIn])

  const sendText = useCallback((text, overrides = {}) => {
    if (!text.trim()) return
    // Typing over her cuts her off, the same as speaking over her.
    if (convState === 'speaking' || convState === 'thinking' || convState === 'transcribing') bargeIn()
    stoppedTurnRef.current = false
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
  }, [sendMessage, convState, bargeIn])

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
    startRecording: startListening,
    stopRecording,
    cancelListening,
    stop,
    bargeIn,
    sendText,
    resetSession,
    abortGeneration,
    sendMessage,
    connectionStatus,
    audioPlayer
  }
}
