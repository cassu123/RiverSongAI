import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ChatInterface from './ChatInterface.jsx'
import React from 'react'

// Mock dependencies
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: 'mock-token', user: { id: 'u1' } })
}))
vi.mock('../hooks/useAudioRecorder.js', () => ({
  useAudioRecorder: () => ({ startRecording: vi.fn(), stopRecording: vi.fn(), isRecording: false })
}))

describe('ChatInterface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ cloud: [], local: [] })
      })
    )
  })

  it('hydrates initialIntent and triggers send on mount', async () => {
    const initialIntent = {
      text: 'River, status on the Crawler.',
      docId: 'vehicle_123'
    }

    render(<ChatInterface initialIntent={initialIntent} embedded={true} />)

    // Wait for the useEffect timeout (50ms) to trigger handleSend
    await new Promise(r => setTimeout(r, 100))

    // Verify fetch was called with the correct RAG query
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/rag/query'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"doc_id":"vehicle_123"')
      })
    )
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/rag/query'),
      expect.objectContaining({
        body: expect.stringContaining('"question":"River, status on the Crawler."')
      })
    )
  })
})
