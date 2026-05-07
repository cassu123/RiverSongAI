import React, { useEffect, useRef, useState } from 'react'
import './ConversationPanel.css'

function ThinkingBubble({ startTime }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(((Date.now() - startTime) / 1000).toFixed(1))
    }, 100)
    return () => clearInterval(id)
  }, [startTime])

  return (
    <div className="chat-row chat-row--assistant">
      <div className="chat-avatar chat-avatar--rs chat-avatar--thinking" aria-hidden="true">RS</div>
      <div className="chat-bubble chat-bubble--assistant chat-bubble--thinking-block">
        <div className="thinking-header">
          <span className="thinking-label">CHAIN OF THOUGHT</span>
          <span className="thinking-timer">{elapsed}s</span>
        </div>
        <div className="thinking-scan-track">
          <div className="thinking-scan-bar" />
        </div>
        <div className="thinking-status">
          <span className="thinking-dot-pulse" />
          PROCESSING QUERY
        </div>
      </div>
    </div>
  )
}

export default function ConversationPanel({ messages, streamingContent, isThinking, thinkingStart }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, isThinking])

  if (messages.length === 0 && !streamingContent && !isThinking) {
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

        {/* Chain of thought thinking display */}
        {isThinking && !streamingContent && thinkingStart && (
          <ThinkingBubble startTime={thinkingStart} />
        )}

        {/* Streaming assistant response */}
        {streamingContent && (
          <div className="chat-row chat-row--assistant">
            <div className="chat-avatar chat-avatar--rs" aria-hidden="true">RS</div>
            <div className="chat-bubble chat-bubble--assistant chat-bubble--streaming">
              <p className="chat-bubble-text">
                {streamingContent}
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
