// =============================================================================
// src/hooks/useAudioLevel.js
//
// React hook that reads real-time microphone amplitude via the Web Audio API.
//
// Used exclusively for visual feedback -- the actual audio recording for
// Whisper transcription happens on the Python backend via sounddevice.
// Both the frontend and backend access the mic independently:
//   Frontend: Web Audio API -> animation level for the holographic figure
//   Backend:  sounddevice   -> Whisper transcription
//
// The hook requests mic access when `active` becomes true and releases
// all resources (AudioContext, MediaStream tracks) when `active` goes false
// or the component unmounts.
//
// Returns:
//   audioLevel {number} Normalized amplitude 0.0-1.0, updated every animation frame
//
// Usage:
//   const level = useAudioLevel(conversationState === 'listening')
// =============================================================================

import { useEffect, useRef, useState } from 'react'

const FFT_SIZE   = 256
const SMOOTHING  = 0.8  // Higher = more smoothed (less jitter)

export function useAudioLevel(active) {
  const [audioLevel, setAudioLevel] = useState(0)

  const contextRef  = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef   = useRef(null)
  const streamRef   = useRef(null)
  const animRef     = useRef(null)

  useEffect(() => {
    if (!active) {
      setAudioLevel(0)
      return
      // No cleanup needed -- nothing was started in this branch
    }

    let cancelled = false

    const startCapture = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        })

        // Check if the effect was already cleaned up while waiting for permission
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        streamRef.current = stream

        const context = new AudioContext()
        contextRef.current = context

        const analyser = context.createAnalyser()
        analyser.fftSize                = FFT_SIZE
        analyser.smoothingTimeConstant  = SMOOTHING
        analyserRef.current             = analyser

        const source = context.createMediaStreamSource(stream)
        source.connect(analyser)
        sourceRef.current = source

        const dataArray = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          if (cancelled) return

          analyser.getByteFrequencyData(dataArray)

          // Average frequency energy and normalize to 0-1
          const sum  = dataArray.reduce((acc, v) => acc + v, 0)
          const avg  = sum / dataArray.length
          const norm = Math.min(1, avg / 128)

          setAudioLevel(norm)
          animRef.current = requestAnimationFrame(tick)
        }

        animRef.current = requestAnimationFrame(tick)

      } catch (err) {
        if (!cancelled) {
          console.warn('[useAudioLevel] Mic access denied or unavailable:', err.message)
          setAudioLevel(0)
        }
      }
    }

    startCapture()

    // Cleanup: cancel the animation loop and release all audio resources
    return () => {
      cancelled = true

      if (animRef.current)   cancelAnimationFrame(animRef.current)
      if (sourceRef.current) sourceRef.current.disconnect()
      if (contextRef.current && contextRef.current.state !== 'closed') {
        contextRef.current.close().catch(() => {})
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }

      contextRef.current  = null
      analyserRef.current = null
      sourceRef.current   = null
      streamRef.current   = null

      setAudioLevel(0)
    }
  }, [active])

  return audioLevel
}
