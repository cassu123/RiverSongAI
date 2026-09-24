import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// The socket: capture what the hook sends and let the test play the server.
const sent = []
let serverSays = null
vi.mock('./useWebSocket.js', () => ({
  useWebSocket: (_url, onMessage) => {
    serverSays = onMessage
    return { sendMessage: (m) => sent.push(m), connectionStatus: 'connected', authError: null }
  },
}))

// The mic: record the order of events against the socket.
const order = []
let micOpens = true
vi.mock('./useAudioRecorder.js', () => ({
  useAudioRecorder: () => ({
    startRecording: vi.fn(async () => { order.push('mic-open'); return micOpens }),
    stopRecording: vi.fn(),
    isRecording: false,
    audioLevel: 0,
  }),
}))

const players = []
vi.mock('../utils/AudioPlayer.js', () => ({
  AudioPlayer: class {
    constructor() { this.isPlaying = false; this.pendingDecodes = 0; this.flushes = 0; this.played = []; this.clips = []; players.push(this) }
    playChunk(pcm) { this.played.push(pcm); return Promise.resolve() }
    playEncoded(buf) { this.clips.push(buf); this.pendingDecodes++; return Promise.resolve() }
    getLevel() { return this.level ?? 0 }
    interrupt() { this.flushes++ }
    stop() { this.flushes++ }
    close() {}
  },
}))

import { useConversation } from './useConversation.js'

beforeEach(() => { sent.length = 0; order.length = 0; micOpens = true })

describe('starting a voice turn', () => {
  it('tells the server before opening the mic, and listens', async () => {
    const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    sent.length = 0
    const origPush = sent.push.bind(sent)
    sent.push = (m) => { order.push(`send:${m?.type}`); return origPush(m) }
    await act(async () => { await result.current.startRecording() })
    expect(order.indexOf('send:start')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('send:start')).toBeLessThan(order.indexOf('mic-open'))
    expect(result.current.convState).toBe('listening')
    sent.push = origPush
  })

  it('goes back to idle and says why when the mic will not open', async () => {
    micOpens = false
    const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    await act(async () => { await result.current.startRecording() })
    expect(result.current.convState).toBe('idle')
    expect(result.current.error).toMatch(/microphone/i)
  })
})

describe('River speaking', () => {
  const player = () => players[players.length - 1]

  it('does not cut off a sentence when the next one arrives', () => {
    renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    // The server sends "speaking" before every sentence's audio.
    act(() => { serverSays({ type: 'speaking' }) })
    act(() => { serverSays({ type: 'speaking' }) })
    act(() => { serverSays({ type: 'speaking' }) })
    expect(player().flushes).toBe(0)
  })

  const chunk = (gen) => {
    const buf = new ArrayBuffer(4 + 8)
    new DataView(buf).setUint16(0, gen, true)
    return { type: 'audio_chunk', data: buf }
  }

  it('drops late audio from a reply you cut off, even many turns in', () => {
    const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    act(() => { serverSays({ type: 'speaking' }); serverSays(chunk(7)) })
    const before = player().played.length
    act(() => { result.current.bargeIn() })
    act(() => { serverSays(chunk(7)) })          // still in flight from the cut-off reply
    expect(player().played.length).toBe(before)
    act(() => { serverSays({ type: 'speaking' }); serverSays(chunk(8)) })  // the next turn
    expect(player().played.length).toBe(before + 1)
  })

  it('still cuts her off when you type over her', () => {
    const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    act(() => { serverSays({ type: 'speaking' }) })
    act(() => { result.current.sendText('stop, different question') })
    expect(player().flushes).toBeGreaterThan(0)
    expect(sent.some((m) => m?.type === 'interrupt')).toBe(true)
  })
})

describe('whole audio clips from the server', () => {
  const player = () => players[players.length - 1]
  const wavBase64 = btoa('RIFF....WAVEfmt ')   // content is opaque to the hook

  it('plays them, and does not drop to idle before they start', () => {
    const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    act(() => { serverSays({ type: 'speaking' }) })
    act(() => { serverSays({ type: 'audio', data: wavBase64, format: 'wav' }) })
    act(() => { serverSays({ type: 'idle' }) })   // arrives while the clip is still decoding
    expect(player().clips).toHaveLength(1)
    expect(player().clips[0]).toBeInstanceOf(ArrayBuffer)
    expect(result.current.convState).toBe('speaking')
  })
})

describe('her level while speaking', () => {
  const player = () => players[players.length - 1]

  it('comes from her own playback, not the mic', async () => {
    renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
    player().level = 0.62
    const seen = []
    const onPresence = (e) => { if (typeof e.detail?.level === 'number') seen.push(e.detail) }
    window.addEventListener('rs-presence', onPresence)
    act(() => { serverSays({ type: 'speaking' }) })
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    window.removeEventListener('rs-presence', onPresence)
    const speaking = seen.filter((d) => d.state === 'speaking')
    expect(speaking.length).toBeGreaterThan(0)
    expect(speaking.every((d) => d.level === 0.62)).toBe(true)
  })
})

describe('errors', () => {
  it('put River in the error state long enough to be seen, then settle', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
      act(() => { serverSays({ type: 'error', message: 'TTS error: voice model missing' }) })
      expect(result.current.convState).toBe('error')
      expect(result.current.error).toMatch(/TTS error/)
      act(() => { serverSays({ type: 'idle' }) })          // the server often follows with idle
      expect(result.current.convState).toBe('error')
      act(() => { vi.advanceTimersByTime(4500) })
      expect(result.current.convState).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })

  it('give way at once to something new happening', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useConversation({ token: 't', user: { id: 1 } }))
      act(() => { serverSays({ type: 'error', message: 'x' }) })
      act(() => { serverSays({ type: 'thinking' }) })
      expect(result.current.convState).toBe('thinking')
      act(() => { vi.advanceTimersByTime(4500) })
      expect(result.current.convState).toBe('thinking')
    } finally {
      vi.useRealTimers()
    }
  })
})
