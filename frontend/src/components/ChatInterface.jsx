import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ConversationPanel   from './ConversationPanel.jsx'
import { useAuth }         from '../context/AuthContext.jsx'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import RateIndicator       from './RateIndicator.jsx'
import PresetSelector      from './PresetSelector.jsx'

/**
 * ChatInterface — Spatial Intelligence v2.0
 * -----------------------------------------------------------------------------
 * High-performance chat interface.
 * Implements 'Cockpit' density and 'Double-Bezel' message architecture.
 */

const API_BASE = import.meta.env.VITE_API_URL || ''
const MAX_HISTORY_SESSIONS = 30

function fmtCost(v) {
  if (v == null) return null
  return `$${(v * 1000000).toFixed(2)}/M`
}

/* ── Model picker micro-components ─────────────────────────────────────────── */
function MpopRow({ icon, title, sub, active, dimmed, chevron, badge, onClick }) {
  return (
    <button
      className={`rs-mpop-row${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
      onClick={onClick}
    >
      <span className="material-symbols-rounded rs-mpop-icon">{icon}</span>
      <span className="rs-mpop-body">
        <span className="rs-mpop-title">
          {title}
          {badge && <span className="rs-mpop-badge">{badge}</span>}
        </span>
        {sub && <span className="rs-mpop-sub">{sub}</span>}
      </span>
      {active  && <span className="material-symbols-rounded rs-mpop-check">check</span>}
      {chevron && !active && <span className="material-symbols-rounded rs-mpop-chevron">chevron_right</span>}
    </button>
  )
}

function MpopBack({ label, onClick }) {
  return (
    <button className="rs-mpop-back" onClick={onClick}>
      <span className="material-symbols-rounded">arrow_back</span>
      {label}
    </button>
  )
}

function historyKey(userId) { return `rs-history:${userId}` }
function loadHistory(userId) {
  try { return JSON.parse(localStorage.getItem(historyKey(userId)) || '[]') } catch { return [] }
}
function saveHistory(userId, sessions) {
  try { localStorage.setItem(historyKey(userId), JSON.stringify(sessions.slice(0, MAX_HISTORY_SESSIONS))) } catch {}
}
function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ChatInterface({ setAction, onNavigate, initialIntent, embedded, onClose }) {
  const { token, user } = useAuth()

  const [messages,          setMessages]          = useState([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [toolEvents,        setToolEvents]        = useState([])
  const [inputText,         setInputText]         = useState('')
  const [isThinking,        setIsThinking]        = useState(false)
  const [thinkingStart,     setThinkingStart]     = useState(null)
  const [error,             setError]             = useState(null)

  const [models,          setModels]          = useState({ cloud: [], local: [] })
  const [familyOverrides, setFamilyOverrides] = useState({})
  const [selectedModel,   setSelectedModel]   = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)

  const [history,        setHistory]        = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const [webSearch,        setWebSearch]        = useState(false)
  const [showSystem,       setShowSystem]       = useState(false)
  const [modelPickerOpen,  setModelPickerOpen]  = useState(false)
  const [pickerView,       setPickerView]       = useState('home')
  const [popoverPos,       setPopoverPos]       = useState({ bottom: 100, right: 20 })

  const [systemPrompt, setSystemPrompt] = useState('')
  const [forgetMemory, setForgetMemory] = useState(false)
  const [activeDocId, setActiveDocId] = useState(null)

  const inputRef = useRef(null)

  const [initialIntentHandled, setInitialIntentHandled] = useState(false)

  // -- Initialization --
  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/models`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        setModels({
          cloud: data.cloud || [],
          local: data.local || [],
        })
        setFamilyOverrides(data.family_overrides || {})
      })
      .catch(err => console.warn('[ChatInterface] models load failed:', err))

    if (user) {
      fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(s => setSelectedModel({ provider: s.provider, model_id: s.model }))
        .catch(err => console.warn('[ChatInterface] LLM settings load failed:', err))

      setHistory(loadHistory(user.id))
    }
  }, [user?.id, token])

  // -- Model Mapping --
  const localModels  = useMemo(() => models.local, [models.local])
  const nimModels    = useMemo(() => models.cloud.filter(m => m.provider === 'nvidia_nim'), [models.cloud])
  const cloudModels  = useMemo(() => models.cloud.filter(m => m.provider !== 'nvidia_nim'), [models.cloud])

  const hasNvidia    = nimModels.length > 0
  const hasCloud     = cloudModels.some(m => m.available)

  const closeModelPicker = () => { setModelPickerOpen(false); setPickerView('home') }

  const openModelPicker = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPopoverPos({
      bottom: window.innerHeight - rect.top + 8,
      right:  window.innerWidth  - rect.right,
    })
    setPickerView('home')
    setModelPickerOpen(true)
  }, [])

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return 'Model'
    if (selectedModel.provider === 'auto') return 'Auto'
    const all = [...models.local, ...models.cloud]
    const found = all.find(m => m.model_id === selectedModel.model_id && m.provider === selectedModel.provider)
    if (!found) return selectedModel.model_id?.split('/').pop() || 'Model'
    return found.display_name.replace(/\s*\([^)]+\)/g, '').trim()
  }, [selectedModel, models])

  const handleModelSelect = async (provider, model_id) => {
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

  // -- Actions --
  const handleSend = useCallback(async (overrideText, overrideDocId) => {
    const t = typeof overrideText === 'string' ? overrideText.trim() : inputText.trim()
    if (!t || isThinking) return
    if (typeof overrideText !== 'string') setInputText('')
    setError(null)
    const next = [...messages, { role: 'user', text: t }]
    setMessages(next)
    setIsThinking(true)
    setThinkingStart(Date.now())
    setStreamingResponse('')
    setToolEvents([])

    try {
      let endpoint = `${API_BASE}/api/conversation/chat`
      let body = {
        message: t,
        history: next.slice(-20).map(m => ({ role: m.role, content: m.text })),
        provider: selectedModel?.provider,
        model_id: selectedModel?.model_id,
        web_search: webSearch,
        forget_memory: forgetMemory,
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      }

      const currentDocId = overrideDocId !== undefined ? overrideDocId : activeDocId
      if (currentDocId) {
        endpoint = `${API_BASE}/api/rag/query`
        body = { doc_id: currentDocId, question: t }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

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
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const piece = line.slice(6)
            if (piece === '[DONE]') { streamDone = true; break }
            try {
              const evt = JSON.parse(piece)
              if (evt.type === 'text') {
                full += evt.content
                setStreamingResponse(full)
              } else if (evt.type === 'tool_use' || evt.type === 'tool_result') {
                setToolEvents(prev => [...prev, evt])
              } else if (evt.type === 'error') {
                setError(`Server Error: ${evt.content}`)
                streamDone = true; break
              }
            } catch {
              full += piece
              setStreamingResponse(full)
            }
          }
        }
      }
      setStreamingResponse('')
      const assistantMsg = { role: 'assistant', text: full || '...' }
      const updated = [...next, assistantMsg]
      setMessages(updated)
      
      // Update persistent history
      if (user) {
        setHistory(prev => {
          let newHistory = [...prev]
          const newSession = { id: currentSessionId || Date.now(), date: new Date().toISOString(), messages: updated }
          if (currentSessionId) {
            const idx = newHistory.findIndex(s => s.id === currentSessionId)
            if (idx !== -1) newHistory[idx] = newSession
            else newHistory = [newSession, ...newHistory]
          } else {
            newHistory = [newSession, ...newHistory]
            setCurrentSessionId(newSession.id)
          }
          saveHistory(user.id, newHistory)
          return newHistory
        })
      }
    } catch (err) {
      setError('Neural link severed. Retrying...')
      setStreamingResponse('')
    } finally {
      setIsThinking(false)
      setThinkingStart(null)
    }
  }, [inputText, isThinking, messages, selectedModel, token, webSearch, systemPrompt, activeDocId, forgetMemory, user, currentSessionId])

  useEffect(() => {
    if (initialIntent && !initialIntentHandled && token) {
      setInitialIntentHandled(true)
      setActiveDocId(initialIntent.docId)
      // Small delay to allow state to settle
      setTimeout(() => handleSend(initialIntent.text, initialIntent.docId), 50)
    }
  }, [initialIntent, initialIntentHandled, token, handleSend])

  const handleReset = useCallback(() => {
    setMessages([])
    setStreamingResponse('')
    setToolEvents([])
    setError(null)
    setViewingSession(null)
    setActiveDocId(null)
    setCurrentSessionId(null)
  }, [])

  const handleAudioComplete = useCallback(async (wavB64) => {
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
  }, [token])

  const { startRecording, stopRecording, isRecording } = useAudioRecorder({ onComplete: handleAudioComplete })

  // -- Bottom Action Slot --
  const ActionSlot = useMemo(() => (
    <div className="rs-chat-input-container">
      <textarea
        ref={inputRef}
        rows={1}
        className="rs-chat-textarea"
        style={{ fontSize: '1.05rem', fontWeight: 500 }}
        placeholder="Ask River Song..."
        value={inputText}
        onChange={e => setInputText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
        disabled={isThinking || !!viewingSession}
      />
      
      <div className="rs-chat-input-controls">
        <div className="rs-chat-input-left">
          <label className="rs-btn-ghost rs-icon-btn" title="Attach Sector Data">
            <span className="material-symbols-rounded">add</span>
            <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const docId = `doc_${Date.now()}`
                const fd = new FormData(); fd.append('file', file)
                try {
                  const res = await fetch(`${API_BASE}/api/rag/ingest?doc_id=${docId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
                  if (res.ok) { setActiveDocId(docId); setMessages(p => [...p, { role: 'system', text: `RESOURCE IDENTIFIED: ${file.name}` }]) }
                } catch { setError('Ingestion failed.') }
            }} />
          </label>
          
          <button className={`rs-pill ${webSearch ? 'is-active' : ''}`} onClick={() => setWebSearch(!webSearch)}>
            <span className="material-symbols-rounded">public</span>
            <span className="rs-speak-actions-label">SCAN WEB</span>
          </button>
        </div>

        <div className="rs-chat-input-right">
          <PresetSelector />
          <button className="rs-pill" onClick={openModelPicker}>
            <span className="material-symbols-rounded">
              {selectedModel?.provider === 'auto' ? 'auto_awesome' : selectedModel?.provider === 'nvidia_nim' ? 'memory_alt' : selectedModel?.provider === 'ollama' ? 'memory' : 'cloud'}
            </span>
            <span className="rs-speak-actions-label">{selectedModelLabel}</span>
          </button>

          <button className={`rs-pill ${isRecording ? 'is-active' : ''}`} onClick={() => isRecording ? stopRecording() : startRecording()} disabled={isThinking}>
            <span className="material-symbols-rounded">{isRecording ? 'stop' : 'mic'}</span>
          </button>

          <button className="rs-btn-primary rs-send-btn" onClick={() => handleSend()} disabled={!inputText.trim() || isThinking} style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>arrow_upward</span>
          </button>
        </div>
      </div>
    </div>
  ), [inputText, handleSend, isRecording, startRecording, stopRecording, isThinking, viewingSession, webSearch, selectedModel, selectedModelLabel, token, openModelPicker])

  useEffect(() => {
    if (!embedded && setAction) {
      setAction(ActionSlot)
      return () => { if (setAction) setAction(null) }
    }
  }, [ActionSlot, setAction, embedded])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse

  return (
    <div className={`rs-foyer ${embedded ? 'is-embedded' : ''}`} style={embedded ? { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } : {}}>
      
      {/* Dynamic Overlay Bar */}
      {embedded && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--primary)' }}>Vehicle Assistant</h3>
          <button className="rs-pill" onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
      )}
      {!embedded && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 20, alignItems: 'center' }}>
          <RateIndicator activeModel={selectedModel} token={token} />
          {savingModel && <span className="rs-card-label" style={{ color: 'var(--primary)', opacity: 1, marginRight: 12 }}>SYNCING…</span>}
          <button className="rs-pill" onClick={() => setShowSystem(!showSystem)}>
            <span className="material-symbols-rounded">settings_input_component</span>
          </button>
          <button className={`rs-pill ${showHistory ? 'is-active' : ''}`} onClick={() => setShowHistory(!showHistory)}>
            <span className="material-symbols-rounded">history</span>
          </button>
          <button className="rs-pill" onClick={handleReset} title="Clear Session">
            <span className="material-symbols-rounded">refresh</span>
          </button>
        </div>
      )}

      {showSystem && (
        <div className="rs-card is-elev animate-fade-in" style={{ marginBottom: 24 }}>
          <div className="rs-card-inner">
            <div className="rs-card-label">System Directives</div>
            <textarea
              style={{ all: 'unset', width: '100%', marginTop: 12, fontSize: '0.92rem', minHeight: '80px', color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}
              placeholder="Inject custom neural constraints..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
            />
          </div>
        </div>
      )}

      {showHistory ? (
        <div className="rs-card-flow">
          {history.length === 0 ? (
            <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center' }}>Neural archives empty.</div>
          ) : (
            history.map(s => (
              <div key={s.id} className="rs-card is-tappable is-wide animate-page-in" onClick={() => { setViewingSession(s); setShowHistory(false) }}>
                <div className="rs-card-inner">
                  <div className="rs-card-head">
                    <span className="rs-card-label">{fmtDate(s.date)}</span>
                    <span className="rs-card-label" style={{ background: 'var(--primary)', color: 'var(--bg-base)', padding: '2px 8px', borderRadius: 4 }}>{s.messages.length} MSG</span>
                  </div>
                  <div className="rs-card-value" style={{ fontSize: '1.1rem', opacity: 0.9 }}>{s.messages[0]?.text || 'Voice interaction'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rs-thread" style={{ paddingBottom: embedded ? '20px' : '120px', flex: 1, overflowY: 'auto' }}>
          {viewingSession && (
            <div style={{ marginBottom: 24 }}>
              <button className="rs-pill is-active" onClick={() => setViewingSession(null)}>
                 <span className="material-symbols-rounded">live_tv</span>
                 RETURN TO LIVE STREAM
              </button>
            </div>
          )}
          {error && (
            <div className="rs-error-banner animate-fade-in" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', marginBottom: 16, borderRadius: 10,
              background: 'rgba(220,60,60,0.15)', border: '1px solid rgba(220,60,60,0.3)',
              color: '#f08080', fontSize: '0.9rem',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.2rem' }}>error</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError(null)} style={{ all: 'unset', cursor: 'pointer', opacity: 0.7 }}>
                <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>close</span>
              </button>
            </div>
          )}
          <ConversationPanel
            messages={displayMessages}
            streamingContent={displayStreaming}
            isThinking={isThinking && !viewingSession}
            thinkingStart={thinkingStart}
            toolEvents={toolEvents}
            onNavigate={onNavigate}
          />
        </div>
      )}

      {/* Model picker — floating popover near the button */}
      {modelPickerOpen && (
        <>
          {/* Click-outside dismissal */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={closeModelPicker} />

          <div className="rs-mpop" style={{ bottom: popoverPos.bottom, right: popoverPos.right }}>

            {/* HOME */}
            {pickerView === 'home' && <>
              <MpopRow icon="auto_awesome" title="River Decides" sub="Auto-routes to the best model" active={selectedModel?.provider === 'auto'} onClick={() => { closeModelPicker(); handleModelSelect('auto', 'auto') }} />
              <MpopRow icon="memory" title="Local" sub={localModels.filter(m => m.available).length > 0 ? `${localModels.filter(m => m.available).length} ready · Ollama` : 'No models installed'} active={selectedModel?.provider === 'ollama'} chevron onClick={() => setPickerView('local')} />
              {hasNvidia && <MpopRow icon="memory_alt" title="NVIDIA NIM" sub="Free cloud inference" active={selectedModel?.provider === 'nvidia_nim'} chevron onClick={() => setPickerView('nvidia')} />}
              {hasCloud  && <MpopRow icon="cloud" title="Cloud" sub="Claude · Gemini · GPT" active={!!selectedModel && !['auto','ollama','nvidia_nim'].includes(selectedModel.provider)} chevron onClick={() => setPickerView('cloud')} />}
            </>}

            {/* LOCAL */}
            {pickerView === 'local' && <>
              <MpopBack label="Local Models" onClick={() => setPickerView('home')} />
              {localModels.length === 0
                ? <p className="rs-mpop-empty">Pull a model via Ollama first.</p>
                : localModels.map(m => <MpopRow key={m.model_id} icon="memory" title={m.display_name} sub={m.notes || (m.vram_gb ? `${m.vram_gb} GB VRAM` : m.model_id)} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'ollama'} dimmed={!m.available} onClick={() => { closeModelPicker(); handleModelSelect('ollama', m.model_id) }} />)
              }
            </>}

            {/* NVIDIA */}
            {pickerView === 'nvidia' && <>
              <MpopBack label="NVIDIA NIM" onClick={() => setPickerView('home')} />
              {nimModels.map(m => <MpopRow key={m.model_id} icon="memory_alt" title={m.display_name} sub={m.available ? (m.notes || 'Free · NIM') : 'Enable NIM in .env'} badge={m.available ? 'FREE' : null} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === 'nvidia_nim'} dimmed={!m.available} onClick={() => { closeModelPicker(); handleModelSelect('nvidia_nim', m.model_id) }} />)}
            </>}

            {/* CLOUD */}
            {pickerView === 'cloud' && <>
              <MpopBack label="Cloud Providers" onClick={() => setPickerView('home')} />
              {cloudModels.map(m => <MpopRow key={`${m.provider}::${m.model_id}`} icon="cloud" title={m.display_name} sub={m.available ? (m.cost_per_1k_input_usd != null ? fmtCost(m.cost_per_1k_input_usd) : m.provider) : 'Enable in admin settings'} active={selectedModel?.model_id === m.model_id && selectedModel?.provider === m.provider} dimmed={!m.available} onClick={() => { closeModelPicker(); handleModelSelect(m.provider, m.model_id) }} />)}
            </>}

          </div>
        </>
      )}

      {embedded && (
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          {ActionSlot}
        </div>
      )}
    </div>
  )
}
