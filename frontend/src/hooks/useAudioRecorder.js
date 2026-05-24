// =============================================================================
// src/hooks/useAudioRecorder.js
//
// Records mic audio in the browser and sends raw PCM over Binary WebSockets.
// Uses an AudioWorkletProcessor (`vad-processor.js`) for non-blocking capture,
// VAD (Voice Activity Detection), and linear downsampling to 16kHz.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

export function useAudioRecorder({ onComplete, onNoSpeech, onAmbientChunk }) {
  const [isRecording, setIsRecording] = useState(false)
  const [audioLevel,  setAudioLevel]  = useState(0)

  const onCompleteRef = useRef(onComplete)
  const onNoSpeechRef = useRef(onNoSpeech)
  const onAmbientChunkRef = useRef(onAmbientChunk)

  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onNoSpeechRef.current = onNoSpeech }, [onNoSpeech])
  useEffect(() => { onAmbientChunkRef.current = onAmbientChunk }, [onAmbientChunk])

  const contextRef   = useRef(null)
  const workletRef   = useRef(null)
  const streamRef    = useRef(null)
  
  const [isAmbient, setIsAmbient] = useState(false)
  const isAmbientRef = useRef(false)
  
  // Collect chunks if not in ambient mode
  const chunksRef = useRef([])

  const stopRecording = useCallback(() => {
    const worklet = workletRef.current
    const context = contextRef.current
    const stream  = streamRef.current

    if (worklet) {
      worklet.port.onmessage = null
      worklet.disconnect()
      workletRef.current = null
    }

    if (context && context.state !== 'closed') {
      context.close().catch(() => {})
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
    }

    contextRef.current = null
    streamRef.current  = null

    // If we have accumulated PCM data, return it
    if (chunksRef.current.length > 0) {
      const totalLen = chunksRef.current.reduce((acc, val) => acc + val.length, 0)
      const merged = new Int16Array(totalLen)
      let offset = 0
      for (const chunk of chunksRef.current) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      onCompleteRef.current?.(merged)
    } else if (!isAmbientRef.current) {
      onNoSpeechRef.current?.()
    }

    chunksRef.current = []
    setIsRecording(false)
    setAudioLevel(0)
  }, [])

  const startRecording = useCallback(async () => {
    if (isRecording) return true

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false
      })
      streamRef.current = stream

      const AudioCtx = window.AudioContext || window.webkitAudioContext
      // Request 16kHz if browser allows, otherwise worklet downsamples
      const context = new AudioCtx({ sampleRate: 16000 })
      if (context.state === 'suspended') await context.resume()
      contextRef.current = context

      await context.audioWorklet.addModule('/vad-processor.js')

      const source = context.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(context, 'vad-processor')
      workletRef.current = worklet

      chunksRef.current = []

      worklet.port.onmessage = (e) => {
        const msg = e.data
        if (msg.type === 'volume') {
          setAudioLevel(msg.level)
        } else if (msg.type === 'audio_chunk') {
          if (isAmbientRef.current) {
            onAmbientChunkRef.current?.(msg.data)
          } else {
            chunksRef.current.push(msg.data)
          }
        } else if (msg.type === 'speech_end' || msg.type === 'timeout') {
          setTimeout(stopRecording, 0)
        }
      }

      worklet.port.postMessage({ type: 'set_ambient', enabled: isAmbientRef.current })

      source.connect(worklet)
      worklet.connect(context.destination) // Required for worklet to process

      setIsRecording(true)
      return true
    } catch (err) {
      console.error('[useAudioRecorder] Mic access failed:', err.message)
      return false
    }
  }, [isRecording, stopRecording])

  const toggleAmbient = useCallback(async (enabled) => {
    if (!enabled) {
      isAmbientRef.current = false
      setIsAmbient(false)
      stopRecording()
      return
    }
    const ok = await startRecording()
    if (ok) {
      isAmbientRef.current = true
      setIsAmbient(true)
      if (workletRef.current) {
        workletRef.current.port.postMessage({ type: 'set_ambient', enabled: true })
      }
    }
  }, [startRecording, stopRecording])

  useEffect(() => () => stopRecording(), [stopRecording])

  return { startRecording, stopRecording, isRecording, audioLevel, toggleAmbient, isAmbient }
}
