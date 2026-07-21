import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ConversationPanel   from './ConversationPanel.jsx'
import { useAuth }         from '../context/AuthContext.jsx'
import RateIndicator       from './RateIndicator.jsx'
import PresetSelector      from './PresetSelector.jsx'
import ModelPickerPopover  from './ModelPickerPopover.jsx'
import { useConversation } from '../hooks/useConversation.js'
import { API_BASE } from '../utils/useApi.js'

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ChatInterface({ setAction, onNavigate, initialIntent, embedded, onClose, vehicleId }) {
  const { token, user } = useAuth()

  const [models,          setModels]          = useState({ cloud: [], local: [] })
  const [selectedModel,   setSelectedModel]   = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)

  const [historySessions, setHistorySessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showHistory,     setShowHistory]     = useState(false)
  const [viewingSession,  setViewingSession]  = useState(null)

  const [webSearch,        setWebSearch]        = useState(false)
  const [deepResearch,     setDeepResearch]     = useState(false)
  const [showSystem,       setShowSystem]       = useState(false)
  const [modelPickerOpen,  setModelPickerOpen]  = useState(false)
  const [popoverPos,       setPopoverPos]       = useState({ bottom: 100, right: 20 })

  const [systemPrompt, setSystemPrompt] = useState('')
  const [forgetMemory, setForgetMemory] = useState(false)
  const [activeDocId, setActiveDocId] = useState(null)

  const [inputText,        setInputText]        = useState('')
  const inputRef = useRef(null)

  const [voiceToggle, setVoiceToggle] = useState('auto') // 'auto', 'always', 'never'

  const extraQueryParams = useMemo(() => {
    const q = {};
    if (vehicleId) q.vehicle_id = vehicleId;
    return q;
  }, [vehicleId]);

  // Initialize Session Hook
  const {
    convState,
    messages,
    streamingContent,
    toolEvents,
    error,
    setError,
    isRecording,
    startRecording,
    stopRecording,
    sendText,
    resetSession,
    abortGeneration,
    sendMessage,
    setMessages
  } = useConversation({ 
    token, 
    user, 
    sessionId: currentSessionId, 
    extraQueryParams,
    onSessionId: (id) => {
      if (currentSessionId !== id) {
        setCurrentSessionId(id)
        // Refresh session list
        if (token) {
          const url = new URL(`${API_BASE}/api/chat/sessions`)
          if (vehicleId) url.searchParams.append('scope', `vehicle:${vehicleId}`)
          fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json())
            .then(data => {
              if (data.sessions) setHistorySessions(data.sessions)
            })
            .catch(() => {})
        }
      }
    }
  })

  const isThinking = convState === 'thinking' || convState === 'speaking' || streamingContent !== ''

  // Load Models & History
  useEffect(() => {
    if (!token) return
    fetch(`${API_BASE}/api/models`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setModels({ cloud: data.cloud || [], local: data.local || [] })
      })
      .catch(() => {})

    if (user) {
      fetch(`${API_BASE}/api/settings/llm?user_id=${user.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(s => setSelectedModel({ provider: s.provider, model_id: s.model }))
        .catch(() => {})
        
      const url = new URL(`${API_BASE}/api/chat/sessions`)
      if (vehicleId) {
        url.searchParams.append('scope', `vehicle:${vehicleId}`)
      }
      fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
            if (data.sessions) {
                setHistorySessions(data.sessions)
            }
        })
        .catch(() => {})

      fetch(`${API_BASE}/api/settings`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
            if (data.voice_toggle) setVoiceToggle(data.voice_toggle)
        })
        .catch(() => {})
    }
  }, [user?.id, token])

  const localModels  = useMemo(() => models.local, [models.local])
  const nimModels    = useMemo(() => models.cloud.filter(m => m.provider === 'nvidia_nim'), [models.cloud])
  const cloudModels  = useMemo(() => models.cloud.filter(m => m.provider !== 'nvidia_nim'), [models.cloud])
  const hasNvidia    = nimModels.length > 0
  const hasCloud     = cloudModels.some(m => m.available)

  const closeModelPicker = () => { setModelPickerOpen(false) }
  const openModelPicker = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPopoverPos({
      bottom: window.innerHeight - rect.top + 8,
      right:  window.innerWidth  - rect.right,
    })
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

  const handleSend = useCallback((overrideText, overrideDocId) => {
    const t = typeof overrideText === 'string' ? overrideText.trim() : inputText.trim()
    if (!t || isThinking) return
    if (typeof overrideText !== 'string') setInputText('')
    setError(null)
    setViewingSession(null)
    
    // Deep Research
    const currentDocId = overrideDocId !== undefined ? overrideDocId : activeDocId
    if (deepResearch && !currentDocId) {
      setMessages(p => [...p, { role: 'user', text: t }])
      fetch(`${API_BASE}/api/research/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: t }),
      }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      }).then(data => {
        let full = data.report || 'No report produced.'
        if (data.sources?.length) full += `\n\n---\n_${data.sources.length} source${data.sources.length === 1 ? '' : 's'} · saved to Docs_`
        setMessages(p => [...p, { role: 'assistant', text: full }])
      }).catch(err => {
        setError(err.message)
      })
      return
    }

    let speakOverride = null
    if (voiceToggle === 'always') speakOverride = true
    if (voiceToggle === 'never') speakOverride = false

    sendText(t, { 
      provider: selectedModel?.provider,
      model_id: selectedModel?.model_id,
      web_search: webSearch,
      forget_memory: forgetMemory,
      system_prompt: systemPrompt.trim() ? systemPrompt.trim() : undefined,
      doc_id: currentDocId,
      speak: speakOverride
    })
  }, [inputText, isThinking, sendText, selectedModel, webSearch, forgetMemory, systemPrompt, activeDocId, deepResearch, voiceToggle, setMessages, token, setError])

  const handleReset = useCallback(() => {
    resetSession()
    setCurrentSessionId(null)
    setViewingSession(null)
    setActiveDocId(null)
  }, [resetSession])

  const loadSession = useCallback((sessionId) => {
    setCurrentSessionId(sessionId)
    sendMessage({ type: 'attach', session_id: sessionId })
    fetch(`${API_BASE}/api/chat/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(s => {
        setMessages(s.messages || [])
        setViewingSession(null)
        setShowHistory(false)
      })
      .catch(() => setError('Failed to load session'))
  }, [sendMessage, token, setMessages, setError])

  const toggleVoiceMode = useCallback(() => {
      setVoiceToggle(prev => {
          let next = 'auto'
          if (prev === 'auto') next = 'always'
          if (prev === 'always') next = 'never'
          
          fetch(`${API_BASE}/api/settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ music_provider: 'youtube_music', voice_toggle: next })
          }).catch(() => {})

          return next
      })
  }, [token])

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

          <button className={`rs-pill ${deepResearch ? 'is-active' : ''}`} onClick={() => setDeepResearch(!deepResearch)} title="Deep Research">
            <span className="material-symbols-rounded">travel_explore</span>
            <span className="rs-speak-actions-label">RESEARCH</span>
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

          <button className="rs-pill" onClick={toggleVoiceMode} title="Voice Output Mode">
             <span className="material-symbols-rounded">
                 {voiceToggle === 'auto' ? 'volume_up' : voiceToggle === 'always' ? 'record_voice_over' : 'volume_off'}
             </span>
             <span className="rs-speak-actions-label">
                 {voiceToggle === 'auto' ? 'AUTO' : voiceToggle === 'always' ? 'ALWAYS' : 'NEVER'}
             </span>
          </button>

          <button className={`rs-pill ${isRecording ? 'is-active' : ''}`} onClick={() => isRecording ? stopRecording() : startRecording()} disabled={isThinking}>
            <span className="material-symbols-rounded">{isRecording ? 'stop' : 'mic'}</span>
          </button>

          {isThinking ? (
            <button className="rs-btn-primary rs-send-btn rs-stop-btn" onClick={abortGeneration} title="Stop generating" style={{ background: '#dc3c3c', color: '#fff' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>stop</span>
            </button>
          ) : (
            <button className="rs-btn-primary rs-send-btn" onClick={() => handleSend()} disabled={!inputText.trim()} style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>arrow_upward</span>
            </button>
          )}
        </div>
      </div>
    </div>
  ), [inputText, handleSend, abortGeneration, isRecording, startRecording, stopRecording, isThinking, viewingSession, webSearch, deepResearch, selectedModel, selectedModelLabel, token, openModelPicker, voiceToggle, toggleVoiceMode])

  useEffect(() => {
    if (!embedded && setAction) {
      setAction(ActionSlot)
      return () => { if (setAction) setAction(null) }
    }
  }, [ActionSlot, setAction, embedded])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingContent

  return (
    <div className={`rs-foyer ${embedded ? 'is-embedded' : ''}`} style={embedded ? { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' } : {}}>
      
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
          {historySessions.length === 0 ? (
            <div className="rs-card-meta" style={{ padding: 48, textAlign: 'center' }}>Neural archives empty.</div>
          ) : (
            historySessions.map(s => (
              <div key={s.id} className="rs-card is-tappable is-wide animate-page-in" onClick={() => loadSession(s.id)}>
                <div className="rs-card-inner">
                  <div className="rs-card-head">
                    <span className="rs-card-label">{fmtDate(s.updated_at)}</span>
                    <span className="rs-card-label" style={{ background: 'var(--primary)', color: 'var(--bg-base)', padding: '2px 8px', borderRadius: 4 }}>{s.title}</span>
                  </div>
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
            toolEvents={toolEvents}
            onNavigate={onNavigate}
          />
        </div>
      )}

      <ModelPickerPopover
        isOpen={modelPickerOpen}
        onClose={closeModelPicker}
        pos={popoverPos}
        selectedModel={selectedModel}
        onSelect={(p, m) => { handleModelSelect(p, m); closeModelPicker(); }}
        localModels={localModels}
        nimModels={nimModels}
        cloudModels={cloudModels}
        hasNvidia={hasNvidia}
        hasCloud={hasCloud}
      />

      {embedded && (
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          {ActionSlot}
        </div>
      )}
    </div>
  )
}
