// =============================================================================
// src/hooks/useAudioRecorder.js
//
// Records mic audio in the browser and encodes it as a base64 WAV string.
//
// Uses ScriptProcessorNode (deprecated but universally supported) to capture
// raw PCM samples from the AudioContext at the device's native sample rate.
// The WAV header includes the actual sample rate so the server (soundfile +
// scipy) can decode and resample to 16 kHz for Whisper.
//
// VAD behaviour:
//   - Waits up to PRESPEECH_CHUNKS before speech is detected (then gives up)
//   - Auto-stops after SILENCE_CHUNKS consecutive chunks below SILENCE_THRESHOLD
//   - Hard cap at MAX_CHUNKS to prevent runaway recordings (~28 s at 44.1 kHz)
//
// Usage:
//   const { startRecording, stopRecording, isRecording, audioLevel } =
//     useAudioRecorder({ onComplete: (wavB64) => sendMessage({...}) })
//
// onComplete fires with a base64-encoded WAV string when recording ends.
// If no speech was ever detected, onComplete is NOT called.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

const CHUNK_SIZE        = 4096   // ScriptProcessor buffer size (samples)
const SILENCE_THRESHOLD = 0.015  // RMS below this = silence
const SILENCE_CHUNKS    = 18     // ~1.7 s of silence ends recording (at 44.1 kHz)
const PRESPEECH_CHUNKS  = 400    // Max chunks to wait for speech to begin (~37 s)
const MAX_CHUNKS        = 300    // Hard cap on speech length (~28 s)

// ---------------------------------------------------------------------------
// WAV encoding helpers (pure functions, no React)
// ---------------------------------------------------------------------------

function encodeWAV(samples, sampleRate) {
  const numSamples = samples.length
  const byteRate   = sampleRate * 2  // 16-bit mono
  const buf        = new ArrayBuffer(44 + numSamples * 2)
  const view       = new DataView(buf)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0,  'RIFF')
  view.setUint32(4,  36 + numSamples * 2, true)
  writeStr(8,  'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16,         true)  // chunk size
  view.setUint16(20, 1,          true)  // PCM format
  view.setUint16(22, 1,          true)  // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate,   true)
  view.setUint16(32, 2,          true)  // block align
  view.setUint16(34, 16,         true)  // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, numSamples * 2, true)

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }

  return buf
}

function bufferToBase64(buffer) {
  const bytes  = new Uint8Array(buffer)
  let   binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAudioRecorder({ onComplete, onNoSpeech }) {
  const [isRecording, setIsRecording] = useState(false)
  const [audioLevel,  setAudioLevel]  = useState(0)

  // Keep callbacks fresh without invalidating start/stop
  const onCompleteRef = useRef(onComplete)
  const onNoSpeechRef = useRef(onNoSpeech)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
  useEffect(() => { onNoSpeechRef.current = onNoSpeech }, [onNoSpeech])

  // Audio graph refs -- hold nodes between renders
  const contextRef   = useRef(null)
  const processorRef = useRef(null)
  const streamRef    = useRef(null)

  // Recording state held in a single ref to avoid closure stale-ness
  const recRef = useRef({
    samples:        [],   // Array of Float32Array chunks
    speechDetected: false,
    silenceCount:   0,
    chunkCount:     0,
  })

  const stopRecording = useCallback(() => {
    const processor = processorRef.current
    const context   = contextRef.current
    const stream    = streamRef.current
    const rec       = recRef.current

    // Detach processor first so no more onaudioprocess calls fire
    if (processor) {
      processor.onaudioprocess = null
      processor.disconnect()
      processorRef.current = null
    }

    // Encode and deliver only if speech was actually detected
    if (rec.speechDetected && rec.samples.length > 0) {
      const totalLen = rec.samples.reduce((a, s) => a + s.length, 0)
      const flat     = new Float32Array(totalLen)
      let   offset   = 0
      for (const s of rec.samples) { flat.set(s, offset); offset += s.length }

      const sampleRate = context?.sampleRate ?? 44100
      const wavBuf     = encodeWAV(flat, sampleRate)
      onCompleteRef.current?.(bufferToBase64(wavBuf))
    } else {
      onNoSpeechRef.current?.()
    }

    if (context && context.state !== 'closed') context.close().catch(() => {})
    if (stream) stream.getTracks().forEach(t => t.stop())

    contextRef.current   = null
    streamRef.current    = null
    recRef.current       = { samples: [], speechDetected: false, silenceCount: 0, chunkCount: 0 }

    setIsRecording(false)
    setAudioLevel(0)
  }, [])  // no deps -- uses only refs

  const startRecording = useCallback(async () => {
    if (isRecording) return true

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const context = new AudioContext()
      contextRef.current = context

      const source    = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(CHUNK_SIZE, 1, 1)
      processorRef.current = processor

      // Silent gain node: processor must be connected to destination to fire,
      // but we don't want mic audio routing to speakers.
      const silentGain = context.createGain()
      silentGain.gain.value = 0
      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(context.destination)

      recRef.current = { samples: [], speechDetected: false, silenceCount: 0, chunkCount: 0 }

      processor.onaudioprocess = (e) => {
        const rec   = recRef.current
        const chunk = e.inputBuffer.getChannelData(0)

        // RMS energy for VAD and visualizer
        let   sumSq = 0
        for (let i = 0; i < chunk.length; i++) sumSq += chunk[i] * chunk[i]
        const rms = Math.sqrt(sumSq / chunk.length)
        setAudioLevel(Math.min(1, rms * 30))

        rec.chunkCount++

        if (!rec.speechDetected) {
          if (rms > SILENCE_THRESHOLD) {
            rec.speechDetected = true
          } else if (rec.chunkCount > PRESPEECH_CHUNKS) {
            // No speech after timeout -- give up silently
            setTimeout(stopRecording, 0)
          }
          return  // Don't accumulate pre-speech chunks
        }

        rec.samples.push(new Float32Array(chunk))

        if (rms < SILENCE_THRESHOLD * 0.6) {
          rec.silenceCount++
          if (rec.silenceCount >= SILENCE_CHUNKS) {
            setTimeout(stopRecording, 0)
            return
          }
        } else {
          rec.silenceCount = 0
        }

        if (rec.samples.length >= MAX_CHUNKS) {
          setTimeout(stopRecording, 0)
        }
      }

      setIsRecording(true)
      return true

    } catch (err) {
      console.error('[useAudioRecorder] Mic access failed:', err.message)
      return false
    }
  }, [isRecording, stopRecording])

  // Cleanup on unmount
  useEffect(() => () => stopRecording(), [stopRecording])

  return { startRecording, stopRecording, isRecording, audioLevel }
}
