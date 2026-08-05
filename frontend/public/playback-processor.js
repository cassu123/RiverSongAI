// playback-processor.js
// AudioWorkletProcessor for streaming raw PCM audio from the backend.
// Maintains a ring buffer.

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 30 seconds of buffer at 22050Hz
    this.bufferSize = 22050 * 30 
    this.buffer = new Float32Array(this.bufferSize)
    this.writePointer = 0
    this.readPointer = 0
    this.queuedSamples = 0
    
    this.port.onmessage = (e) => {
      if (e.data.type === 'audio_chunk') {
        const int16Array = e.data.data
        for (let i = 0; i < int16Array.length; i++) {
          if (this.queuedSamples < this.bufferSize) {
            this.buffer[this.writePointer] = int16Array[i] / 32768.0
            this.writePointer = (this.writePointer + 1) % this.bufferSize
            this.queuedSamples++
          }
        }
      } else if (e.data.type === 'flush') {
        this.writePointer = 0
        this.readPointer = 0
        this.queuedSamples = 0
      }
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0]
    const channel = output[0]
    if (!channel) return true

    let isPlaying = false

    if (this.queuedSamples >= channel.length) {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = this.buffer[this.readPointer]
        this.readPointer = (this.readPointer + 1) % this.bufferSize
        this.queuedSamples--
      }
      isPlaying = true
    } else {
      // Buffer underrun or finished playing. Drain whatever is left then fill with 0
      for (let i = 0; i < channel.length; i++) {
        if (this.queuedSamples > 0) {
          channel[i] = this.buffer[this.readPointer]
          this.readPointer = (this.readPointer + 1) % this.bufferSize
          this.queuedSamples--
          isPlaying = true
        } else {
          channel[i] = 0
        }
      }
    }

    // Post playback state back to main thread (used for Avatar visemes)
    this.port.postMessage({ type: 'playback_state', active: isPlaying, queued: this.queuedSamples })

    return true
  }
}

registerProcessor('playback-processor', PlaybackProcessor)
