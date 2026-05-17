import React, { useState } from 'react'
import EnvIcon from './EnvIcon.jsx'

/** Workshop mode — Chat. Empty state -> active conversation. */
export default function PreviewChat({ displayName = 'Cheryl' }) {
  const [thread, setThread] = useState([])
  const [draft, setDraft]   = useState('')
  const [think, setThink]   = useState(false)
  const [search, setSearch] = useState(false)

  function send() {
    if (!draft.trim()) return
    const user = { role: 'user', text: draft.trim() }
    setThread(t => [...t, user])
    setDraft('')
    // Mock River reply
    setTimeout(() => {
      setThread(t => [...t, {
        role: 'river',
        text: `Heard. ${think ? '(thinking deeply)' : ''}${search ? ' (searched the web)' : ''}`.trim(),
      }])
    }, 350)
  }

  if (thread.length === 0) {
    return (
      <div className="rs-chat-empty">
        <h1 className="rs-greeting">Good evening, {displayName}.</h1>
        <p className="rs-greeting-sub">What do you need?</p>
      </div>
    )
  }

  return (
    <div className="rs-thread">
      {thread.map((m, i) => (
        <div key={i} className={`rs-msg ${m.role === 'user' ? 'is-user' : ''}`}>
          {m.role === 'river' && <span className="rs-orb rs-msg-orb" aria-hidden="true" />}
          <div className="rs-msg-card">{m.text}</div>
        </div>
      ))}
    </div>
  )
}

/** Chat input bar — two rows. Lives in shell Zone 3. */
export function ChatInputBar({
  draft, onDraft,
  think, onToggleThink,
  search, onToggleSearch,
  onOpenAttach, onOpenModel,
  modelLabel, onSend,
}) {
  return (
    <div className="rs-input">
      <textarea
        value={draft}
        onChange={e => onDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
        rows={1}
        placeholder="Ask River Song..."
      />
      <div className="rs-input-row2">
        <div className="rs-input-row2-l">
          <button className="rs-pill" onClick={onOpenAttach} aria-label="Attach">
            <EnvIcon name="add" style={{ fontSize: 16 }} />
          </button>
          <button
            className={`rs-pill ${think ? 'is-active' : ''}`}
            onClick={onToggleThink}
            aria-pressed={think}
          >
            <EnvIcon name="think" style={{ fontSize: 14 }} />
            Think
          </button>
          <button
            className={`rs-pill ${search ? 'is-active' : ''}`}
            onClick={onToggleSearch}
            aria-pressed={search}
          >
            <EnvIcon name="search" style={{ fontSize: 14 }} />
            Search
          </button>
        </div>
        <div className="rs-input-row2-r">
          <button className="rs-pill" onClick={onOpenModel}>
            {modelLabel}
          </button>
          <button className="rs-pill" aria-label="Voice">
            <EnvIcon name="mic" style={{ fontSize: 16 }} />
          </button>
        </div>
      </div>
    </div>
  )
}
