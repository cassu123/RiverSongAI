// vad-processor.js
// AudioWorkletProcessor for capturing mic, downsampling to 16kHz, and applying VAD.

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetSampleRate = 16000
    this.nativeSampleRate = sampleRate // Provided by AudioWorklet environment
    this.ratio = this.nativeSampleRate / this.targetSampleRate

    this.silenceThreshold = 0.015
    this.silenceMs = 1700
    this.prespeechMs = 5000
    this.maxSpeechMs = 28000

    this.speechDetected = false
    this.silenceTime = 0
    this.totalTime = 0

    // Downsampling state
    this.lastSample = 0
    this.fractionalPos = 0
    this.pcmBuffer = []
    this.chunkSize = 4096 // Output chunk size at 16kHz
    
    this.isAmbient = false

    this.port.onmessage = (e) => {
      if (e.data.type === 'set_ambient') {
        this.isAmbient = e.data.enabled
      } else if (e.data.type === 'reset') {
        this.speechDetected = false
        this.silenceTime = 0
        this.totalTime = 0
        this.pcmBuffer = []
      }
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channel = input[0] // Mono
    if (!channel) return true

    // 1. Resample and collect to pcmBuffer (Linear Interpolation)
    for (let i = 0; i < channel.length; i++) {
      const currentSample = channel[i]
      
      while (this.fractionalPos < 1) {
        // Interpolate
        const interpolated = this.lastSample + this.fractionalPos * (currentSample - this.lastSample)
        
        // Convert to Int16
        const s = Math.max(-1, Math.min(1, interpolated))
        this.pcmBuffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF)
        
        this.fractionalPos += this.ratio
      }
      this.fractionalPos -= 1
      this.lastSample = currentSample
    }

    // 2. Output chunks of `this.chunkSize`
    while (this.pcmBuffer.length >= this.chunkSize) {
      const chunk = this.pcmBuffer.splice(0, this.chunkSize)
      const pcm16 = new Int16Array(chunk)
      
      // Calculate RMS for VAD (on the Int16 data)
      let sumSq = 0
      for (let i = 0; i < pcm16.length; i++) {
        const normalized = pcm16[i] / 32768.0
        sumSq += normalized * normalized
      }
      const rms = Math.sqrt(sumSq / pcm16.length)
      const volumeLevel = Math.min(1, rms * 30)

      this.port.postMessage({ type: 'volume', level: volumeLevel })

      // Ambient mode just blasts chunks
      if (this.isAmbient) {
        this.port.postMessage({ type: 'audio_chunk', data: pcm16 }, [pcm16.buffer])
        continue
      }

      // VAD Logic
      const chunkDurationMs = (this.chunkSize / this.targetSampleRate) * 1000
      this.totalTime += chunkDurationMs

      if (!this.speechDetected) {
        if (rms > this.silenceThreshold) {
          this.speechDetected = true
        } else if (this.totalTime > this.prespeechMs) {
          // Timeout
          this.port.postMessage({ type: 'timeout' })
        }
        continue
      }

      // If speech detected, send chunk
      this.port.postMessage({ type: 'audio_chunk', data: pcm16 }, [pcm16.buffer])

      // Check silence
      if (rms < this.silenceThreshold * 0.6) {
        this.silenceTime += chunkDurationMs
        if (this.silenceTime >= this.silenceMs) {
          this.port.postMessage({ type: 'speech_end' })
        }
      } else {
        this.silenceTime = 0
      }

      if (this.totalTime >= this.maxSpeechMs) {
        this.port.postMessage({ type: 'speech_end' })
      }
    }

    return true
  }
}

registerProcessor('vad-processor', VadProcessor)
