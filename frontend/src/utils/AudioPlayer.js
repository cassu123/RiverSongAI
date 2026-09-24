/**
 * frontend/src/utils/AudioPlayer.js
 * 
 * Handles streaming raw PCM audio playback for "The Companion" experience.
 * Uses an AudioWorkletProcessor (`playback-processor.js`) for gapless playback
 * and eliminating the decodeAudioData latency overhead.
 */

// Audio handed to the worklet counts as "on its way" for this long, or until
// the worklet reports it playing. The server sends {type:'idle'} straight
// after its last chunk, before playback can have started.
const START_GRACE_MS = 1500

export class AudioPlayer {
  constructor(onStateChange) {
    this.ctx = null
    this.worklet = null
    this.initPromise = null
    this.isPlaying = false
    // Whole clips still being decoded. The server sends {type:'idle'} right
    // after an {type:'audio'} clip, before it can have started playing.
    this.pendingDecodes = 0
    this.awaitingUntil = 0
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
      // Tap the output so the orb can follow River's own voice.
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.levelBuf = new Float32Array(this.analyser.fftSize)
      this.worklet.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      
      this.worklet.port.onmessage = (e) => {
        if (e.data.type === 'playback_state') {
          if (e.data.active || e.data.queued > 0) this.awaitingUntil = 0
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
    this.awaitingUntil = performance.now() + START_GRACE_MS
    try {
      await this._init()
      if (this.worklet) {
        this.worklet.port.postMessage({ type: 'audio_chunk', data: int16Array })
      }
    } catch (err) {
      this.awaitingUntil = 0
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
      this.awaitingUntil = performance.now() + START_GRACE_MS
      this.worklet?.port.postMessage({ type: 'audio_chunk', data: pcm })
    } catch (err) {
      console.error('[AudioPlayer] Could not decode audio clip:', err)
    } finally {
      this.pendingDecodes--
    }
  }

  /** Playing, decoding, or audio handed over and about to start. */
  isBusy() {
    return this.isPlaying || this.pendingDecodes > 0 || performance.now() < this.awaitingUntil
  }

  /**
   * How loud River is right now, 0..1 — the RMS of what is actually playing.
   * Speech from the TTS sits around 0.05-0.2 RMS, so it is scaled to use the
   * range; the mic level (vad-processor.js) is scaled for a quieter source.
   */
  getLevel() {
    if (!this.analyser || !this.isPlaying) return 0
    this.analyser.getFloatTimeDomainData(this.levelBuf)
    let sum = 0
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i]
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 5)
  }

  /**
   * Instantly stops playback and flushes the ring buffer.
   */
  interrupt() {
    if (this.worklet) {
      this.worklet.port.postMessage({ type: 'flush' })
    }
    this.isPlaying = false
    this.awaitingUntil = 0
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
    this.analyser = null
    this.initPromise = null
  }
}
