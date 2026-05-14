import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { AudioPlayer } from '../utils/AudioPlayer'
import './KioskPage.css'

const RiverSong = lazy(() => import('../components/RiverSong'))

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws/conversation`

export default function KioskPage() {
  const [convState, setConvState] = useState('idle')
  const [speechBubble, setSpeechBubble] = useState('')
  const [showBubble, setShowBubble] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [time, setTime] = useState('')
  
  const audioPlayer = useRef(new AudioPlayer())
  const bubbleTimeout = useRef(null)
  const lipSyncInterval = useRef(null)

  // Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }))
    }
    updateClock()
    const id = setInterval(updateClock, 1000)
    return () => clearInterval(id)
  }, [])

  const handleMessage = useCallback((msg) => {
    const { type, text, content, data, format, timings } = msg

    switch (type) {
      case 'connected':
        setConvState('idle')
        break
      case 'listening':
        setConvState('listening')
        setAudioLevel(0)
        break
      case 'thinking':
        setConvState('thinking')
        setShowBubble(false)
        break
      case 'speaking':
        setConvState('speaking')
        break
      case 'token':
        setSpeechBubble(prev => prev + (content || ''))
        setShowBubble(true)
        if (bubbleTimeout.current) clearTimeout(bubbleTimeout.current)
        break
      case 'assistant_text':
        setSpeechBubble(text || '')
        setShowBubble(true)
        if (bubbleTimeout.current) clearTimeout(bubbleTimeout.current)
        bubbleTimeout.current = setTimeout(() => setShowBubble(false), 8000)
        break
      case 'audio':
        if (data) {
          setConvState('speaking')
          audioPlayer.current.playBase64(data, format || 'wav')
        }
        break
      case 'lip_sync':
        if (timings && Array.isArray(timings)) {
          if (lipSyncInterval.current) clearInterval(lipSyncInterval.current)
          let frame = 0
          lipSyncInterval.current = setInterval(() => {
            if (frame < timings.length) {
              setAudioLevel(timings[frame].open)
              frame++
            } else {
              clearInterval(lipSyncInterval.current)
              setAudioLevel(0)
            }
          }, 20)
        }
        break
      case 'idle':
        setConvState('idle')
        setAudioLevel(0)
        break
      case 'error':
        console.error('[Kiosk] WebSocket error:', msg.message)
        break
      default:
        break
    }
  }, [])

  const kioskToken = import.meta.env.VITE_KIOSK_TOKEN || 'change_me_kiosk_secret'
  const { connectionStatus, authError } = useWebSocket(WS_URL, handleMessage, { kioskToken })

  useEffect(() => {
    if (authError) {
      console.error('[Kiosk] WebSocket authentication error (4001). Connection stopped.')
    }
  }, [authError])

  useEffect(() => {
    return () => {
      if (bubbleTimeout.current) clearTimeout(bubbleTimeout.current)
      if (lipSyncInterval.current) clearInterval(lipSyncInterval.current)
      audioPlayer.current.stop()
    }
  }, [])

  return (
    <div className="kiosk-page">
      <div className="kiosk-clock">{time}</div>

      <div className="kiosk-avatar-container">
        <Suspense fallback={null}>
          <RiverSong 
            state={convState} 
            audioLevel={audioLevel} 
            compact={true} 
            lipSyncOpen={audioLevel} 
          />
        </Suspense>
      </div>

      <div className={`kiosk-bubble ${showBubble ? 'kiosk-bubble--visible' : ''}`}>
        {speechBubble}
      </div>

      <div className="kiosk-state-label">
        {convState !== 'idle' && (
          <>
            <span className="kiosk-state-icon">
              {convState === 'listening' ? '◉' : convState === 'thinking' ? '◌' : '◈'}
            </span>
            {convState.toUpperCase()}
          </>
        )}
      </div>

      <div className={`kiosk-status-dot kiosk-status-dot--${connectionStatus}`} />

      {connectionStatus === 'error' && (
        <div className="kiosk-error-overlay animate-pulse">
          <span className="material-symbols-rounded" style={{ fontSize: '3rem' }}>sync_problem</span>
          <div style={{ marginTop: 10, fontSize: '0.8rem', letterSpacing: '0.1em' }}>CONNECTION FAILED</div>
          <button className="btn btn--ghost btn--xs" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>RELOAD</button>
        </div>
      )}
    </div>
  )
}
