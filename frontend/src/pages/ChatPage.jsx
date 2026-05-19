import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import ConversationPanel   from '../components/ConversationPanel.jsx'
import Sheet, { SheetRow } from '../chrome/Sheet.jsx'
import { useAuth }         from '../context/AuthContext.jsx'
import { useAudioRecorder } from '../hooks/useAudioRecorder.js'
import {
  MODEL_FAMILIES,
  TIER_ORDER,
  TIER_META,
  findFamilyForModel,
  buildAvailabilitySet,
  isTierAvailable,
  familyHasAnyTier,
} from '../utils/modelFamilies.js'

/**
 * ChatPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Full immersive chat experience. 
 * Moves input controls to the Shell's bottom action slot.
 */

const API_BASE = import.meta.env.VITE_API_URL || ''
const MAX_HISTORY_SESSIONS = 30

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

export default function ChatPage({ setAction, onNavigate }) {
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
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const [modelOpen, setModelOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [thinkingMode, setThinkingMode] = useState('fast') // 'fast' | 'thinking' | 'pro'
  const [showSystem, setShowSystem] = useState(false)

  // Two-step model picker — Family sheet -> Variant sheet
  const [familySheetOpen,  setFamilySheetOpen]  = useState(false)
  const [variantSheetOpen, setVariantSheetOpen] = useState(false)
  const [pendingFamily,    setPendingFamily]    = useState(null)

  const [systemPrompt, setSystemPrompt] = useState('')
  const [enhancing, setEnhancing] = useState(false)
  const [forgetMemory, setForgetMemory] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [activeDocId, setActiveDocId] = useState(null)

  const modelDropRef = useRef(null)
  const inputRef = useRef(null)

  // -- Load models and history --
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
  }, [user?.id, token])

  // -- Model selection --
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

  // -- Derived: current family/tier + availability ---------------------------
  const availabilitySet = useMemo(
    () => buildAvailabilitySet(models),
    [models],
  )

  const currentMapping = useMemo(
    () => findFamilyForModel(selectedModel?.provider, selectedModel?.model_id),
    [selectedModel?.provider, selectedModel?.model_id],
  )

  // Label for the pill: "DeepSeek · Thinking" when mapped, "<raw> · Custom"
  // when the user has some model not in MODEL_FAMILIES, "Select model" otherwise.
  const modelPillLabel = useMemo(() => {
    if (currentMapping) {
      return `${currentMapping.family.displayName} · ${TIER_META[currentMapping.tier].label}`
    }
    if (selectedModel?.model_id) {
      return `${selectedModel.model_id} · Custom`
    }
    return 'Select model'
  }, [currentMapping, selectedModel?.model_id])

  const visibleFamilies = useMemo(() => MODEL_FAMILIES, [])

  // Keep thinkingMode in sync with the loaded selection so the chat body's
  // thinking_mode reflects reality even before the user opens the picker.
  useEffect(() => {
    if (currentMapping?.tier) setThinkingMode(currentMapping.tier)
  }, [currentMapping?.tier])

  const openFamilySheet = useCallback(() => {
    // Seed pendingFamily from current selection so the variant sheet has
    // something sensible if the user reopens it mid-flow.
    if (currentMapping?.family) setPendingFamily(currentMapping.family)
    setVariantSheetOpen(false)
    setFamilySheetOpen(true)
  }, [currentMapping])

  const handlePickFamily = useCallback((family) => {
    setPendingFamily(family)
    setFamilySheetOpen(false)
    setVariantSheetOpen(true)
  }, [])

  const handlePickVariant = useCallback((tier) => {
    if (!pendingFamily) return
    const model_id = pendingFamily.tiers?.[tier]
    if (!model_id) return
    if (!isTierAvailable(pendingFamily, tier, availabilitySet)) return
    setThinkingMode(tier)
    handleModelSelect(pendingFamily.provider, model_id)
    setVariantSheetOpen(false)
  }, [pendingFamily, availabilitySet]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateHistory = useCallback((updatedMessages) => {
    if (!user) return
    setHistory(prev => {
      let newHistory = [...prev]
      if (currentSessionId) {
        const idx = newHistory.findIndex(s => s.id === currentSessionId)
        if (idx !== -1) {
          newHistory[idx] = { ...newHistory[idx], messages: updatedMessages }
        } else {
          // Should not happen if ID was set correctly
          const newSession = { id: currentSessionId, date: new Date().toISOString(), messages: updatedMessages }
          newHistory = [newSession, ...newHistory]
        }
      } else {
        const newId = Date.now()
        const newSession = { id: newId, date: new Date().toISOString(), messages: updatedMessages }
        newHistory = [newSession, ...newHistory]
        setCurrentSessionId(newId)
      }
      saveHistory(user.id, newHistory)
      return newHistory
    })
  }, [user, currentSessionId])

  // -- Actions --
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
      let endpoint = `${API_BASE}/api/conversation/chat`
      let body = {
        message: t,
        history: next.slice(-20).map(m => ({ role: m.role, content: m.text })),
        provider: selectedModel?.provider,
        model_id: selectedModel?.model_id,
        web_search: webSearch,
        thinking_mode: thinkingMode,
        forget_memory: forgetMemory,
        ...(systemPrompt.trim() ? { system_prompt: systemPrompt.trim() } : {}),
      }

      if (activeDocId) {
        endpoint = `${API_BASE}/api/rag/query`
        body = { doc_id: activeDocId, question: t }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      if (activeDocId) {
        const data = await res.json()
        const assistantMsg = { 
          role: 'assistant', 
          text: data.answer, 
          chunks: data.chunks 
        }
        const updated = [...next, assistantMsg]
        setMessages(updated)
        updateHistory(updated)
      } else {
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
        updateHistory(updated)
      }
    } catch (err) {
      setError('Connection failure.')
      setStreamingResponse('')
    } finally {
      setIsThinking(false)
      setThinkingStart(null)
    }
  }, [inputText, isThinking, messages, selectedModel, token, webSearch, thinkingMode, systemPrompt, activeDocId, forgetMemory, user, updateHistory])

  const handleReset = useCallback(() => {
    setMessages([])
    setStreamingResponse('')
    setToolEvents([])
    setError(null)
    setViewingSession(null)
    setForgetMemory(true)
    setActiveDocId(null)
    setCurrentSessionId(null)
  }, [])

  const handleUploadDoc = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    const docId = `doc_${Date.now()}`
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API_BASE}/api/rag/ingest?doc_id=${docId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (res.ok) {
        setActiveDocId(docId)
        setMessages(p => [...p, { role: 'system', text: `Resource indexed: ${file.name}` }])
      }
    } catch {
      setError('Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }, [token])

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

  const handleGenerateImage = useCallback(async () => {
    const t = inputText.trim()
    if (!t || isThinking) return
    setInputText('')
    setError(null)
    setMessages(p => [...p, { role: 'user', text: `DREAMSCAPE: ${t}` }])
    setIsThinking(true)
    setThinkingStart(Date.now())
    try {
      const res = await fetch(`${API_BASE}/api/image/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: t }),
      })
      
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        setMessages(p => [...p, { role: 'assistant', text: `Generated visual for: "${t}"`, image: url }])
      } else {
        const data = await res.json()
        setError(`Generation failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setError('Visual generation failed. Check server logs.')
    } finally {
      setIsThinking(false)
      setThinkingStart(null)
    }
  }, [inputText, isThinking, token])


  // -- Bottom Action Slot --
  const ActionSlot = useMemo(() => (
    <div className="rs-input-bar">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button 
          className={`rs-pill ${isRecording ? 'is-active' : ''}`} 
          onClick={() => isRecording ? stopRecording() : startRecording()}
          disabled={isThinking}
          title={isRecording ? 'Stop Recording' : 'Start Voice Input'}
          style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }}
        >
          <span className="material-symbols-rounded">{isRecording ? 'stop' : 'mic'}</span>
        </button>
        
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          background: 'var(--md-surface-container-low)', 
          borderRadius: '24px', 
          padding: '4px 12px',
          border: '1px solid var(--md-outline-variant)'
        }}>
          <textarea
            ref={inputRef}
            rows={1}
            style={{ 
              flex: 1, 
              background: 'transparent', 
              border: 'none', 
              color: 'inherit',
              fontSize: '1rem', 
              padding: '8px 4px', 
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit'
            }}
            placeholder="Message River Song..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            disabled={isThinking || !!viewingSession}
          />
          
          <div style={{ display: 'flex', gap: 6 }}>
             <button className="rs-btn-ghost" onClick={handleGenerateImage} disabled={!inputText.trim()} title="Dreamscape" style={{ padding: 8 }}>
               <span className="material-symbols-rounded">auto_awesome</span>
             </button>
             
             {activeDocId ? (
               <button className="rs-btn-ghost is-active" onClick={() => setActiveDocId(null)} title="Clear RAG Context" style={{ padding: 8, color: 'var(--primary)' }}>
                 <span className="material-symbols-rounded">close</span>
               </button>
             ) : (
               <label className="rs-btn-ghost" style={{ cursor: 'pointer', padding: 8 }} title="RAG Context">
                 <span className="material-symbols-rounded">attach_file</span>
                 <input type="file" style={{ display: 'none' }} onChange={handleUploadDoc} />
               </label>
             )}

             <button 
               className="rs-pill is-active" 
               style={{ width: 40, height: 40, padding: 0, justifyContent: 'center' }} 
               onClick={handleSend} 
               disabled={!inputText.trim() || isThinking}
             >
               <span className="material-symbols-rounded">send</span>
             </button>
          </div>
        </div>

        <button className="rs-pill" onClick={handleReset} title="Clear Session" style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }}>
          <span className="material-symbols-rounded">refresh</span>
        </button>
      </div>
    </div>
  ), [inputText, handleSend, handleReset, isRecording, startRecording, stopRecording, isThinking, viewingSession, handleGenerateImage, handleUploadDoc, activeDocId])


  useEffect(() => {
    setAction(ActionSlot)
  }, [ActionSlot, setAction])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse

  return (
    <div className="rs-foyer">
      
      {/* Feature Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`rs-pill ${webSearch ? 'is-active' : ''}`} onClick={() => setWebSearch(!webSearch)}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>public</span>
            WEB
          </button>
          <button
            className="rs-pill is-active"
            onClick={openFamilySheet}
            title="Choose model family and tier"
          >
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>
              {thinkingMode === 'fast' ? 'bolt' : thinkingMode === 'thinking' ? 'psychology' : 'verified'}
            </span>
            {modelPillLabel}
          </button>

          {savingModel && <span className="rs-card-label" style={{ color: 'var(--primary)', opacity: 1, marginLeft: 12 }}>SYNCING MODEL...</span>}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="rs-pill" onClick={() => setShowSystem(!showSystem)}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>settings_input_component</span>
          </button>
          <button className={`rs-pill ${showHistory ? 'is-active' : ''}`} onClick={() => setShowHistory(!showHistory)}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>history</span>
          </button>
        </div>
      </div>

      {showSystem && (
        <div className="rs-card is-elev" style={{ marginBottom: 24 }}>
          <div className="rs-card-label">System Directives</div>
          <textarea
            style={{ all: 'unset', width: '100%', marginTop: 12, fontSize: '0.9rem', minHeight: '60px' }}
            placeholder="Adjust River Song's internal weights..."
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
          />
        </div>
      )}

      {showHistory ? (
        <div className="rs-card-flow">
          {history.length === 0 ? (
            <div className="rs-card-meta">Memory archives empty.</div>
          ) : (
            history.map(s => (
              <div key={s.id} className="rs-card is-tappable is-wide" onClick={() => { setViewingSession(s); setShowHistory(false) }}>
                <div className="rs-card-head">
                  <span className="rs-card-label">{fmtDate(s.date)}</span>
                  <span className="rs-card-label">{s.messages.length} EVENTS</span>
                </div>
                <div className="rs-card-value" style={{ fontSize: '1.1rem' }}>{s.messages[0]?.text || 'Interaction'}</div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="rs-thread" style={{ paddingBottom: '100px' }}>
          {viewingSession && (
            <div style={{ marginBottom: 20 }}>
              <button className="rs-pill" onClick={() => setViewingSession(null)}>← RETURN TO LIVE</button>
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

      {/* ---------- Model family sheet (step 1) ---------- */}
      <Sheet
        open={familySheetOpen}
        onClose={() => setFamilySheetOpen(false)}
        title="Model family"
      >
        {visibleFamilies.map(family => {
          const anyAvail = familyHasAnyTier(family, availabilitySet)
          const isActive = currentMapping?.family?.id === family.id
          return (
            <SheetRow
              key={family.id}
              icon={family.icon || 'chat'}
              title={family.displayName}
              sub={anyAvail ? family.blurb : `${family.blurb} — unavailable`}
              active={isActive}
              onClick={() => handlePickFamily(family)}
            />
          )
        })}
      </Sheet>

      {/* ---------- Variant sheet (step 2) ---------- */}
      <Sheet
        open={variantSheetOpen}
        onClose={() => setVariantSheetOpen(false)}
        title={pendingFamily ? `${pendingFamily.displayName} — tier` : 'Tier'}
      >
        {pendingFamily && TIER_ORDER.map(tier => {
          const meta      = TIER_META[tier]
          const model_id  = pendingFamily.tiers?.[tier]
          const available = isTierAvailable(pendingFamily, tier, availabilitySet)
          const isActive  =
            currentMapping?.family?.id === pendingFamily.id &&
            currentMapping?.tier === tier
          const sub = !model_id
            ? `${meta.blurb} — not mapped`
            : !available
              ? `${meta.blurb} — unavailable`
              : `${meta.blurb} · ${model_id}`
          return (
            <div
              key={tier}
              style={{
                opacity: (!model_id || !available) ? 0.45 : 1,
                pointerEvents: (!model_id || !available) ? 'none' : 'auto',
              }}
            >
              <SheetRow
                icon={meta.icon}
                title={meta.label}
                sub={sub}
                active={isActive}
                onClick={() => handlePickVariant(tier)}
              />
            </div>
          )
        })}
      </Sheet>

    </div>
  )
}
