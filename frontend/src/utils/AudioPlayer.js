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
    this.initPromise = null
    this.isPlaying = false
    // Whole clips still being decoded. The server sends {type:'idle'} right
    // after an {type:'audio'} clip, before it can have started playing.
    this.pendingDecodes = 0
    this.onStateChange = onStateChange
    // Maintain state tracking for Avatar visemes
    this.playbackState = { active: false, queued: 0 }
  }

  _init() {
    if (!this.initPromise) this.initPromise = this._createGraph()
    return this.initPromise
  }

  async _createGraph() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 })
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    if (!this.worklet) {
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
    }
  }

  /**
   * Add a raw PCM audio chunk to the playback ring buffer.
   * @param {Int16Array} int16Array - The raw PCM audio data.
   */
  async playChunk(int16Array) {
    try {
      await this._init()
      if (this.worklet) {
        this.worklet.port.postMessage({ type: 'audio_chunk', data: int16Array })
      }
    } catch (err) {
      console.error('[AudioPlayer] Initialization failed for chunk:', err)
    }
  }

  /**
   * Play a whole encoded clip (WAV or MP3). The server sends these as a JSON
   * {type:'audio'} frame — intent-routed replies, the startup briefing,
   * spoken chat replies — rather than as streamed PCM chunks.
   * decodeAudioData reads the header and resamples to this context's rate;
   * the worklet then plays it like any streamed chunk.
   * @param {ArrayBuffer} arrayBuffer
   */
  async playEncoded(arrayBuffer) {
    this.pendingDecodes++
    try {
      await this._init()
      const clip = await this.ctx.decodeAudioData(arrayBuffer)
      const ch = clip.getChannelData(0)
      const pcm = new Int16Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]))
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
      }
      this.worklet?.port.postMessage({ type: 'audio_chunk', data: pcm })
    } catch (err) {
      console.error('[AudioPlayer] Could not decode audio clip:', err)
    } finally {
      this.pendingDecodes--
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

  async close() {
    this.interrupt()
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close()
      } catch (err) {
        console.warn('[AudioPlayer] Error closing AudioContext:', err)
      }
    }
    this.ctx = null
    this.worklet = null
    this.initPromise = null
  }
}
