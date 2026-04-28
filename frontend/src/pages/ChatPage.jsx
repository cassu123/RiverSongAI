import React, { useState, useCallback, useRef, useEffect } from 'react'
import ConversationPanel   from '../components/ConversationPanel.jsx'
import { useAuth }         from '../context/AuthContext.jsx'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import './ChatPage.css'

const API_BASE = import.meta.env.VITE_API_URL || ''
const MAX_HISTORY_SESSIONS = 30

function historyKey(userId) { return `rs-history:${userId}` }
function loadHistory(userId) {
  try { return JSON.parse(localStorage.getItem(historyKey(userId)) || '[]') } catch { return [] }
}
function saveHistory(userId, sessions) {
  try { localStorage.setItem(historyKey(userId), JSON.stringify(sessions.slice(-MAX_HISTORY_SESSIONS))) } catch {}
}
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ChatPage() {
  const { token, user } = useAuth()

  const [messages,          setMessages]          = useState([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [inputText,         setInputText]         = useState('')
  const [isThinking,        setIsThinking]        = useState(false)
  const [thinkingStart,     setThinkingStart]     = useState(null)
  const [error,             setError]             = useState(null)

  const [models,          setModels]          = useState({ cloud: [], local: [] })
  const [selectedModel,   setSelectedModel]   = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)

  const [history,        setHistory]        = useState([])
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  // Mic-to-text: transcribe then inject into input
  const [isTranscribing, setIsTranscribing] = useState(false)
  const inputRef       = useRef(null)
  const messagesRef    = useRef(messages)
  const tokenRef       = useRef(token)
  const userRef        = useRef(user)
  useEffect(() => { messagesRef.current    = messages },    [messages])
  useEffect(() => { tokenRef.current       = token },       [token])
  useEffect(() => { userRef.current        = user },        [user])

  // defined below — ref populated after extractFacts is declared
  const extractRef = useRef(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/models`)
      .then(r => r.json())
      .then(data => {
        setModels({
          cloud: (data.cloud || []).filter(m => m.available),
          local: (data.local || []).filter(m => m.available),
        })
      })
      .catch(() => {})

    if (user) {
      fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(s => setSelectedModel({ provider: s.provider, model_id: s.model }))
        .catch(() => {})

      setHistory(loadHistory(user.id))
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleModelChange = async (e) => {
    const [provider, model_id] = e.target.value.split('::')
    setSelectedModel({ provider, model_id })
    setSavingModel(true)
    try {
      await fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ provider, model_id, cloud_fallback_enabled: false }),
      })
    } catch {}
    setSavingModel(false)
  }

  const handleSend = useCallback(async () => {
    const t = inputText.trim()
    if (!t || isThinking) return
    setInputText('')
    setError(null)
    const next = [...messages, { role: 'user', text: t }]
    setMessages(next)
    setIsThinking(true)
    setThinkingStart(Date.now())
    setStreamingResponse('')

    try {
      const res = await fetch(`${API_BASE}/api/conversation/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: t,
          history: next.slice(-20).map(m => ({ role: m.role, content: m.text })),
          provider: selectedModel?.provider,
          model_id: selectedModel?.model_id,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Stream the response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let streamDone = false
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const piece = line.slice(6)
            if (piece === '[DONE]') { streamDone = true; break }
            full += piece
            setStreamingResponse(full)
          }
        }
      }
      setStreamingResponse('')
      setMessages(p => [...p, { role: 'assistant', text: full || '...' }])
    } catch (err) {
      setError('Failed to get a response. Check your connection.')
      setStreamingResponse('')
    } finally {
      setIsThinking(false)
      setThinkingStart(null)
    }
  }, [inputText, isThinking, messages, selectedModel, token])

  const handleKeyDown = useCallback(e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  const extractFacts = useCallback((msgs) => {
    if (!token || !msgs || msgs.length < 2) return
    fetch(`${API_BASE}/api/conversation/extract-facts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: msgs.map(m => ({ role: m.role, content: m.text })) }),
    }).catch(() => {})
  }, [token])

  // Keep ref current, register visibility + unmount triggers
  useEffect(() => { extractRef.current = extractFacts }, [extractFacts])
  useEffect(() => {
    const handleHide = () => {
      if (document.visibilityState === 'hidden') extractRef.current?.(messagesRef.current)
    }
    document.addEventListener('visibilitychange', handleHide)
    return () => {
      document.removeEventListener('visibilitychange', handleHide)
      extractRef.current?.(messagesRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleReset = useCallback(() => {
    if (messages.length > 0 && user) {
      const session = {
        id: Date.now(),
        date: new Date().toISOString(),
        model: selectedModel ? `${selectedModel.provider} / ${selectedModel.model_id}` : 'default',
        messages: [...messages],
      }
      const updated = [...loadHistory(user.id), session]
      saveHistory(user.id, updated)
      setHistory(updated)
      extractFacts(messages)
    }
    setMessages([])
    setStreamingResponse('')
    setError(null)
    setViewingSession(null)
  }, [messages, user, selectedModel, extractFacts])

  // Mic → transcribe → fill input
  const handleAudioComplete = useCallback(async (wavB64) => {
    setIsTranscribing(true)
    try {
      const res = await fetch(`${API_BASE}/api/conversation/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ audio: wavB64 }),
      })
      if (res.ok) {
        const { text } = await res.json()
        if (text) setInputText(p => p ? `${p} ${text}` : text)
      }
    } catch {}
    setIsTranscribing(false)
    inputRef.current?.focus()
  }, [token])

  const { startRecording, isRecording } = useAudioRecorder({ onComplete: handleAudioComplete })

  const handleMic = useCallback(async () => {
    if (isRecording || isTranscribing) return
    await startRecording()
  }, [isRecording, isTranscribing, startRecording])

  const modelValue = selectedModel ? `${selectedModel.provider}::${selectedModel.model_id}` : ''
  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse

  return (
    <div className="chat-page">

      {/* Top bar */}
      <div className="chat-top-bar">
        <div className="chat-top-left">
          <div className="chat-model-selector">
            <label className="chat-model-label">MODEL</label>
            <select
              className="chat-model-select"
              value={modelValue}
              onChange={handleModelChange}
              disabled={savingModel}
            >
              {models.cloud.length > 0 && (
                <optgroup label="☁ CLOUD">
                  {models.cloud.map(m => (
                    <option key={`${m.provider}::${m.model_id}`} value={`${m.provider}::${m.model_id}`}>
                      {m.display_name}
                    </option>
                  ))}
                </optgroup>
              )}
              {models.local.length > 0 && (
                <optgroup label="⬡ LOCAL">
                  {models.local.map(m => (
                    <option key={`${m.provider}::${m.model_id}`} value={`${m.provider}::${m.model_id}`}>
                      {m.display_name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {savingModel && <span className="chat-model-saving">saving...</span>}
          </div>
        </div>

        <div className="chat-top-right">
          {error && <span className="chat-error-inline">{error}</span>}
          <button
            className={`chat-icon-btn ${showHistory ? 'chat-icon-btn--on' : ''}`}
            onClick={() => { setShowHistory(h => !h); setViewingSession(null) }}
            title="Conversation history"
          >
            <HistoryIcon />
            {history.length > 0 && <span className="chat-history-count">{history.length}</span>}
          </button>
        </div>
      </div>

      {/* History panel */}
      {showHistory ? (
        <div className="chat-history-panel">
          {viewingSession ? (
            <>
              <div className="chat-history-session-header">
                <button className="chat-history-back" onClick={() => setViewingSession(null)}>← BACK</button>
                <span className="chat-history-session-meta">{fmtDate(viewingSession.date)} · {viewingSession.model}</span>
              </div>
              <ConversationPanel messages={viewingSession.messages} />
            </>
          ) : history.length === 0 ? (
            <div className="chat-history-empty">No saved sessions yet. Conversations save when you hit RESET.</div>
          ) : (
            <div className="chat-history-list">
              {[...history].reverse().map(s => (
                <button key={s.id} className="chat-history-item" onClick={() => setViewingSession(s)}>
                  <span className="chat-history-item-date">{fmtDate(s.date)}</span>
                  <span className="chat-history-item-model">{s.model}</span>
                  <span className="chat-history-item-count">{s.messages.length} msg</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <ConversationPanel messages={displayMessages} streamingResponse={displayStreaming} isThinking={isThinking && !viewingSession} thinkingStart={thinkingStart} />
      )}

      {/* Input bar */}
      <div className="chat-input-bar">
        <button
          className={`chat-mic-btn ${isRecording ? 'chat-mic-btn--active' : ''} ${isTranscribing ? 'chat-mic-btn--transcribing' : ''}`}
          onClick={handleMic}
          disabled={isTranscribing}
          title={isRecording ? 'Listening...' : isTranscribing ? 'Transcribing...' : 'Voice input'}
          aria-label="Voice input"
        >
          <MicIcon />
        </button>

        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            className="chat-text-input"
            placeholder="Message River Song..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isThinking || !!viewingSession}
            rows={1}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!inputText.trim() || isThinking || !!viewingSession}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>

        <button className="chat-reset-btn" onClick={handleReset} title="Save & reset">
          <ResetIcon />
        </button>
      </div>

      <div className="chat-disclaimer">
        AI can make mistakes — please verify important information.
        Running on local hardware; responses may be slower than cloud AI.
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <rect x="6" y="1" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="9" y1="15" x2="9" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="6" y1="17" x2="12" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M14 8 2 2l3 6-3 6 12-6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M2 8a6 6 0 1 0 1.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <polyline points="2,4 2,8 6,8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <polyline points="8,4 8,8 11,10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
