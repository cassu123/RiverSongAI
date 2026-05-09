/**
 * frontend/src/utils/AudioPlayer.js
 * 
 * Handles streaming audio playback for "The Companion" experience.
 * Manages a queue of audio buffers and plays them seamlessly.
 */

export class AudioPlayer {
  constructor() {
    this.ctx = null
    this.queue = []
    this.isPlaying = false
  }

  _init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  /**
   * Add a base64 WAV chunk to the playback queue.
   */
  async playBase64(b64) {
    this._init()
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    
    try {
      const buffer = await this.ctx.decodeAudioData(bytes.buffer)
      this.queue.push(buffer)
      if (!this.isPlaying) {
        this._playNext()
      }
    } catch (err) {
      console.error('[AudioPlayer] Decode failed:', err)
    }
  }

  _playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false
      return
    }

    this.isPlaying = true
    const buffer = this.queue.shift()
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    
    source.onended = () => {
      this._playNext()
    }
    
    source.start(0)
  }

  stop() {
    this.queue = []
    this.isPlaying = false
    // We don't close the context, just stop playback if needed
  }
}
