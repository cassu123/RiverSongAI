import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import ConversationPanel from './ConversationPanel.jsx'

// jsdom has no layout, so no scrollIntoView; the panel scrolls itself on update.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {}

describe('Chat tool panel', () => {
  it('labels a failed tool call as failed, not as a result', () => {
    const toolEvents = [
      { type: 'tool_use', tool: 'get_weather', input: { location: 'Leeds' } },
      { type: 'tool_result', tool: 'get_weather', ok: false, result: "I tried to check the weather for 'Leeds', but encountered an issue: 503" },
      { type: 'tool_use', tool: 'find_notes', input: {} },
      { type: 'tool_result', tool: 'find_notes', ok: true, result: '3 notes' },
    ]
    const { container } = render(<ConversationPanel messages={[{ role: 'user', text: 'hi' }]} streamingContent="" isThinking={false} toolEvents={toolEvents} />)
    const tags = [...container.querySelectorAll('.tool-result .tool-tag')].map((t) => t.textContent)
    expect(tags).toEqual(['✕ FAILED', '✓ RESULT'])
  })
})
