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
  applyFamilyOverrides,
} from '../utils/modelFamilies.js'

/**
 * ChatPage — Spatial Intelligence v2.0
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
  const [familyOverrides, setFamilyOverrides] = useState({})
  const [selectedModel,   setSelectedModel]   = useState(null)
  const [savingModel,     setSavingModel]     = useState(false)

  const [history,        setHistory]        = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [showHistory,    setShowHistory]    = useState(false)
  const [viewingSession, setViewingSession] = useState(null)

  const [webSearch,         setWebSearch]         = useState(false)
  const [thinkingMode,      setThinkingMode]      = useState('fast')
  const [showSystem,        setShowSystem]        = useState(false)
  const [familySheetOpen,   setFamilySheetOpen]   = useState(false)
  const [tierSheetOpen,     setTierSheetOpen]     = useState(false)
  const [cloudSheetOpen,    setCloudSheetOpen]    = useState(false)

  const [systemPrompt, setSystemPrompt] = useState('')
  const [forgetMemory, setForgetMemory] = useState(false)
  const [activeDocId, setActiveDocId] = useState(null)

  const inputRef = useRef(null)

  // -- Initialization --
  useEffect(() => {
    fetch(`${API_BASE}/api/models`)
      .then(r => r.json())
      .then(data => {
        setModels({
          cloud: (data.cloud || []).filter(m => m.available),
          local: (data.local || []).filter(m => m.available),
        })
        setFamilyOverrides(data.family_overrides || {})
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

  // -- Model Mapping --
  const availabilitySet = useMemo(() => buildAvailabilitySet(models), [models])
  const visibleFamilies = useMemo(() => applyFamilyOverrides(MODEL_FAMILIES, familyOverrides), [familyOverrides])
  const currentMapping = useMemo(() => findFamilyForModel(selectedModel?.provider, selectedModel?.model_id, visibleFamilies), [selectedModel, visibleFamilies])

  useEffect(() => { if (currentMapping?.tier) setThinkingMode(currentMapping.tier) }, [currentMapping])

  const isLocalModel = !selectedModel?.provider || selectedModel.provider === 'ollama'
  const availableFamilies = useMemo(() => visibleFamilies.filter(f => TIER_ORDER.some(t => isTierAvailable(f, t, availabilitySet))), [visibleFamilies, availabilitySet])
  const availableTiersForFamily = useMemo(() => {
    const fam = currentMapping?.family
    if (!fam || fam.provider !== 'ollama') return []
    return TIER_ORDER.filter(t => isTierAvailable(fam, t, availabilitySet))
  }, [currentMapping, availabilitySet])

  const selectedCloudModelInfo = useMemo(() => !isLocalModel ? models.cloud.find(m => m.provider === selectedModel?.provider && m.model_id === selectedModel?.model_id) : null, [isLocalModel, models.cloud, selectedModel])

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
  }, [inputText, isThinking, messages, selectedModel, token, webSearch, thinkingMode, systemPrompt, activeDocId, forgetMemory, user, currentSessionId])

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
          
          <button className={`rs-pill ${thinkingMode !== 'fast' ? 'is-active' : ''}`} onClick={() => setTierSheetOpen(true)}>
            <span className="material-symbols-rounded">psychology</span>
            <span className="rs-speak-actions-label">{TIER_META[thinkingMode]?.label}</span>
          </button>

          <button className={`rs-pill ${webSearch ? 'is-active' : ''}`} onClick={() => setWebSearch(!webSearch)}>
            <span className="material-symbols-rounded">public</span>
            <span className="rs-speak-actions-label">SCAN WEB</span>
          </button>
        </div>

        <div className="rs-chat-input-right">
          <button className="rs-pill" onClick={() => isLocalModel ? setFamilySheetOpen(true) : setCloudSheetOpen(true)}>
            <span className="material-symbols-rounded">{isLocalModel ? 'memory' : 'cloud'}</span>
            <span className="rs-speak-actions-label">
              {currentMapping?.family?.displayName || selectedCloudModelInfo?.display_name || 'NEURAL CORE'}
            </span>
          </button>

          <button className={`rs-pill ${isRecording ? 'is-active' : ''}`} onClick={() => isRecording ? stopRecording() : startRecording()} disabled={isThinking}>
            <span className="material-symbols-rounded">{isRecording ? 'stop' : 'mic'}</span>
          </button>

          <button className="rs-btn-primary rs-send-btn" onClick={handleSend} disabled={!inputText.trim() || isThinking} style={{ background: 'var(--primary)', color: 'var(--bg-base)' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.4rem' }}>arrow_upward</span>
          </button>
        </div>
      </div>
    </div>
  ), [inputText, handleSend, isRecording, startRecording, stopRecording, isThinking, viewingSession, thinkingMode, webSearch, isLocalModel, currentMapping, selectedCloudModelInfo, token])

  useEffect(() => {
    setAction(ActionSlot)
    return () => { if (setAction) setAction(null) }
  }, [ActionSlot, setAction])

  const displayMessages = viewingSession ? viewingSession.messages : messages
  const displayStreaming = viewingSession ? '' : streamingResponse

  return (
    <div className="rs-foyer">
      
      {/* Dynamic Overlay Bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 20 }}>
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
        <div className="rs-thread" style={{ paddingBottom: '120px' }}>
          {viewingSession && (
            <div style={{ marginBottom: 24 }}>
              <button className="rs-pill is-active" onClick={() => setViewingSession(null)}>
                 <span className="material-symbols-rounded">live_tv</span>
                 RETURN TO LIVE STREAM
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

      {/* Choice Sheets */}
      <Sheet open={familySheetOpen} onClose={() => setFamilySheetOpen(false)} title="Neural Core Family">
        {availableFamilies.map(family => (
          <SheetRow
            key={family.id}
            icon={family.icon || (family.provider === 'ollama' ? 'memory' : 'cloud')}
            title={family.displayName}
            sub={family.blurb}
            active={currentMapping?.family?.id === family.id}
            onClick={() => {
              setFamilySheetOpen(false)
              const tier = isTierAvailable(family, thinkingMode, availabilitySet) ? thinkingMode : TIER_ORDER.find(t => isTierAvailable(family, t, availabilitySet))
              if (tier) { setThinkingMode(tier); handleModelSelect(family.provider, family.tiers[tier]) }
            }}
          />
        ))}
      </Sheet>

      <Sheet open={tierSheetOpen} onClose={() => setTierSheetOpen(false)} title="Synaptic Tier">
        {availableTiersForFamily.map(tier => (
          <SheetRow
            key={tier}
            icon={TIER_META[tier].icon}
            title={TIER_META[tier].label}
            sub={TIER_META[tier].blurb}
            active={thinkingMode === tier}
            onClick={() => {
              setTierSheetOpen(false)
              const fam = currentMapping?.family
              if (fam) { setThinkingMode(tier); handleModelSelect(fam.provider, fam.tiers[tier]) }
            }}
          />
        ))}
      </Sheet>

      <Sheet open={cloudSheetOpen} onClose={() => setCloudSheetOpen(false)} title="Cloud Intelligence">
        {models.cloud.map(m => (
          <SheetRow
            key={m.model_id}
            icon="cloud"
            title={m.display_name}
            sub={fmtCost(m.cost_per_1k_input_usd) || 'Nominal availability'}
            active={selectedModel?.model_id === m.model_id}
            onClick={() => { setCloudSheetOpen(false); handleModelSelect(m.provider, m.model_id) }}
          />
        ))}
      </Sheet>
    </div>
  )
}
