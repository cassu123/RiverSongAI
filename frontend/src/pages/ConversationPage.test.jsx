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

describe('Voice page status', () => {
  beforeEach(() => {
    conv = {
      convState: 'idle', messages: [], streamingContent: '', error: null, setError: vi.fn(),
      isRecording: false, startRecording: vi.fn(), stopRecording: vi.fn(), audioLevel: 0,
      resetSession: vi.fn(), connectionStatus: 'connected', toolEvents: [],
    }
  })

  it('shows no status at all while idle, and invents no activity', () => {
    let bar = null
    const page = render(<ConversationPage setAction={(n) => { bar = n }} />)
    const barView = render(<>{bar}</>)
    const text = page.container.textContent + barView.container.textContent
    expect(text).not.toMatch(/READY|IDLE|AUTONOMOUS|temporal|subroutines/i)
    expect(page.container.querySelector('.rs-speak-status .rs-status-dot')).toBeNull()
    expect(barView.container.querySelector('.rs-status-dot')).toBeNull()
    expect(page.container.querySelector('.rs-speak-activity')).toBeNull()
  })

  it('names a state that means something is happening', () => {
    conv.convState = 'listening'
    let bar = null
    const page = render(<ConversationPage setAction={(n) => { bar = n }} />)
    const barView = render(<>{bar}</>)
    expect(page.container.textContent).toContain('LISTENING')
    expect(barView.container.textContent).toContain('LISTENING')
  })

  it('lists the tool calls River really made', () => {
    conv.toolEvents = [
      { type: 'tool_use', tool: 'control_device', input: { entity: 'light.living_room' } },
      { type: 'tool_result', tool: 'control_device', result: 'ok' },
      { type: 'tool_use', tool: 'find_notes', input: {} },
    ]
    const page = render(<ConversationPage setAction={() => {}} />)
    const items = [...page.container.querySelectorAll('.rs-speak-activity-item')]
    expect(items.map((li) => li.className.match(/is-(\w+)/)[1])).toEqual(['done', 'running'])
    expect(items[0].textContent).toContain('Control device')
    expect(items[1].textContent).toContain('Find notes')
  })
})

describe('Voice page transcript panel', () => {
  beforeEach(() => {
    localStorage.clear()
    conv = {
      convState: 'connecting', messages: [], streamingContent: '', error: null, setError: vi.fn(),
      isRecording: false, startRecording: vi.fn(), stopRecording: vi.fn(), audioLevel: 0,
      resetSession: vi.fn(), connectionStatus: 'connecting', toolEvents: [],
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
