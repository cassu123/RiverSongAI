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

vi.mock('../utils/AudioPlayer.js', () => ({
  AudioPlayer: class {
    constructor() { this.isPlaying = false; this.flushes = 0 }
    playChunk() { return Promise.resolve() }
    playEncoded() { return Promise.resolve() }
    getLevel() { return 0 }
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
