// =============================================================================
// src/components/ConversationPanel.jsx
//
// Scrollable conversation history panel.
//
// Displays the accumulated transcript of the current session. User messages
// appear in a dimmer blue, River Song responses in the primary Halo blue.
// Auto-scrolls to the latest message after each update.
//
// Props:
//   messages {Array<{role: 'user'|'assistant', text: string}>}
// =============================================================================

import React, { useEffect, useRef } from 'react'

export default function ConversationPanel({ messages }) {
  const bottomRef = useRef(null)

  // Scroll to the bottom whenever a new message is added
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <aside className="conversation-panel conversation-panel--empty">
        <p className="empty-label">Conversation will appear here.</p>
      </aside>
    )
  }

  return (
    <aside className="conversation-panel" aria-label="Conversation history">
      <h2 className="panel-title">CONVERSATION</h2>
      <div className="messages" role="log" aria-live="polite">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`message message--${msg.role}`}
          >
            <span className="message-role">
              {msg.role === 'user' ? 'YOU' : 'RIVER SONG'}
            </span>
            <p className="message-text">{msg.text}</p>
          </div>
        ))}
        {/* Invisible anchor for auto-scroll */}
        <div ref={bottomRef} />
      </div>
    </aside>
  )
}
