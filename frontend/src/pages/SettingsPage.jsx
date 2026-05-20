// =============================================================================
// src/pages/SettingsPage.jsx
//
// Settings page for River Song AI.
//
// Sections:
//   AI MODEL  -- pick local Ollama model or enabled cloud provider model
//   VOICE     -- TTS provider selection (Piper local; cloud options placeholder)
//   MEMORY    -- conversation summary TTL, auto-extend toggle
//
// All settings are persisted via REST calls to the backend (/api/settings/*).
// =============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { registerPushNotifications, unregisterPushNotifications, getPushSubscription } from '../utils/pushNotifications'
import { MODEL_FAMILIES, TIER_ORDER, TIER_META } from '../utils/modelFamilies.js'

const API_BASE = '' // same origin

// ---------------------------------------------------------------------------
// Helper: format cost
// ---------------------------------------------------------------------------
function fmtCost(v) {
  if (v == null) return null
  return v < 0.001 ? `$${(v * 1000).toFixed(3)}/M` : `$${v.toFixed(4)}/K`
}

const TTL_LABELS = {
  short:    '7 days',
  standard: '30 days',
  extended: '90 days',
  long:     '365 days',
  forever:  'Forever',
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children }) {
  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">{title}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model card
// ---------------------------------------------------------------------------
function ModelCard({ model, isSelected, isDisabled, onSelect }) {
  const inputCost  = fmtCost(model.cost_per_1k_input_usd)
  const outputCost = fmtCost(model.cost_per_1k_output_usd)

  return (
    <div
      className={`rs-card is-tappable ${isSelected ? 'is-elev' : ''} ${isDisabled ? 'is-disabled' : ''}`}
      onClick={() => !isDisabled && onSelect(model)}
      style={{
        flex: '1 1 200px',
        padding: '16px',
        borderColor: isSelected ? 'var(--primary)' : undefined,
        opacity: isDisabled ? 0.5 : 1
      }}
    >
      <div className="rs-card-value" style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.display_name}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {model.vram_gb != null && (
          <>
            <span className="rs-pill" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
              {model.vram_gb <= 4 ? '⚡ GPU' : 'RAM'} {model.vram_gb}GB
            </span>
            {model.vram_gb <= 4 && (
              <span className="rs-pill is-active" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>SPEAK</span>
            )}
          </>
        )}

        {model.is_cloud && (
          <>
            {inputCost && <span className="rs-pill" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>IN {inputCost}</span>}
            {outputCost && <span className="rs-pill" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>OUT {outputCost}</span>}
          </>
        )}
      </div>

      {model.is_cloud && isDisabled && (
        <div className="rs-card-meta" style={{ color: 'var(--md-error)', fontWeight: 700 }}>KEY REQUIRED</div>
      )}
      
      {isSelected && (
        <div style={{ position: 'absolute', top: 12, right: 12 }}>
          <span className="material-symbols-rounded" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>check_circle</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle switch — M3-style sliding switch
// ---------------------------------------------------------------------------
function Toggle({ checked, onChange, label, id, disabled }) {
  return (
    <div className="toggle-row" style={{ padding: 0 }}>
      {label && <span className="toggle-label">{label}</span>}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------
const PROVIDER_NAMES = {
  anthropic:  'Anthropic Claude',
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  mistral_ai: 'Mistral AI',
  ollama:     'Ollama (local)',
}

export default function SettingsPage({
  onFeaturesChanged,
  viewMode = 'user',  // 'user' or 'admin'
}) {
  const { user, token } = useAuth()
  const showUser = viewMode === 'user'
  const showAdmin = viewMode === 'admin' && user?.role === 'admin'

  const [models,           setModels]           = useState({ local: [], cloud: [] })
  const [visibility,       setVisibility]       = useState(null)
  const [featureVis,       setFeatureVis]       = useState(null)  // admin: global feature flags
  const [familyData,       setFamilyData]       = useState(null)  // admin: parent-child links
  const [familyGroups,     setFamilyGroups]     = useState(null)  // admin: family groups
  const [childrenData,     setChildrenData]     = useState(null)  // parent: my children
  const [enabledProviders, setEnabledProviders] = useState({})
  const [llmSettings,      setLlmSettings]      = useState(null)
  const [memSettings,      setMemSettings]      = useState(null)
  const [voiceSettings,    setVoiceSettings]    = useState(null)
  const [aiFeatures,       setAiFeatures]       = useState({})
  const [elevenLabsSettings, setElevenLabsSettings] = useState(null)
  const [personaSettings,    setPersonaSettings]    = useState(null)
  const [daemonStatus,       setDaemonStatus]       = useState({})
  const [wakeWordRestart,    setWakeWordRestart]    = useState(false)
  const [orchestrationSettings, setOrchestrationSettings] = useState({
    n8n_enabled: false,
    n8n_url: '',
    n8n_api_key: '',
    n8n_webhook_secret: ''
  })
  const [modelFilter,      setModelFilter]      = useState('ALL')
  const [loading,          setLoading]          = useState(true)
  const [saveStatus,       setSaveStatus]       = useState('')

  // ---- Initial data load ----
  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const query = user?.id ? `?user_id=${user.id}` : ''

    const fetches = [
      fetch(`${API_BASE}/api/models`).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/llm${query}`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/memory${query}`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/voice`, { headers }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/features`, { headers }).then(r => r.json()).catch(() => ({ ai_features: {} })),
    ]
    if (user?.role === 'admin') {
      fetches.push(
        fetch(`${API_BASE}/api/admin/model-visibility`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/feature-visibility`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/family`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/family-groups`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/settings/orchestration`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/settings/elevenlabs`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/settings/persona`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/daemon/status`, { headers }).then(r => r.json()).catch(() => null),
      )
    }
    if (user?.role === 'parent') {
      fetches.push(
        null, null, null, null, null, null, null, // pad to keep indices consistent
        fetch(`${API_BASE}/api/parent/children`, { headers }).then(r => r.json()).catch(() => null),
      )
    }

    Promise.all(fetches)
      .then(([modData, llmData, memData, voiceData, featData, visData, featVisData, familyRaw, familyGroupsRaw, orchData, elData, personaData, dStatus, childrenRaw]) => {
        setModels({ local: modData.local || [], cloud: modData.cloud || [] })
        setEnabledProviders(modData.enabled_providers || {})
        setLlmSettings(llmData)
        setMemSettings(memData)
        setVoiceSettings(voiceData)
        if (featData)         setAiFeatures(featData.ai_features || {})
        if (visData)          setVisibility(visData)
        if (featVisData)      setFeatureVis(featVisData)
        if (familyRaw)        setFamilyData(familyRaw)
        if (familyGroupsRaw)  setFamilyGroups(familyGroupsRaw)
        if (orchData)         setOrchestrationSettings(orchData)
        if (elData)           setElevenLabsSettings(elData)
        if (personaData)      setPersonaSettings(personaData)
        if (dStatus)          setDaemonStatus(dStatus.daemons || {})
        if (childrenRaw)      setChildrenData(childrenRaw)
        setLoading(false)
      })
      .catch(err => {
        console.error('[SettingsPage] Load failed:', err)
        setLoading(false)
        setSaveStatus('error')
      })
  }, [user?.id, user?.role, token])

  // ---- Save LLM selection ----
  const selectModel = useCallback(async (model) => {
    setSaveStatus('saving')
    try {
      const query = user?.id ? `?user_id=${user.id}` : ''
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE}/api/settings/llm${query}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          provider: model.provider,
          model_id: model.model_id,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Save failed')
      }
      setLlmSettings(prev => ({ ...prev, provider: model.provider, model: model.model_id }))
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch (e) {
      console.error('[SettingsPage] LLM save failed:', e)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [user?.id, token])

  // ---- Save cloud fallback settings ----
  const saveFallback = useCallback(async (patch) => {
    const next = { ...llmSettings, ...patch }
    setLlmSettings(next)
    setSaveStatus('saving')
    try {
      const query = user?.id ? `?user_id=${user.id}` : ''
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/llm${query}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          provider:               next.provider,
          model_id:               next.model,
          cloud_fallback_enabled: next.cloud_fallback_enabled,
          cloud_fallback_provider: next.cloud_fallback_provider,
          cloud_fallback_model:   next.cloud_fallback_model,
          whisper_model:          next.whisper_model,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [llmSettings, user?.id, token])

  // ---- Save orchestration settings ----
  const saveOrchestration = useCallback(async (patch) => {
    const next = { ...orchestrationSettings, ...patch }
    setOrchestrationSettings(next)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/orchestration`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(next),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [orchestrationSettings, token])

  // ---- Save ElevenLabs settings ----
  const saveElevenLabs = useCallback(async (patch) => {
    const next = { ...elevenLabsSettings, ...patch }
    setElevenLabsSettings(next)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/elevenlabs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(next)
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [elevenLabsSettings, token])

  // ---- Save memory settings ----
  const saveMemory = useCallback(async (patch) => {
    const next = { ...memSettings, ...patch }
    setMemSettings(next)
    setSaveStatus('saving')
    try {
      const query = user?.id ? `?user_id=${user.id}` : ''
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE}/api/settings/memory${query}`, {
        method:  'POST',
        headers,
        body:    JSON.stringify({
          summaries_enabled: next.summaries_enabled,
          default_ttl:       next.default_ttl,
          auto_extend:       next.auto_extend,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch (e) {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [memSettings, user?.id, token])

  const saveAiFeature = useCallback(async (flagName, enabled) => {
    setSaveStatus('saving')
    if (flagName === 'WAKE_WORD_ENABLED') setWakeWordRestart(true)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/features/${flagName}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled })
      })
      if (!res.ok) throw new Error('Save failed')
      setAiFeatures(prev => ({ ...prev, [flagName]: enabled }))
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [token])

  const savePersona = useCallback(async (prompt) => {
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/persona`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ system_prompt: prompt })
      })
      if (!res.ok) throw new Error('Save failed')
      setPersonaSettings({ system_prompt: prompt })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [token])

  const resetPersona = useCallback(async () => {
    setSaveStatus('saving')
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const res = await fetch(`${API_BASE}/api/settings/persona/default`, { headers })
      if (!res.ok) throw new Error('Fetch failed')
      const data = await res.json()
      setPersonaSettings(data)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [token])

  const triggerDaemonTask = useCallback(async (daemonName, action, payload = {}) => {
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/daemon/${daemonName}/task`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, payload })
      })
      if (!res.ok) throw new Error('Task failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [token])

  // ---- Render ----
  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-loading">LOADING CONFIGURATION…</div>
      </div>
    )
  }

  const currentProvider = llmSettings?.provider || 'ollama'
  const currentModel    = llmSettings?.model    || ''

  const recommendedModels = models.local.filter(m => m.vram_gb != null && m.vram_gb <= 4)
  const filteredLocalModels = models.local.filter(m => {
    if (modelFilter === 'ALL') return true
    if (modelFilter === 'GPU') return m.vram_gb != null && m.vram_gb <= 4
    if (modelFilter === 'RAM') return m.vram_gb != null && m.vram_gb > 4
    if (modelFilter === 'SPEAK') return m.vram_gb != null && m.vram_gb <= 4
    return true
  })

  return (
    <div className="rs-foyer animate-fade-in">
      {/* CSS for recommended strip and persona textarea */}
      <style>{`
        .model-recommended-strip {
          display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;
          padding: 12px 14px;
          background: color-mix(in srgb, var(--md-tertiary) 6%, transparent);
          border: 1px solid color-mix(in srgb, var(--md-tertiary) 20%, transparent);
          border-radius: var(--md-shape-md);
        }
        .persona-textarea {
          font-family: var(--font-mono, monospace) !important;
          font-size: 0.85rem !important;
          line-height: 1.5 !important;
          letter-spacing: 0.02em;
          background: var(--md-surface-container-lowest) !important;
          border-color: var(--md-outline-variant) !important;
        }
        .persona-textarea:focus {
          border-color: var(--md-primary) !important;
          box-shadow: 0 0 0 1px var(--md-primary);
        }
      `}</style>

      <header className="rs-foyer-head">
        <div className="rs-card-label" style={{ marginBottom: 8 }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>
            {showAdmin ? 'shield_person' : 'settings'}
          </span>
          {showAdmin ? 'SYSTEM / ADMIN' : 'PERSONAL / CONFIGURATION'}
        </div>
        <h1 className="rs-greeting">{showAdmin ? 'Admin Settings' : 'Settings'}</h1>
        <div className="rs-greeting-sub">
          {showAdmin
            ? 'Global controls, daemons, visibility, families. API credentials live in .env.'
            : 'Your model, voice, memory, and notifications.'}
        </div>
      </header>

      {/* Save status toast */}
      {saveStatus && (
        <div 
          className="rs-pill is-active" 
          style={{ 
            position: 'fixed', bottom: 32, right: 32, zIndex: 1000,
            background: saveStatus === 'error' ? 'var(--md-error)' : 'var(--primary)',
            color: saveStatus === 'error' ? 'white' : 'black',
            boxShadow: 'var(--md-elevation-3)'
          }}
          aria-live="polite"
        >
          {saveStatus === 'saving' && '● SAVING…'}
          {saveStatus === 'saved'  && '✓ SAVED'}
          {saveStatus === 'error'  && '✗ ERROR — CHECK CONSOLE'}
        </div>
      )}

      <div className="rs-card-flow">
      
      {/* ================================================================ */}
      {/* ORCHESTRATION (n8n) — admin view, toggle only. Credentials live in .env */}
      {/* ================================================================ */}
      {showAdmin && orchestrationSettings && (
        <Section title="WORKFLOW AUTOMATION">
          <Toggle
            id="n8n-toggle"
            label="Enable Background Automation"
            checked={orchestrationSettings.n8n_enabled}
            onChange={v => saveOrchestration({ n8n_enabled: v })}
          />
          <p className="rs-card-meta">
            River can execute complex, multi-step routines in the background. System credentials are automatically securely loaded from the core environment.
          </p>
        </Section>
      )}

      {/* ================================================================ */}
      {/* AI MODEL — user-facing                                           */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="AI MODEL">
        <p className="rs-card-meta" style={{ marginBottom: 16 }}>
          The selected model is used for both Chat and Speak. For Speak, choose a model
          tagged <strong>⚡ GPU / SPEAK</strong> — these fit in your GPU's VRAM and respond
          faster for real-time voice conversation.
        </p>

        {/* RECOMMENDED STRIP */}
        {recommendedModels.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div className="rs-card-label" style={{ color: 'var(--md-tertiary)', marginBottom: 12 }}>
              ⚡ RECOMMENDED FOR SPEAK
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {recommendedModels.map(m => (
                <ModelCard
                  key={`rec/${m.provider}/${m.model_id}`}
                  model={m}
                  isSelected={currentProvider === m.provider && currentModel === m.model_id}
                  isDisabled={false}
                  onSelect={selectModel}
                />
              ))}
            </div>
          </div>
        )}

        {/* Local models */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* QUICK FILTER BAR */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['ALL', 'GPU', 'RAM', 'SPEAK'].map(f => (
              <button
                key={f}
                onClick={() => setModelFilter(f)}
                className={`rs-pill ${modelFilter === f ? 'is-active' : ''}`}
                style={{ fontSize: '0.7rem' }}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="rs-card-label" style={{ marginBottom: 8 }}>
            <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px', background: 'var(--primary)', color: 'black' }}>LOCAL</span>
            Ollama — runs on your machine
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {filteredLocalModels.map(m => (
              <ModelCard
                key={`${m.provider}/${m.model_id}`}
                model={m}
                isSelected={currentProvider === m.provider && currentModel === m.model_id}
                isDisabled={false}
                onSelect={selectModel}
              />
            ))}
          </div>
        </div>

        {/* Cloud models */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 24 }}>
          <div className="rs-card-label">
            <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px', background: 'var(--md-tertiary)', color: 'black' }}>CLOUD</span>
            API providers — costs per token · requires API key in .env
          </div>

          {['anthropic', 'gemini', 'openai', 'mistral_ai'].map(providerKey => {
            const provModels = models.cloud.filter(m => m.provider === providerKey)
            const enabled    = !!enabledProviders[providerKey]
            if (!provModels.length) return null

            const providerNames = {
              anthropic:  'Anthropic Claude',
              gemini:     'Google Gemini',
              openai:     'OpenAI',
              mistral_ai: 'Mistral AI',
            }

            return (
              <div key={providerKey} style={{ opacity: enabled ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{providerNames[providerKey]}</span>
                  {!enabled && (
                    <span className="rs-card-label" style={{ fontSize: '0.6rem', color: 'var(--md-error)' }}>LOCKED</span>
                  )}
                  {enabled && (
                    <span className="rs-card-label" style={{ fontSize: '0.6rem', color: '#4ade80' }}>ENABLED</span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {provModels.map(m => (
                    <ModelCard
                      key={`${m.provider}/${m.model_id}`}
                      model={m}
                      isSelected={currentProvider === m.provider && currentModel === m.model_id}
                      isDisabled={!enabled}
                      onSelect={selectModel}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </Section>
      )}

      {/* ================================================================ */}
      {/* VOICE RECOGNITION (STT) — user-facing                            */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="VOICE RECOGNITION (STT)">
        <p className="rs-card-meta" style={{ marginBottom: 16 }}>
          Select the Whisper model size for real-time speech-to-text. Smaller models respond instantly, larger models are more accurate. Runs 100% locally.
        </p>
        <div style={{ marginTop: 8 }}>
          <label className="settings-label">WHISPER MODEL SIZE</label>
          <select 
            className="settings-select"
            value={llmSettings?.whisper_model || 'base'}
            onChange={e => saveFallback({ whisper_model: e.target.value })}
            style={{ width: '200px' }}
          >
            <option value="tiny">Tiny (Fastest, low VRAM)</option>
            <option value="base">Base (Balanced)</option>
            <option value="small">Small (More accurate)</option>
            <option value="medium">Medium (Requires more VRAM)</option>
          </select>
        </div>
      </Section>
      )}

      {/* ================================================================ */}
      {/* DAEMON CONTROL — admin                                          */}
      {/* ================================================================ */}
      {showAdmin && (
        <Section title="DAEMON CONTROL">
          <p className="rs-card-meta" style={{ marginBottom: 16 }}>
            Manage background daemon processes. These run as independent services on the server.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* WARDEN */}
            <div className="rs-card" style={{ padding: 16, background: 'var(--md-surface-container-low)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>WARDEN (Vision/Security)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>RTSP Camera Monitoring</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.warden?.alive ? '#4ade80' : 'var(--md-outline)' }}>
                    {daemonStatus.warden?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="warden-toggle"
                    label=""
                    checked={!!aiFeatures.WARDEN_ENABLED}
                    onChange={v => saveAiFeature('WARDEN_ENABLED', v)}
                  />
                </div>
              </div>
            </div>

            {/* MECHANIC */}
            <div className="rs-card" style={{ padding: 16, background: 'var(--md-surface-container-low)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>MECHANIC (Telemetry)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>MAVLink / ArduRover Link</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.mechanic?.alive ? '#4ade80' : 'var(--md-outline)' }}>
                    {daemonStatus.mechanic?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="mechanic-toggle"
                    label=""
                    checked={!!aiFeatures.MECHANIC_ENABLED}
                    onChange={v => saveAiFeature('MECHANIC_ENABLED', v)}
                  />
                </div>
              </div>
              {daemonStatus.mechanic?.alive && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <button className="rs-pill" onClick={() => triggerDaemonTask('mechanic', 'telemetry')}>TELEMETRY</button>
                  <button className="rs-pill" onClick={() => triggerDaemonTask('mechanic', 'arm')}>ARM ROVER</button>
                </div>
              )}
            </div>

            {/* HERALD */}
            <div className="rs-card" style={{ padding: 16, background: 'var(--md-surface-container-low)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>HERALD (Casting/Lip-Sync)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>Google Home Hub Integration</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.herald?.alive ? '#4ade80' : 'var(--md-outline)' }}>
                    {daemonStatus.herald?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="herald-toggle"
                    label=""
                    checked={!!aiFeatures.HERALD_ENABLED}
                    onChange={v => saveAiFeature('HERALD_ENABLED', v)}
                  />
                </div>
              </div>
              {daemonStatus.herald?.alive && (
                <div style={{ marginTop: 12 }}>
                  <button className="rs-pill" onClick={() => triggerDaemonTask('herald', 'recast_now')}>RECAST KIOSK</button>
                </div>
              )}
            </div>

            {/* SIFTER */}
            <div className="rs-card" style={{ padding: 16, background: 'var(--md-surface-container-low)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>SIFTER (RAG)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>Background Document Indexing</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.sifter?.alive ? '#4ade80' : 'var(--md-outline)' }}>
                    {daemonStatus.sifter?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="sifter-toggle"
                    label=""
                    checked={!!aiFeatures.SIFTER_ENABLED}
                    onChange={v => saveAiFeature('SIFTER_ENABLED', v)}
                  />
                </div>
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* LOCAL AI FEATURES — admin                                        */}
      {/* ================================================================ */}
      {showAdmin && (
        <Section title="LOCAL AI FEATURES">
          <p className="rs-card-meta" style={{ marginBottom: 16 }}>
            Toggle advanced AI capabilities. These are global settings that affect all users.
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-semantic"
                label="Semantic Memory"
                checked={!!aiFeatures.SEMANTIC_MEMORY_ENABLED}
                onChange={v => saveAiFeature('SEMANTIC_MEMORY_ENABLED', v)}
              />
              <p className="rs-card-meta">Use vector search for memory recall</p>
            </div>

            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-vision"
                label="Vision Analysis"
                checked={!!aiFeatures.VISION_ENABLED}
                onChange={v => saveAiFeature('VISION_ENABLED', v)}
              />
              <p className="rs-card-meta">AI photo analysis for inventory & recipes</p>
            </div>

            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-image"
                label="Image Generation"
                checked={!!aiFeatures.IMAGE_GENERATION_ENABLED}
                onChange={v => saveAiFeature('IMAGE_GENERATION_ENABLED', v)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <p className="rs-card-meta" style={{ margin: 0 }}>Local product/recipe visuals</p>
                <span className="rs-card-label" style={{ color: 'var(--md-error)', fontSize: '0.6rem' }}>GPU REQ</span>
              </div>
            </div>

            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-rag"
                label="RAG Documents"
                checked={!!aiFeatures.RAG_ENABLED}
                onChange={v => saveAiFeature('RAG_ENABLED', v)}
              />
              <p className="rs-card-meta">Answer questions from documents</p>
            </div>

            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-streaming"
                label="LLM Streaming"
                checked={!!aiFeatures.LLM_STREAMING_ENABLED}
                onChange={v => saveAiFeature('LLM_STREAMING_ENABLED', v)}
              />
              <p className="rs-card-meta">Stream AI responses token by token</p>
            </div>

            <div className="rs-card" style={{ background: 'var(--md-surface-container-low)' }}>
              <Toggle
                id="feat-chatterbox"
                label="Chatterbox TTS"
                checked={!!aiFeatures.CHATTERBOX_ENABLED}
                onChange={v => saveAiFeature('CHATTERBOX_ENABLED', v)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <p className="rs-card-meta" style={{ margin: 0 }}>AI voice cloning for River</p>
                <span className="rs-card-label" style={{ color: 'var(--md-error)', fontSize: '0.6rem' }}>GPU REQ</span>
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: 16, padding: '12px', background: 'rgba(255, 170, 0, 0.1)', border: '1px solid #ffaa00', borderRadius: 'var(--md-shape-sm)' }}>
            <span style={{ fontSize: '0.8rem', color: '#ffaa00', fontWeight: 600 }}>
              ⚠️ Backend restart required for changes to take effect.
            </span>
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* PERSONALITY — admin                                              */}
      {/* ================================================================ */}
      {showAdmin && personaSettings && (
        <Section title="PERSONALITY">
          <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(255, 170, 0, 0.1)', border: '1px solid #ffaa00', borderRadius: 'var(--md-shape-sm)', color: '#ffaa00', fontSize: '0.8rem' }}>
            ⚠️ Advanced — Keep "River Song" references intact or she will lose her identity.
          </div>
          
          <div style={{ position: 'relative' }}>
            <textarea
              className="persona-textarea rs-card"
              style={{ width: '100%', minHeight: 300, background: 'var(--md-surface-container-low)' }}
              value={personaSettings.system_prompt}
              onChange={e => setPersonaSettings({ system_prompt: e.target.value })}
              placeholder="River Song system prompt..."
              rows={12}
            />
            <div style={{ position: 'absolute', bottom: 12, right: 16, fontSize: '0.65rem', opacity: 0.5, pointerEvents: 'none' }}>
              {personaSettings.system_prompt.length} chars
            </div>
          </div>

          <p className="rs-card-meta">
            Defines her personality and knowledge. Changes take effect on the next session.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            <button className="rs-btn-primary" onClick={() => savePersona(personaSettings.system_prompt)}>
              SAVE CHANGES
            </button>
            <button className="rs-pill" onClick={resetPersona}>
              RESET TO DEFAULT
            </button>
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* CLOUD FALLBACK — user                                            */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="CLOUD FALLBACK">
        <p className="rs-card-meta" style={{ marginBottom: 12 }}>
          When local models are unavailable, River can fall back to cloud providers.
        </p>

        <Toggle
          id="fallback-toggle"
          label="Enable cloud fallback"
          checked={!!(llmSettings?.cloud_fallback_enabled)}
          onChange={v => saveFallback({ cloud_fallback_enabled: v })}
        />

        {llmSettings?.cloud_fallback_enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <div className="rs-card-meta">
              <span className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>Provider</span>
              <select
                className="rs-pill"
                style={{ width: '100%', background: 'var(--md-surface-container-low)', padding: '10px 16px' }}
                value={llmSettings?.cloud_fallback_provider || ''}
                onChange={e => saveFallback({ cloud_fallback_provider: e.target.value, cloud_fallback_model: '' })}
              >
                <option value="">— choose —</option>
                {['anthropic', 'gemini', 'openai', 'mistral_ai'].map(p => (
                  <option key={p} value={p} disabled={!enabledProviders[p]}>
                    {PROVIDER_NAMES[p]}{!enabledProviders[p] ? ' (key required)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {llmSettings?.cloud_fallback_provider && (
              <div className="rs-card-meta">
                <span className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>Model</span>
                <select
                  className="rs-pill"
                  style={{ width: '100%', background: 'var(--md-surface-container-low)', padding: '10px 16px' }}
                  value={llmSettings?.cloud_fallback_model || ''}
                  onChange={e => saveFallback({ cloud_fallback_model: e.target.value })}
                >
                  <option value="">— choose —</option>
                  {models.cloud
                    .filter(m => m.provider === llmSettings.cloud_fallback_provider)
                    .map(m => (
                      <option key={m.model_id} value={m.model_id}>{m.display_name}</option>
                    ))
                  }
                </select>
              </div>
            )}
          </div>
        )}
      </Section>
      )}

      {/* ================================================================ */}
      {/* VOICE — user                                                     */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="VOICE">
        {voiceSettings ? (
          <VoiceSection
            voiceSettings={voiceSettings}
            token={token}
            user={user}
            elevenLabsSettings={elevenLabsSettings}
            onSaveElevenLabs={saveElevenLabs}
            onSwitched={() => {
              const headers = token ? { Authorization: `Bearer ${token}` } : {}
              fetch(`${API_BASE}/api/settings/voice`, { headers })
                .then(r => r.json()).then(setVoiceSettings).catch(() => {})
            }}
          />
        ) : (
          <div className="rs-card-meta">Loading voices…</div>
        )}
      </Section>
      )}

      {/* ================================================================ */}
      {/* WAKE WORD — user                                                 */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="WAKE WORD">
        <Toggle
          id="wake-word-toggle"
          label="Hey River — Always Listening"
          checked={!!aiFeatures.WAKE_WORD_ENABLED}
          onChange={v => saveAiFeature('WAKE_WORD_ENABLED', v)}
        />
        <p className="rs-card-meta">Enable ambient detection. River will actively listen for your designated phrase.</p>
        
        {wakeWordRestart && (
          <div style={{ marginTop: 12, padding: '12px', background: 'rgba(255, 170, 0, 0.1)', border: '1px solid #ffaa00', borderRadius: 'var(--md-shape-sm)' }}>
            <span style={{ fontSize: '0.8rem', color: '#ffaa00', fontWeight: 600 }}>
              System restart required to apply changes.
            </span>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--md-surface-container-low)', padding: '12px 16px', borderRadius: 'var(--md-shape-sm)' }}>
          <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem' }}>
            <span>Active Phrase: <strong>Hey River</strong></span>
          </div>
          <span className="rs-card-label" style={{ color: aiFeatures.WAKE_WORD_ENABLED ? '#4ade80' : 'var(--md-outline)' }}>
            {aiFeatures.WAKE_WORD_ENABLED ? 'ACTIVE' : 'OFF'}
          </span>
        </div>
      </Section>
      )}

      {/* ================================================================ */}
      {/* VOICE ID — user                                                  */}
      {/* ================================================================ */}
      {showUser && <VoiceIDSection token={token} />}

      {/* ================================================================ */}
      {/* TOKEN USAGE — user                                               */}
      {/* ================================================================ */}
      {showUser && <TokenUsageSection token={token} />}

      {/* ================================================================ */}
      {/* MEMORY — user                                                    */}
      {/* ================================================================ */}
      {showUser && memSettings && (
        <Section title="MEMORY">

          <Toggle
            id="summaries-toggle"
            label="Conversation summaries"
            checked={memSettings.summaries_enabled}
            onChange={v => saveMemory({ summaries_enabled: v })}
          />
          <Toggle
            id="auto-extend-toggle"
            label="Auto-extend TTL on reference"
            checked={memSettings.auto_extend}
            onChange={v => saveMemory({ auto_extend: v })}
          />

          <div className="rs-card-meta">
            <span className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>Retention Period</span>
            <select
              className="rs-pill"
              style={{ width: '100%', background: 'var(--md-surface-container-low)', padding: '10px 16px' }}
              value={memSettings.default_ttl}
              onChange={e => saveMemory({ default_ttl: e.target.value })}
            >
              {(memSettings.ttl_options || ['short','standard','extended','long','forever']).map(opt => (
                <option key={opt} value={opt}>
                  {TTL_LABELS[opt] || opt}
                </option>
              ))}
            </select>
          </div>

          <p className="rs-card-meta">
            Summaries are records injected into context at session start. Auto-extend resets expiry each time a summary is referenced.
          </p>
        </Section>
      )}

      {/* ================================================================ */}
      {/* NOTIFICATIONS — user                                             */}
      {/* ================================================================ */}
      {showUser && <NotificationsSection token={token} />}

      {/* ================================================================ */}
      {/* PARENT — my children (parent only, user view)                   */}
      {/* ================================================================ */}
      {showUser && user?.role === 'parent' && childrenData && (
        <ParentChildrenSection
          data={childrenData}
          token={token}
          onChanged={updated => {
            setChildrenData(updated)
            if (onFeaturesChanged) onFeaturesChanged()
          }}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — feature visibility                                       */}
      {/* ================================================================ */}
      {showAdmin && featureVis && (
        <AdminFeatureSection
          featureVis={featureVis}
          token={token}
          onChanged={updated => {
            setFeatureVis(updated)
            if (onFeaturesChanged) onFeaturesChanged()
          }}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — family groups                                            */}
      {/* ================================================================ */}
      {showAdmin && familyGroups && (
        <FamilyGroupsSection
          data={familyGroups}
          token={token}
          onChanged={setFamilyGroups}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — Wake Word configuration                                  */}
      {/* ================================================================ */}
      {showAdmin && (
        <AdminWakeWordSection token={token} />
      )}

      {/* ================================================================ */}
      {/* ADMIN — model visibility                                         */}
      {/* ================================================================ */}
      {showAdmin && visibility && (
        <AdminVisibilitySection
          visibility={visibility}
          token={token}
          onChanged={updated => setVisibility(updated)}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — model families (Phase B)                                 */}
      {/* ================================================================ */}
      {showAdmin && (
        <AdminModelFamiliesSection token={token} />
      )}

      </div>
    </div>
  )
}

function AdminWakeWordSection({ token }) {
  const [form, setForm] = useState({ enabled: false, phrase: 'hey_river', sensitivity: 0.5 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    fetch('/api/settings/wake-word', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setForm({ enabled: data.enabled, phrase: data.phrase, sensitivity: data.sensitivity })
        setInstalled(data.installed)
        setLoading(false)
      })
  }, [token])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/settings/wake-word', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      })
      if (!res.ok) throw new Error('Save failed')
      setMsg('Settings saved. Refresh required for some changes.')
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Section title="AMBIENT LISTENING">
      {!installed && (
        <div className="settings-hint" style={{ color: 'var(--md-error)', marginBottom: 16 }}>
          The local ambient detection engine is currently offline. River cannot hear you until it is restored.
        </div>
      )}

      <Toggle 
        id="ww-admin-enabled"
        label="Enable Ambient Detection"
        checked={form.enabled}
        onChange={v => setForm({ ...form, enabled: v })}
      />

      <div style={{ marginTop: 20 }}>
        <label className="settings-label">WAKE PHRASE</label>
        <select 
          className="settings-select"
          value={form.phrase}
          onChange={e => setForm({ ...form, phrase: e.target.value })}
        >
          <option value="hey_river">Hey River (Default)</option>
          <option value="alexa">Alexa</option>
          <option value="hey_jarvis">Hey Jarvis</option>
          <option value="hey_mycroft">Hey Mycroft</option>
        </select>
        <p className="settings-hint">Select the phrase River will listen for in ambient mode.</p>
      </div>

      <div style={{ marginTop: 20 }}>
        <label className="settings-label">SENSITIVITY: {form.sensitivity}</label>
        <input 
          type="range" min="0.1" max="0.95" step="0.05"
          value={form.sensitivity}
          onChange={e => setForm({ ...form, sensitivity: Number(e.target.value) })}
          style={{ width: '100%', marginTop: 8 }}
        />
        <p className="settings-hint">Higher = more sensitive, but more false positives.</p>
      </div>

      <div className="profile-save-row" style={{ marginTop: 24 }}>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'SAVING...' : 'SAVE WAKE WORD CONFIG'}
        </button>
        {msg && <span className="profile-saved-msg">{msg}</span>}
      </div>
    </Section>
  )
}

// =============================================================================
// Voice Section — curated voice registry with install status + live switching
// =============================================================================

const QUALITY_LABELS = { fast: 'Fast', balanced: 'Balanced', high: 'High Quality' }
const ACCENT_ORDER   = ['American', 'British', 'British (Northern)']
const ENGINE_LABELS  = { piper: 'Piper', kokoro: 'Kokoro · CPU' }
const ENGINE_COLORS  = { piper: 'var(--md-outline)', kokoro: 'var(--md-tertiary)' }

async function playVoicePreview(voice_id, token) {
  const res = await fetch(`/api/tts/preview/${voice_id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || res.statusText)
  }
  const { audio_b64 } = await res.json()
  const binary = atob(audio_b64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const ctx    = new AudioContext()
  const buffer = await ctx.decodeAudioData(bytes.buffer)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return new Promise(resolve => { source.onended = () => { ctx.close(); resolve() } })
}

function VoiceSection({ voiceSettings, token, user, elevenLabsSettings, onSaveElevenLabs, onSwitched }) {
  const [switching, setSwitching] = useState(null)
  const [switchMsg, setSwitchMsg] = useState('')
  const [previewing, setPreviewing] = useState(null)
  const [previewErr, setPreviewErr] = useState('')
  const [accentFilter, setAccentFilter] = useState('ALL')

  if (voiceSettings.provider === 'none') {
    return (
      <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
        TTS is disabled. Set <code>TTS_PROVIDER=piper</code> in <code>.env</code> to enable speech.
      </p>
    )
  }

  const voices  = voiceSettings.voices || []
  const accents = [...new Set(voices.map(v => v.accent))]
    .sort((a, b) => (ACCENT_ORDER.indexOf(a) + 99) - (ACCENT_ORDER.indexOf(b) + 99))

  const handlePreview = async (voice_id) => {
    setPreviewing(voice_id)
    setPreviewErr('')
    try {
      await playVoicePreview(voice_id, token)
    } catch (e) {
      setPreviewErr(`Preview failed: ${e.message}`)
    } finally {
      setPreviewing(null)
    }
  }

  const handleSelect = async (voice_id) => {
    setSwitching(voice_id)
    setSwitchMsg('')
    try {
      const res = await fetch('/api/settings/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body:    JSON.stringify({ voice_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Switch failed')
      setSwitchMsg(`✓ Switched to ${data.display_name}.`)
      onSwitched()
    } catch (e) {
      setSwitchMsg(`✗ ${e.message}`)
    } finally {
      setSwitching(null)
    }
  }

  return (
    <>
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        <strong>{voiceSettings.provider_label}</strong> · Active:{' '}
        <span className="rs-pill is-active" style={{ fontSize: '0.75rem' }}>{voiceSettings.active_voice}</span>
      </p>

      {/* ELEVENLABS STATUS (Admin Only) — credentials live in .env */}
      {user?.role === 'admin' && elevenLabsSettings && (
        <div className="rs-card" style={{
          marginBottom: 24, padding: 16,
          background: 'var(--md-surface-container-high)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="rs-card-label" style={{ color: 'var(--md-primary)' }}>
              ELEVENLABS
            </div>
            <span className="rs-card-label" style={{ color: elevenLabsSettings.api_key ? '#4ade80' : 'var(--md-outline)' }}>
              {elevenLabsSettings.api_key ? '● KEY LOADED' : '○ NO KEY'}
            </span>
          </div>
          <p className="rs-card-meta" style={{ margin: 0 }}>
            Set <code>ELEVENLABS_API_KEY</code>, <code>ELEVENLABS_VOICE_ID</code>, and{' '}
            <code>ELEVENLABS_MODEL_ID</code> in <code>.env</code> to enable cloud voices.
            {voiceSettings.provider === 'elevenlabs' && (
              <span style={{ color: '#4ade80', marginLeft: 8 }}>● ACTIVE</span>
            )}
          </p>
        </div>
      )}

      {switchMsg && (
        <p className="rs-card-meta" style={{ color: switchMsg.startsWith('✓') ? '#4ade80' : 'var(--md-error)' }}>
          {switchMsg}
        </p>
      )}

      {previewErr && (
        <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
          {previewErr}
        </p>
      )}

      {/* ACCENT FILTER TABS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['ALL', ...accents].map(accent => (
          <button
            key={accent}
            onClick={() => setAccentFilter(accent)}
            className={`rs-pill ${accentFilter === accent ? 'is-active' : ''}`}
            style={{ fontSize: '0.7rem' }}
          >
            {accent}
          </button>
        ))}
      </div>

      {accents.filter(a => accentFilter === 'ALL' || a === accentFilter).map(accent => {
        const av      = voices.filter(v => v.accent === accent)
        const females = av.filter(v => v.gender === 'female')
        const males   = av.filter(v => v.gender === 'male')

        return (
          <div key={accent} style={{ marginBottom: 24 }}>
            <div className="rs-card-label" style={{ marginBottom: 12 }}>{accent}</div>

            {[{ label: 'Female', list: females, color: 'var(--md-tertiary)' },
              { label: 'Male',   list: males,   color: 'var(--md-primary)'  }]
              .filter(g => g.list.length > 0)
              .map(({ label, list, color }) => (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div className="rs-card-label" style={{ fontSize: '0.65rem', color, marginBottom: 8 }}>
                    {label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                    {list.map(v => (
                      <div
                        key={v.voice_id}
                        className={`rs-card is-tappable ${v.active ? 'is-elev' : ''} ${!v.installed ? 'is-disabled' : ''}`}
                        onClick={() => v.installed && !v.active && handleSelect(v.voice_id)}
                        style={{ opacity: v.installed ? 1 : 0.5, borderColor: v.active ? 'var(--primary)' : undefined }}
                      >
                        <div className="rs-card-value" style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>
                          {v.display_name}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                          <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                            {QUALITY_LABELS[v.quality] || v.quality}
                          </span>
                          <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                            {ENGINE_LABELS[v.engine] || v.engine}
                          </span>
                        </div>

                        <div className="rs-card-meta" style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
                          {v.description}
                        </div>

                        {v.installed && (
                          <button
                            onClick={e => { e.stopPropagation(); handlePreview(v.voice_id) }}
                            disabled={previewing === v.voice_id}
                            className="rs-pill"
                            style={{ marginTop: 12, fontSize: '0.7rem' }}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>{previewing === v.voice_id ? 'volume_up' : 'play_arrow'}</span>
                            {previewing === v.voice_id ? 'PLAYING…' : 'PREVIEW'}
                          </button>
                        )}

                        {!v.installed && <div className="rs-card-meta" style={{ color: 'var(--md-error)', fontWeight: 700 }}>NOT INSTALLED</div>}
                        {v.active && (
                          <div style={{ position: 'absolute', top: 12, right: 12 }}>
                             <span className="material-symbols-rounded" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>check_circle</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )
      })}
    </>
  )
}

function ParentChildrenSection({ data, token, onChanged }) {
  const [saving, setSaving] = useState(null)

  const toggle = async (child, featureKey) => {
    const current  = child.enabled_features || []
    const updated  = current.includes(featureKey)
      ? current.filter(k => k !== featureKey)
      : [...current, featureKey]

    const newChildren = data.children.map(c =>
      c.id === child.id ? { ...c, enabled_features: updated } : c
    )
    onChanged({ ...data, children: newChildren })
    setSaving(child.id)

    try {
      await fetch(`/api/parent/children/${child.id}/features`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ enabled_features: updated }),
      })
    } catch (e) {
      onChanged(data)
    } finally {
      setSaving(null)
    }
  }

  const globallyOn = new Set(data.globally_on || [])

  return (
    <Section title="MY CHILDREN">
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        Enable features for each child.
      </p>
      {(data.children || []).length === 0 && (
        <p className="rs-card-meta">No children linked yet.</p>
      )}
      {(data.children || []).map(child => (
        <div key={child.id} className="rs-card" style={{ background: 'var(--md-surface-container-low)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{child.display_name}</div>
            {saving === child.id && <span className="rs-card-label" style={{ color: 'var(--primary)' }}>SAVING…</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {(data.globally_on || []).map(key => {
              const enabled  = (child.enabled_features || []).includes(key)
              const locked   = !globallyOn.has(key)
              return (
                <div key={key} style={{ opacity: locked ? 0.4 : 1 }}>
                  <Toggle
                    id={`child-${child.id}-${key}`}
                    label={key.replace('_', ' ').toLowerCase()}
                    checked={enabled}
                    onChange={() => !locked && toggle(child, key)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </Section>
  )
}

function AdminFeatureSection({ featureVis, token, onChanged }) {
  const [saving, setSaving] = useState(false)

  const toggle = async (key) => {
    const current = featureVis.hidden_features || []
    const updated = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key]

    const next = {
      ...featureVis,
      hidden_features: updated,
      all_features: featureVis.all_features.map(f =>
        f.key === key ? { ...f, hidden: !f.hidden } : f
      ),
    }
    onChanged(next)
    setSaving(true)
    try {
      await fetch('/api/admin/feature-visibility', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ hidden_features: updated }),
      })
    } catch (e) {
      onChanged(featureVis)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="ADMIN — FEATURE VISIBILITY">
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        Hide features globally. Admin always sees everything.
        {saving && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>SAVING…</span>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {(featureVis.all_features || []).map(f => (
          <div key={f.key} className="rs-card" style={{ background: 'var(--md-surface-container-low)', padding: 12 }}>
            <Toggle
              id={`feat-vis-${f.key}`}
              label={f.label}
              checked={!f.hidden}
              onChange={() => toggle(f.key)}
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

// =============================================================================
// FamilyGroupsSection — admin manages shared-module family groups
// =============================================================================

const ALL_MODULES = [
  { key: 'culinary',    label: 'Culinary' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'store',       label: 'Store' },
  { key: 'maintenance', label: 'Maintenance' },
]

const RELATIONSHIPS = ['member', 'parent', 'child', 'spouse', 'guardian', 'other']

function FamilyGroupsSection({ data, token, onChanged }) {
  const groups = data.groups || []
  const users  = data.users  || []

  const [newName,    setNewName]    = useState('')
  const [creating,   setCreating]   = useState(false)
  const [working,    setWorking]    = useState(false)
  const [err,        setErr]        = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const reload = async () => {
    const r = await fetch('/api/admin/family-groups', {
      headers: { Authorization: `Bearer ${token}` },
    })
    onChanged(await r.json())
  }

  const createGroup = async () => {
    if (!newName.trim()) return
    setWorking(true); setErr('')
    try {
      const res = await fetch('/api/admin/family-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setNewName(''); setCreating(false)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const deleteGroup = async (id) => {
    if (!window.confirm('Delete this family group? Members will lose shared access.')) return
    setWorking(true); setErr('')
    try {
      await fetch(`/api/admin/family-groups/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const toggleModule = async (group, mod) => {
    const current = group.shared_modules || []
    const next = current.includes(mod) ? current.filter(m => m !== mod) : [...current, mod]
    setWorking(true); setErr('')
    try {
      const res = await fetch(`/api/admin/family-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shared_modules: next }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const renameGroup = async (group, name) => {
    if (!name.trim() || name.trim() === group.name) return
    setWorking(true); setErr('')
    try {
      await fetch(`/api/admin/family-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      })
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  return (
    <Section title="ADMIN — FAMILY GROUPS">
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        Family groups give multiple profiles shared data access to selected modules
        (culinary, inventory, store, maintenance). All members see and edit the
        same records. For controlling which features children can access, use
        Parental Controls below.
      </p>

      {err && <p style={{ color: 'var(--md-error)', fontSize: '0.8rem', marginBottom: 10 }}>{err}</p>}

      {/* Group list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {groups.length === 0 && !creating && (
          <p className="settings-hint">No family groups yet.</p>
        )}
        {groups.map(group => (
          <FamilyGroupCard
            key={group.id}
            group={group}
            users={users}
            token={token}
            expanded={expandedId === group.id}
            onToggleExpand={() => setExpandedId(expandedId === group.id ? null : group.id)}
            onDelete={() => deleteGroup(group.id)}
            onToggleModule={(mod) => toggleModule(group, mod)}
            onRename={(name) => renameGroup(group, name)}
            onMemberChange={reload}
            working={working}
          />
        ))}
      </div>

      {/* Create new group */}
      {creating ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="settings-input"
            placeholder="Group name (e.g. Smith Family)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGroup()}
            autoFocus
          />
          <button className="btn btn--primary" onClick={createGroup} disabled={working || !newName.trim()}
            style={{ padding: '6px 16px', fontSize: '0.8rem' }}>
            {working ? 'Creating…' : 'Create'}
          </button>
          <button className="btn btn--ghost" onClick={() => { setCreating(false); setNewName('') }}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn--secondary" onClick={() => setCreating(true)}
          style={{ padding: '6px 18px', fontSize: '0.8rem' }}>
          + New Family Group
        </button>
      )}
    </Section>
  )
}

function FamilyGroupCard({ group, users, token, expanded, onToggleExpand, onDelete, onToggleModule, onRename, onMemberChange, working }) {
  const [editName,    setEditName]    = useState(group.name)
  const [addUserId,   setAddUserId]   = useState('')
  const [addRelation, setAddRelation] = useState('member')
  const [addWorking,  setAddWorking]  = useState(false)
  const [addErr,      setAddErr]      = useState('')

  // Keep editName in sync if group.name changes from parent reload
  React.useEffect(() => { setEditName(group.name) }, [group.name])

  const memberIds = new Set((group.members || []).map(m => m.profile_id))
  const eligible  = users.filter(u => !memberIds.has(u.id))

  const addMember = async () => {
    if (!addUserId) return
    setAddWorking(true); setAddErr('')
    try {
      const res = await fetch(`/api/admin/family-groups/${group.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile_id: addUserId, relationship: addRelation }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      setAddUserId('')
      await onMemberChange()
    } catch (e) { setAddErr(e.message) }
    finally { setAddWorking(false) }
  }

  const removeMember = async (profileId) => {
    setAddWorking(true); setAddErr('')
    try {
      await fetch(`/api/admin/family-groups/${group.id}/members/${profileId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      await onMemberChange()
    } catch (e) { setAddErr(e.message) }
    finally { setAddWorking(false) }
  }

  return (
    <div style={{
      background: 'var(--md-surface-container)',
      border: '1px solid var(--md-outline-variant)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <div style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{group.name}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {ALL_MODULES.map(m => (
            <span key={m.key} style={{
              padding: '2px 8px', borderRadius: 12, fontSize: '0.72rem', fontWeight: 600,
              background: group.shared_modules?.includes(m.key) ? 'var(--md-primary-container)' : 'var(--md-surface-container-high)',
              color: group.shared_modules?.includes(m.key) ? 'var(--md-on-primary-container)' : 'var(--md-outline)',
            }}>
              {m.label}
            </span>
          ))}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--md-outline)' }}>
          {(group.members || []).length} member{(group.members || []).length !== 1 ? 's' : ''}
        </span>
        <button onClick={onToggleExpand}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-primary)', fontSize: '0.78rem', padding: '2px 8px' }}>
          {expanded ? 'Close' : 'Edit'}
        </button>
        <button onClick={onDelete} disabled={working}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-error)', fontSize: '0.78rem', padding: '2px 8px' }}>
          Delete
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--md-outline-variant)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Rename */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--md-outline)', minWidth: 60 }}>Name</label>
            <input className="settings-input" style={{ flex: 1 }} value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={() => onRename(editName)}
              onKeyDown={e => e.key === 'Enter' && onRename(editName)}
            />
          </div>

          {/* Module toggles */}
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--md-outline)', marginBottom: 8 }}>Shared Modules</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ALL_MODULES.map(m => {
                const on = group.shared_modules?.includes(m.key)
                return (
                  <button key={m.key} onClick={() => onToggleModule(m.key)} disabled={working}
                    style={{
                      padding: '5px 14px', borderRadius: 20, fontSize: '0.8rem', cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--md-primary)' : 'var(--md-outline-variant)'}`,
                      background: on ? 'var(--md-primary-container)' : 'var(--md-surface-container-high)',
                      color: on ? 'var(--md-on-primary-container)' : 'var(--md-on-surface-variant)',
                      fontWeight: on ? 600 : 400,
                    }}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Members */}
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--md-outline)', marginBottom: 8 }}>Members</div>
            {(group.members || []).length === 0 && (
              <p className="settings-hint" style={{ margin: '0 0 8px' }}>No members yet.</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {(group.members || []).map(m => (
                <div key={m.profile_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem',
                  padding: '6px 10px', background: 'var(--md-surface-container-high)', borderRadius: 8,
                }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{m.display_name}</span>
                  <span style={{ color: 'var(--md-outline)', fontSize: '0.75rem' }}>{m.email}</span>
                  <span style={{
                    padding: '1px 8px', borderRadius: 12, fontSize: '0.7rem',
                    background: 'var(--md-secondary-container)', color: 'var(--md-on-secondary-container)',
                  }}>{m.relationship}</span>
                  <button onClick={() => removeMember(m.profile_id)} disabled={addWorking}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--md-error)', fontSize: '0.75rem' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            {/* Add member row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="settings-select" value={addUserId} onChange={e => setAddUserId(e.target.value)}>
                <option value="">— add member —</option>
                {eligible.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
                ))}
              </select>
              <select className="settings-select" value={addRelation} onChange={e => setAddRelation(e.target.value)}>
                {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
              </select>
              <button className="btn btn--primary" onClick={addMember} disabled={addWorking || !addUserId}
                style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                {addWorking ? 'Adding…' : 'Add'}
              </button>
            </div>
            {addErr && <p style={{ color: 'var(--md-error)', fontSize: '0.78rem', marginTop: 6 }}>{addErr}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// AdminFamilySection — admin assigns parent-child relationships
// =============================================================================

function AdminFamilySection({ data, token, onChanged }) {
  const [parentSel, setParentSel] = useState('')
  const [childSel,  setChildSel]  = useState('')
  const [working,   setWorking]   = useState(false)
  const [err,       setErr]       = useState('')

  const users    = data.users    || []
  const links    = data.links    || []
  const parents  = users.filter(u => ['parent', 'user', 'admin'].includes(u.role))
  const children = users.filter(u => u.role === 'child')

  const linked = (parentId, childId) =>
    links.some(l => l.parent_id === parentId && l.child_id === childId)

  const addLink = async () => {
    if (!parentSel || !childSel) return
    setWorking(true); setErr('')
    try {
      const res = await fetch('/api/admin/family', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ parent_id: parentSel, child_id: childSel }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      const r = await fetch('/api/admin/family', { headers: { Authorization: `Bearer ${token}` } })
      onChanged(await r.json())
      setParentSel(''); setChildSel('')
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  const removeLink = async (parentId, childId) => {
    setWorking(true); setErr('')
    try {
      await fetch(`/api/admin/family/${parentId}/${childId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const r = await fetch('/api/admin/family', { headers: { Authorization: `Bearer ${token}` } })
      onChanged(await r.json())
    } catch (e) { setErr(e.message) }
    finally { setWorking(false) }
  }

  return (
    <Section title="ADMIN — PARENTAL CONTROLS">
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        Link parent accounts to child accounts to control which features children
        can access. This is separate from Family Groups — parental controls manage
        feature visibility only, not shared data.
      </p>

      {/* Add link */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select className="settings-select" value={parentSel} onChange={e => setParentSel(e.target.value)}>
          <option value="">— select parent —</option>
          {parents.map(u => (
            <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
          ))}
        </select>
        <span style={{ color: 'var(--md-outline)', fontSize: '0.85rem' }}>→</span>
        <select className="settings-select" value={childSel} onChange={e => setChildSel(e.target.value)}>
          <option value="">— select child —</option>
          {children.map(u => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
        <button
          className="btn btn--primary"
          onClick={addLink}
          disabled={!parentSel || !childSel || working}
          style={{ padding: '6px 16px', fontSize: '0.8rem' }}
        >
          {working ? 'Saving…' : 'Link'}
        </button>
      </div>
      {err && <p style={{ color: 'var(--md-error)', fontSize: '0.8rem', marginBottom: 8 }}>{err}</p>}

      {/* Existing links */}
      {links.length === 0 && (
        <p className="settings-hint">No parent-child links yet.</p>
      )}
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {links.map(l => {
            const parent = users.find(u => u.id === l.parent_id)
            const child  = users.find(u => u.id === l.child_id)
            return (
              <div key={`${l.parent_id}-${l.child_id}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 10px',
                background: 'var(--md-surface-container)',
                borderRadius: 8, fontSize: '0.82rem',
              }}>
                <span style={{ flex: 1 }}>
                  <strong>{parent?.display_name || l.parent_id}</strong>
                  <span style={{ color: 'var(--md-outline)', margin: '0 6px' }}>→</span>
                  <strong>{child?.display_name || l.child_id}</strong>
                </span>
                <button
                  onClick={() => removeLink(l.parent_id, l.child_id)}
                  disabled={working}
                  style={{ fontSize: '0.72rem', color: 'var(--md-error)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// =============================================================================
// AdminVisibilitySection — admin-only global show/hide for voices + LLM models
// =============================================================================

const PROVIDER_DISPLAY = {
  anthropic:  'Anthropic',
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  mistral_ai: 'Mistral AI',
  ollama:     'Ollama (local)',
}

function AdminVisibilitySection({ visibility, token, onChanged }) {
  const [saving, setSaving] = useState(false)

  const toggle = async (type, id) => {
    const field = type === 'voice' ? 'hidden_voices' : 'hidden_llms'
    const current = visibility[field] || []
    const updated = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]

    const next = { ...visibility, [field]: updated }
    onChanged(next)
    setSaving(true)

    try {
      await fetch('/api/admin/model-visibility', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ hidden_voices: next.hidden_voices, hidden_llms: next.hidden_llms }),
      })
    } catch (e) {
      console.error('[Admin] visibility save failed:', e)
      onChanged(visibility)
    } finally {
      setSaving(false)
    }
  }

  const allVoices = visibility.all_voices || []
  const allLlms   = visibility.all_llms   || []

  const voiceAccents = [...new Set(allVoices.map(v => v.accent))]
  const llmProviders = [...new Set(allLlms.map(m => m.provider))]

  return (
    <Section title="ADMIN — MODEL VISIBILITY">
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        Toggle models off to hide them globally for all users. Hidden models cannot
        be selected but their settings are preserved.
        {saving && <span style={{ marginLeft: 8, color: 'var(--md-primary)' }}>Saving…</span>}
      </p>

      {/* ── Voices ── */}
      <h3 className="model-group-title" style={{ marginBottom: 8 }}>
        <span className="model-group-badge model-group-badge--local">VOICE</span>
        Voice Models
      </h3>
      {voiceAccents.map(accent => {
        const group = allVoices.filter(v => v.accent === accent)
        return (
          <div key={accent} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--md-outline)', letterSpacing: '0.08em', marginBottom: 4 }}>
              {accent.toUpperCase()}
            </div>
            <div className="settings-grid">
              {group.map(v => {
                const hidden = (visibility.hidden_voices || []).includes(v.voice_id)
                return (
                  <label key={v.voice_id} className="toggle-row" style={{ opacity: hidden ? 0.5 : 1 }}>
                    <span className="toggle-label" style={{ fontSize: '0.8rem' }}>
                      {v.display_name}
                      {!v.installed && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--md-outline)', marginLeft: 5 }}>not installed</span>
                      )}
                    </span>
                    <button
                      role="switch"
                      aria-checked={!hidden}
                      className={`toggle-switch ${!hidden ? 'toggle-switch--on' : ''}`}
                      onClick={() => toggle('voice', v.voice_id)}
                    >
                      <span className="toggle-knob" />
                    </button>
                    <span className="toggle-value">{hidden ? 'HIDDEN' : 'VISIBLE'}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* ── LLM Models ── */}
      <h3 className="model-group-title" style={{ marginTop: 20, marginBottom: 8 }}>
        <span className="model-group-badge model-group-badge--cloud">AI</span>
        AI Models
      </h3>
      {llmProviders.map(provider => {
        const group = allLlms.filter(m => m.provider === provider)
        return (
          <div key={provider} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--md-outline)', letterSpacing: '0.08em', marginBottom: 4 }}>
              {(PROVIDER_DISPLAY[provider] || provider).toUpperCase()}
            </div>
            <div className="settings-grid">
              {group.map(m => {
                const hidden = (visibility.hidden_llms || []).includes(m.model_id)
                return (
                  <label key={m.model_id} className="toggle-row" style={{ opacity: hidden ? 0.5 : 1 }}>
                    <span className="toggle-label" style={{ fontSize: '0.8rem' }}>{m.display_name}</span>
                    <button
                      role="switch"
                      aria-checked={!hidden}
                      className={`toggle-switch ${!hidden ? 'toggle-switch--on' : ''}`}
                      onClick={() => toggle('llm', m.model_id)}
                    >
                      <span className="toggle-knob" />
                    </button>
                    <span className="toggle-value">{hidden ? 'HIDDEN' : 'VISIBLE'}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

// =============================================================================
// AdminModelFamiliesSection — Phase B: toggle / rename / remap families that
// appear in the Chat picker. Defaults live in utils/modelFamilies.js; overrides
// persist to admin_config["model_families"] and ride along with /api/models.
// =============================================================================

function AdminModelFamiliesSection({ token }) {
  const [overrides, setOverrides] = useState({})
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState('')

  useEffect(() => {
    fetch('/api/settings/model-families', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { families: {} })
      .then(data => {
        setOverrides(data.families || {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [token])

  const update = (familyId, patch) => {
    setOverrides(prev => ({
      ...prev,
      [familyId]: { ...(prev[familyId] || {}), ...patch },
    }))
  }
  const updateTier = (familyId, tier, value) => {
    setOverrides(prev => ({
      ...prev,
      [familyId]: {
        ...(prev[familyId] || {}),
        tiers: { ...(prev[familyId]?.tiers || {}), [tier]: value || null },
      },
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/settings/model-families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ families: overrides }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMsg('Saved. Reload Chat to see updates.')
    } catch (e) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Section title="ADMIN — MODEL FAMILIES">
      <p className="settings-hint" style={{ marginBottom: 12 }}>
        Toggle which families appear in the Chat picker, give them quirky names, and
        override the model_id each tier maps to. Leave any field blank to use the default.
        Overrides are not validated against the registry — invalid model_ids just show
        as unavailable in the picker.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {MODEL_FAMILIES.map(family => {
          const ov = overrides[family.id] || {}
          const enabled = ov.enabled !== false  // default true
          return (
            <div
              key={family.id}
              className="rs-card"
              style={{ padding: 12, opacity: enabled ? 1 : 0.55 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                    {family.displayName}
                    {ov.quirky_name && (
                      <span style={{ marginLeft: 8, fontWeight: 400, fontSize: '0.8rem', color: 'var(--md-primary)' }}>
                        → {ov.quirky_name}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--md-outline)' }}>
                    {family.provider} · {family.blurb}
                  </div>
                </div>
                <Toggle
                  checked={enabled}
                  onChange={v => update(family.id, { enabled: v })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                <label style={{ fontSize: '0.72rem' }}>
                  <span style={{ display: 'block', color: 'var(--md-outline)', marginBottom: 2 }}>
                    Quirky name
                  </span>
                  <input
                    type="text"
                    className="settings-input"
                    placeholder={family.displayName}
                    value={ov.quirky_name || ''}
                    onChange={e => update(family.id, { quirky_name: e.target.value || null })}
                    style={{ width: '100%' }}
                    disabled={!enabled}
                  />
                </label>

                {TIER_ORDER.map(tier => (
                  <label key={tier} style={{ fontSize: '0.72rem' }}>
                    <span style={{ display: 'block', color: 'var(--md-outline)', marginBottom: 2 }}>
                      {TIER_META[tier].label} model_id
                    </span>
                    <input
                      type="text"
                      className="settings-input"
                      placeholder={family.tiers[tier] || '(not mapped)'}
                      value={ov.tiers?.[tier] || ''}
                      onChange={e => updateTier(family.id, tier, e.target.value)}
                      style={{ width: '100%' }}
                      disabled={!enabled}
                    />
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="profile-save-row" style={{ marginTop: 16 }}>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
          {saving ? 'SAVING...' : 'SAVE FAMILY OVERRIDES'}
        </button>
        {msg && <span className="profile-saved-msg">{msg}</span>}
      </div>
    </Section>
  )
}

// =============================================================================
// NotificationsSection — manage Web Push subscriptions
// =============================================================================

function NotificationsSection({ token }) {
  const [status, setStatus] = useState('loading')
  const [working, setWorking] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [serverEnabled, setServerEnabled] = useState(true)

  useEffect(() => {
    // 1. Check server support
    fetch(`${API_BASE}/api/push/vapid-public-key`)
      .then(r => r.json())
      .then(data => {
        if (!data.public_key) setServerEnabled(false)
      })
      .catch(() => setServerEnabled(false))

    // 2. Check current browser subscription
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }

    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setStatus(sub ? 'subscribed' : 'idle')
      })
    })
  }, [])

  const handleToggle = async (val) => {
    setWorking(true)
    if (val) {
      const res = await registerPushNotifications(API_BASE)
      setStatus(res.status === 'subscribed' ? 'subscribed' : 'idle')
    } else {
      const res = await unregisterPushNotifications(API_BASE)
      setStatus('idle')
    }
    setWorking(false)
  }

  const handleTest = async () => {
    setWorking(true)
    setTestResult('')
    try {
      const res = await fetch(`${API_BASE}/api/push/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setTestResult(`Sent to ${data.sent} device(s).`)
    } catch (err) {
      setTestResult('Failed to send test push.')
    } finally {
      setWorking(false)
    }
  }

  if (!serverEnabled) {
    return (
      <Section title="NOTIFICATIONS">
        <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
          Push notifications are disabled in server config. Set <code>PUSH_NOTIFICATIONS_ENABLED=true</code> in <code>.env</code>.
        </p>
      </Section>
    )
  }

  return (
    <Section title="NOTIFICATIONS">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600 }}>PUSH NOTIFICATIONS</div>
          <p className="rs-card-meta">Receive proactive briefings and system alerts.</p>
        </div>
        <Toggle 
          id="push-toggle"
          checked={status === 'subscribed'}
          onChange={handleToggle}
          disabled={working || status === 'unsupported' || status === 'loading'}
        />
      </div>

      <p className="rs-card-meta" style={{ marginTop: 8 }}>
        {status === 'subscribed' && '✓ This device is active and receiving alerts.'}
        {status === 'idle' && 'Notifications are currently muted for this device.'}
        {status === 'unsupported' && '✗ Web Push is not supported by your browser.'}
        {status === 'loading' && 'Checking status…'}
      </p>

      {status === 'subscribed' && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="rs-pill"
            onClick={handleTest}
            disabled={working}
          >
            {working ? 'SENDING…' : 'TEST NOTIFICATION'}
          </button>
          {testResult && <span className="rs-card-label" style={{ color: '#4ade80' }}>{testResult}</span>}
        </div>
      )}
    </Section>
  )
}


function TokenUsageSection({ token }) {
  const [data,    setData]    = useState(null)
  const [days,    setDays]    = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/usage/tokens?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, days])

  function fmtTokens(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  function fmtCostUsd(n) {
    if (n === 0) return 'FREE'
    if (n < 0.01) return `$${n.toFixed(4)}`
    return `$${n.toFixed(2)}`
  }

  return (
    <Section title="TOKEN USAGE">
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <span className="rs-card-label">PERIOD</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 30, 90].map(d => (
            <button
              key={d}
              className={`rs-pill ${days === d ? 'is-active' : ''}`}
              style={{ fontSize: '0.7rem' }}
              onClick={() => setDays(d)}
            >{d}D</button>
          ))}
        </div>
      </div>

      {loading && <p className="rs-card-meta">Loading usage statistics…</p>}

      {!loading && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 24, marginBottom: 24 }}>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>INPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_input)}</div>
            </div>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>OUTPUT</div>
              <div className="rs-card-value">{fmtTokens(data.total_output)}</div>
            </div>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>EST. COST</div>
              <div className="rs-card-value" style={{ color: data.estimated_cost_usd > 0 ? 'var(--primary)' : '#4ade80' }}>
                {fmtCostUsd(data.estimated_cost_usd)}
              </div>
            </div>
          </div>

          {data.by_model.length === 0 ? (
            <p className="rs-card-meta">No usage recorded yet.</p>
          ) : (
            <div className="rs-card" style={{ padding: 0, overflow: 'hidden', background: 'var(--md-surface-container-low)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'var(--md-surface-container-high)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 16px' }} className="rs-card-label">MODEL</th>
                    <th style={{ textAlign: 'right', padding: '12px 16px' }} className="rs-card-label">CALLS</th>
                    <th style={{ textAlign: 'right', padding: '12px 16px' }} className="rs-card-label">COST</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_model.map((row, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--md-outline-variant)' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600 }}>{row.model}</div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>{row.provider.toUpperCase()}</div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>{row.calls}</td>
                      <td style={{ textAlign: 'right', padding: '12px 16px', color: row.estimated_cost_usd > 0 ? 'var(--primary)' : '#4ade80', fontWeight: 600 }}>
                        {fmtCostUsd(row.estimated_cost_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="rs-card-meta" style={{ marginTop: 12 }}>
            Cost estimates use public list prices. Ollama (local) is always free.
          </p>
        </>
      )}
    </Section>
  )
}


function VoiceIDSection({ token }) {
  const [status, setStatus] = useState(null)
  const [recording, setRecording] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/voice-id/me', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setStatus(await res.json())
    } catch (e) {
      console.error('Failed to fetch Voice ID status:', e)
    }
  }, [token])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const onComplete = useCallback(async (wavB64) => {
    setRecording(false)
    setCountdown(0)
    setError('')
    setSuccess('')
    
    try {
      const binary = atob(wavB64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const blob = new Blob([array], { type: 'audio/wav' })

      const formData = new FormData()
      formData.append('file', blob, 'sample.wav')
      
      const res = await fetch('/api/voice-id/enroll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      
      if (!res.ok) {
        const txt = await res.text()
        setError('Enrollment failed: ' + txt)
        return
      }
      
      const result = await res.json()
      setSuccess(`Sample added. You now have ${result.sample_count} samples.`)
      await refreshStatus()
    } catch (e) {
      setError('Enrollment error: ' + e.message)
    }
  }, [token, refreshStatus])

  const recorder = useAudioRecorder({ onComplete })

  const startEnroll = async () => {
    setError('')
    setSuccess('')
    const ok = await recorder.startRecording()
    if (!ok) {
      setError('Could not start microphone.')
      return
    }

    setRecording(true)
    let left = 5
    setCountdown(left)
    const interval = setInterval(() => {
      left -= 1
      setCountdown(left)
      if (left <= 0) {
        clearInterval(interval)
        recorder.stopRecording()
      }
    }, 1000)
  }

  const deleteEnrollment = async () => {
    if (!confirm('Delete your voice prints? River Song will no longer recognize your voice.')) return
    try {
      await fetch('/api/voice-id/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      await refreshStatus()
      setSuccess('Enrollment deleted.')
    } catch (e) {
      setError('Delete failed: ' + e.message)
    }
  }

  if (!status) return null

  return (
    <Section title="VOICE ID">
      <div style={{ marginBottom: 16 }}>
        {status.enrolled ? (
          <div style={{ color: '#4ade80', fontSize: '0.875rem', fontWeight: 600 }}>
            ✓ ENROLLED — {status.sample_count} SAMPLES
            <div className="rs-card-meta">
              Last updated: {new Date(status.last_updated).toLocaleString()}
            </div>
          </div>
        ) : (
          <p className="rs-card-meta">
            River Song doesn't recognize your voice yet. Record 3–5 samples to enable speaker recognition on kiosks.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button 
          className="rs-btn-primary" 
          onClick={startEnroll} 
          disabled={recording || recorder.isRecording}
          style={{ padding: '10px 20px' }}
        >
          <span className="material-symbols-rounded">{recording ? 'radio_button_checked' : 'mic'}</span>
          {recording ? `RECORDING... ${countdown}S` : 'RECORD SAMPLE'}
        </button>

        {status.sample_count > 0 && !recording && (
          <button className="rs-pill" onClick={deleteEnrollment} style={{ color: 'var(--md-error)' }}>
            DELETE ENROLLMENT
          </button>
        )}
      </div>

      {error && <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{error}</div>}
      {success && <div className="rs-card-meta" style={{ color: '#4ade80' }}>{success}</div>}

      <p className="rs-card-meta">
        Recommended: at least 3 samples of about 5 seconds each.
      </p>
    </Section>
  )
}
