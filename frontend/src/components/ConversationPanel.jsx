import React, { useEffect, useRef } from 'react'
import './ConversationPanel.css'

export default function ConversationPanel({ messages, streamingResponse, isThinking }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingResponse])

  if (messages.length === 0 && !streamingResponse && !isThinking) {
    return (
      <div className="chat-panel chat-panel--empty">
        <div className="chat-empty-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M4 6h24v16H18l-4 4v-4H4V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <line x1="9" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="9" y1="16" x2="18" y2="16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="chat-empty-text">Start a conversation</p>
        <p className="chat-empty-sub">Type below or press the mic to speak</p>
      </div>
    )
  }

  return (
    <div className="chat-panel" aria-label="Conversation">
      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-row chat-row--${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar chat-avatar--rs" aria-hidden="true">RS</div>
            )}
            <div className={`chat-bubble chat-bubble--${msg.role}`}>
              <p className="chat-bubble-text">{msg.text}</p>
            </div>
            {msg.role === 'user' && (
              <div className="chat-avatar chat-avatar--user" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M1.5 12.5c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </div>
            )}
          </div>
        ))}

        {/* Thinking dots — shown while waiting for first token */}
        {isThinking && !streamingResponse && (
          <div className="chat-row chat-row--assistant">
            <div className="chat-avatar chat-avatar--rs" aria-hidden="true">RS</div>
            <div className="chat-bubble chat-bubble--assistant chat-bubble--thinking">
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
              <span className="chat-thinking-dot" />
            </div>
          </div>
        )}

        {/* Streaming assistant response */}
        {streamingResponse && (
          <div className="chat-row chat-row--assistant">
            <div className="chat-avatar chat-avatar--rs" aria-hidden="true">RS</div>
            <div className="chat-bubble chat-bubble--assistant chat-bubble--streaming">
              <p className="chat-bubble-text">
                {streamingResponse}
                <span className="chat-cursor" aria-hidden="true" />
              </p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
