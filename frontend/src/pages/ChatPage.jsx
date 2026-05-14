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
  const [toolEvents,        setToolEvents]        = useState([])
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

  // Aggregator features
  const [modelOpen, setModelOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [thinkingMode, setThinkingMode] = useState(false)
  const [showSystem, setShowSystem] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [enhancing, setEnhancing] = useState(false)
  const [forgetMemory, setForgetMemory] = useState(false)

  const modelDropRef = useRef(null)

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

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (modelDropRef.current && !modelDropRef.current.contains(e.target)) {
        setModelOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

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

  const handleModelSelect = async (provider, model_id) => {
    setSelectedModel({ provider, model_id })
    setModelOpen(false)
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
    setToolEvents([])

    try {
      const res = await fetch(`${API_BASE}/api/conversation/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: t,
          history: next.slice(-20).map(m => ({ role: m.role, content: m.text })),
          provider: selectedModel?.provider,
          model_id: selectedModel?.model_id,
          web_search: webSearch,
          thinking_mode: thinkingMode,
          forget_memory: forgetMemory,
          ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Stream the response
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let full = ''
      let streamDone = false
      let buffer = ''

      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break
        
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // Keep the last partial line in the buffer
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const piece = line.slice(6)
            if (piece === '[DONE]') { 
              streamDone = true
              break 
            }
            try {
              // Now that we JSON-encode on the server, we must parse here
              const evt = JSON.parse(piece)
              if (evt.type === 'text') {
                full += evt.content
                setStreamingResponse(full)
              } else if (evt.type === 'tool_use' || evt.type === 'tool_result') {
                setToolEvents(prev => [...prev, evt])
              } else if (evt.type === 'error') {
                setError(`Server Error: ${evt.content || 'An unknown error occurred'}`)
                streamDone = true; break
              }
            } catch (e) {
              // Fallback for non-JSON or partial chunks
              full += piece
              setStreamingResponse(full)
            }
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
  }, [inputText, isThinking, messages, selectedModel, token, webSearch, thinkingMode, systemPrompt])

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
    setForgetMemory(true)
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

  const handleExport = () => {
    const lines = ['# River Song — Chat Export', `*${new Date().toLocaleString()}*`, '']
    messages.forEach(m => {
      lines.push(`**${m.role === 'user' ? 'You' : 'River Song'}:** ${m.text}`)
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `river-song-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleEnhance = useCallback(async () => {
    if (!inputText.trim() || enhancing) return
    setEnhancing(true)
    try {
      const res = await fetch(`${API_BASE}/api/conversation/enhance-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: inputText.trim() }),
      })
      if (res.ok) {
        const { enhanced } = await res.json()
        if (enhanced) setInputText(enhanced)
      }
    } catch {} finally { setEnhancing(false) }
  }, [inputText, enhancing, token])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse

  const isCloud = selectedModel && ['anthropic', 'openai', 'google'].includes(selectedModel.provider)
  const currentModelName = selectedModel ? (
    [...models.cloud, ...models.local].find(m => m.model_id === selectedModel.model_id)?.display_name || selectedModel.model_id
  ) : 'SELECT MODEL'

  return (
    <div className="chat-page">

      {/* Top bar */}
      <div className="chat-top-bar">
        <div className="chat-top-left">
          <div className="chat-model-pill-wrap" ref={modelDropRef}>
            <button 
              className="chat-model-pill" 
              onClick={() => setModelOpen(!modelOpen)}
              disabled={savingModel}
            >
              {currentModelName}
              {savingModel ? (
                <span className="chat-model-badge">…</span>
              ) : (
                <span className="chat-model-badge">{isCloud ? '☁' : '⬡'}</span>
              )}
            </button>

            {modelOpen && (
              <div className="chat-model-dropdown">
                {models.cloud.length > 0 && (
                  <div className="chat-model-group">
                    <div className="chat-model-group-label">☁ Cloud</div>
                    {models.cloud.map(m => (
                      <button
                        key={`${m.provider}::${m.model_id}`}
                        className={`chat-model-option ${selectedModel?.model_id === m.model_id ? 'chat-model-option--active' : ''}`}
                        onClick={() => handleModelSelect(m.provider, m.model_id)}
                      >
                        {m.display_name}
                      </button>
                    ))}
                  </div>
                )}
                {models.local.length > 0 && (
                  <div className="chat-model-group">
                    <div className="chat-model-group-label">⬡ Local</div>
                    {models.local.map(m => (
                      <button
                        key={`${m.provider}::${m.model_id}`}
                        className={`chat-model-option ${selectedModel?.model_id === m.model_id ? 'chat-model-option--active' : ''}`}
                        onClick={() => handleModelSelect(m.provider, m.model_id)}
                      >
                        {m.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="chat-top-right">
          {error && <span className="chat-error-inline">{error}</span>}
          
          <button className="chat-icon-btn" onClick={handleExport} disabled={messages.length === 0} title="Export chat">
            <ExportIcon />
          </button>

          <button className="chat-icon-btn" onClick={() => setShowSystem(!showSystem)} title="System prompt">
            <SystemIcon />
          </button>

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

      {showSystem && (
        <div className="chat-system-panel">
          <div className="chat-system-label">SYSTEM PROMPT</div>
          <textarea 
            className="chat-system-input" 
            rows={3} 
            placeholder="Define River Song's behaviour for this session..." 
            value={systemPrompt} 
            onChange={e => setSystemPrompt(e.target.value)} 
          />
          <div className="chat-system-footer">
            <span>{systemPrompt.length} characters</span>
            <button className="chat-system-clear" onClick={() => setSystemPrompt('')}>CLEAR</button>
          </div>
        </div>
      )}

      <div className="chat-feature-row">
        <button 
          className={`chat-feature-chip ${webSearch ? 'chat-feature-chip--on' : ''}`} 
          onClick={() => setWebSearch(w => !w)}
        >
          <WebIcon /> WEB
        </button>
        <button 
          className={`chat-feature-chip ${thinkingMode ? 'chat-feature-chip--on' : ''}`} 
          onClick={() => setThinkingMode(t => !t)}
        >
          <ThinkIcon /> THINK
        </button>
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
        <ConversationPanel 
          messages={displayMessages} 
          streamingContent={displayStreaming} 
          isThinking={isThinking && !viewingSession} 
          thinkingStart={thinkingStart}
          toolEvents={toolEvents}
        />
      )}

      {/* Input bar */}
      <div className="chat-input-bar">
        <div className="chat-input-row">
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
              className={`chat-enhance-btn ${enhancing ? 'chat-enhance-btn--busy' : ''}`}
              onClick={handleEnhance}
              disabled={inputText.trim().length < 10 || enhancing || isThinking}
              title="Enhance prompt"
            >
              <SparkleIcon />
            </button>

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
          {forgetMemory && (
            <div className="chat-memory-muted-badge animate-fade-in" title="Memory is not being injected into this session. Refresh to re-enable.">
               MEMORY MUTED
            </div>
          )}
        </div>

        {inputText.length > 0 && (
          <div className="chat-token-count">
            {Math.ceil(inputText.length / 4)} tokens
          </div>
        )}
      </div>

      <div className="chat-disclaimer">
        AI can make mistakes — please verify important information.
        Running on local hardware; responses may be slower than cloud AI.
      </div>
    </div>
  )
}

function WebIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
      <ellipse cx="8" cy="8" rx="3" ry="6.5" stroke="currentColor" strokeWidth="1.3"/>
      <ellipse cx="8" cy="8" rx="6.5" ry="3" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="8" y1="1.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function ThinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M9.5 1.5L4 9H8L6.5 14.5L12 7H8L9.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="5" cy="4" r="1.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="11" cy="8" r="1.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="7" cy="12" r="1.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 13H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 2C8 2 8.5 6 12 8C8.5 10 8 14 8 14C8 14 7.5 10 4 8C7.5 6 8 2 8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
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
