import React, { useEffect, useRef, useState } from 'react'
import RsMarkdown from './RsMarkdown.jsx'
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

export default function ConversationPanel({ messages, streamingContent, isThinking, thinkingStart, toolEvents = [], onNavigate }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, isThinking, toolEvents])

  if (!messages || (messages.length === 0 && !streamingContent && !isThinking && (toolEvents || []).length === 0)) {
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
        {(messages || []).map((msg, idx) => (
          <div key={idx} className={`chat-row chat-row--${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat-avatar chat-avatar--rs" aria-hidden="true">RS</div>
            )}
            <div className={`chat-bubble chat-bubble--${msg.role}`}>
              {msg.text && (
                msg.role === 'assistant'
                  ? <div className="chat-bubble-text"><RsMarkdown onNavigate={onNavigate}>{msg.text}</RsMarkdown></div>
                  : <p className="chat-bubble-text">{msg.text}</p>
              )}
              {msg.image && (
                <div className="chat-image-wrap">
                  <img src={msg.image} alt="Generated" className="chat-bubble-image" />
                  <a href={msg.image} download={`river-song-${Date.now()}.png`} className="chat-image-download">
                    <span className="material-symbols-rounded">download</span>
                  </a>
                </div>
              )}
              {msg.meta && msg.meta.receipts && msg.meta.receipts.length > 0 && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elev)', borderRadius: 8, border: '1px solid var(--md-outline-variant)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
                    Agent Tasks Completed
                  </div>
                  {msg.meta.receipts.map((rcpt, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < msg.meta.receipts.length - 1 ? 6 : 0 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: rcpt.ok ? '#4CAF50' : '#dc3c3c' }}>
                        {rcpt.ok ? 'check_circle' : 'error'}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{rcpt.tool}</span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{rcpt.summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {msg.chunks && msg.chunks.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--md-outline-variant)', paddingTop: 8 }}>
                  {msg.chunks.map((chunk, i) => (
                    <span key={i} className="rs-pill" style={{ fontSize: '0.65rem', padding: '2px 8px', opacity: 0.8 }} title={chunk.text}>
                      SOURCE: {chunk.source?.toUpperCase() || 'DOCUMENT'}
                    </span>
                  ))}
                </div>
              )}
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

        {/* Tool events */}
        {(toolEvents || []).map((evt, idx) => (
          <div key={`tool-${idx}`} className="chat-row chat-row--assistant chat-row--tool">
            <div className="chat-avatar chat-avatar--rs chat-avatar--tool" aria-hidden="true">
              <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>build</span>
            </div>
            <div className="chat-tool-event animate-slide-up">
              {evt.type === 'tool_use' ? (
                <div className="tool-call">
                  <span className="tool-tag">TOOL CALL</span>
                  <span className="tool-name">{evt.tool}</span>
                  {evt.input && <pre className="tool-input">{JSON.stringify(evt.input)}</pre>}
                </div>
              ) : (
                <div className="tool-result">
                  <span className="tool-tag tool-tag--done">✓ RESULT</span>
                  <span className="tool-name">{evt.tool}</span>
                </div>
              )}
            </div>
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
              <div className="chat-bubble-text">
                <RsMarkdown onNavigate={onNavigate}>{streamingContent}</RsMarkdown>
                <span className="chat-cursor" aria-hidden="true" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}
