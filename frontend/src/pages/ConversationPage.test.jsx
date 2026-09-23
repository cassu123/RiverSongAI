import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import React from 'react'
import ConversationPage from './ConversationPage.jsx'

vi.mock('@context/AuthContext.jsx', () => ({ useAuth: () => ({ token: 't', user: { id: 1 } }) }))
// River needs WebGL, which jsdom lacks; she is not what this tests.
vi.mock('@/presence/RiverOrb.jsx', () => ({ default: () => <div data-testid="river" /> }))

let conv
vi.mock('@hooks/useConversation.js', () => ({ useConversation: () => conv }))

function setup() {
  let bar = null
  const setAction = (node) => { bar = node }
  const page = render(<ConversationPage setAction={setAction} />)
  const barView = render(<>{bar}</>)
  const panel = () => page.container.querySelector('.rs-speak-transcript-float')
  const toggle = () => barView.getByRole('button', { name: /transcript/i })
  const rerenderBar = () => barView.rerender(<>{bar}</>)
  return { panel, toggle, rerenderBar }
}

describe('Voice page transcript panel', () => {
  beforeEach(() => {
    localStorage.clear()
    conv = {
      convState: 'connecting', messages: [], streamingContent: '', error: null, setError: vi.fn(),
      isRecording: false, startRecording: vi.fn(), stopRecording: vi.fn(), audioLevel: 0,
      resetSession: vi.fn(), connectionStatus: 'connecting',
    }
  })

  it('stays hidden while there is nothing to show', () => {
    const { panel } = setup()
    expect(panel().classList.contains('is-live')).toBe(false)
  })

  it('shows once there is a conversation', () => {
    conv.messages = [{ role: 'user', text: 'dim the lights' }]
    const { panel } = setup()
    expect(panel().classList.contains('is-live')).toBe(true)
  })

  it('hides and shows from the toggle, and remembers the choice', () => {
    conv.messages = [{ role: 'user', text: 'dim the lights' }]
    const { panel, toggle, rerenderBar } = setup()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    act(() => { fireEvent.click(toggle()) })
    expect(panel().classList.contains('is-live')).toBe(false)
    expect(localStorage.getItem('rs-voice-transcript')).toBe('off')
    rerenderBar()
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    act(() => { fireEvent.click(toggle()) })
    expect(panel().classList.contains('is-live')).toBe(true)
    expect(localStorage.getItem('rs-voice-transcript')).toBe('on')
  })

  it('starts hidden when it was turned off last time', () => {
    localStorage.setItem('rs-voice-transcript', 'off')
    conv.messages = [{ role: 'assistant', text: 'Done.' }]
    const { panel } = setup()
    expect(panel().classList.contains('is-live')).toBe(false)
  })
})
