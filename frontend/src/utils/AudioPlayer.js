/**
 * frontend/src/utils/AudioPlayer.js
 * 
 * Handles streaming raw PCM audio playback for "The Companion" experience.
 * Uses an AudioWorkletProcessor (`playback-processor.js`) for gapless playback
 * and eliminating the decodeAudioData latency overhead.
 */

export class AudioPlayer {
  constructor(onStateChange) {
    this.ctx = null
    this.worklet = null
    this.isPlaying = false
    this.onStateChange = onStateChange
    // Maintain state tracking for Avatar visemes
    this.playbackState = { active: false, queued: 0 }
  }

  async _init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 })
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    if (!this.worklet) {
      try {
        await this.ctx.audioWorklet.addModule('/playback-processor.js')
        this.worklet = new AudioWorkletNode(this.ctx, 'playback-processor')
        this.worklet.connect(this.ctx.destination)
        
        this.worklet.port.onmessage = (e) => {
          if (e.data.type === 'playback_state') {
            const wasPlaying = this.isPlaying
            this.playbackState = { active: e.data.active, queued: e.data.queued }
            this.isPlaying = e.data.active
            if (wasPlaying !== this.isPlaying && this.onStateChange) {
               this.onStateChange(this.isPlaying)
            }
          }
        }
      } catch (err) {
        console.error('[AudioPlayer] Failed to load playback worklet:', err)
      }
    }
  }

  /**
   * Add a raw PCM audio chunk to the playback ring buffer.
   * @param {Int16Array} int16Array - The raw PCM audio data.
   */
  async playChunk(int16Array) {
    await this._init()
    if (this.worklet) {
      this.worklet.port.postMessage({ type: 'audio_chunk', data: int16Array })
    }
  }

  /**
   * Instantly stops playback and flushes the ring buffer.
   */
  interrupt() {
    if (this.worklet) {
      this.worklet.port.postMessage({ type: 'flush' })
    }
    this.isPlaying = false
    this.playbackState = { active: false, queued: 0 }
  }

  stop() {
    this.interrupt()
  }
}
