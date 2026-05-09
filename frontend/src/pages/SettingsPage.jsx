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

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { registerPushNotifications } from '../utils/pushNotifications'

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
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Model card
// ---------------------------------------------------------------------------
function ModelCard({ model, isSelected, isDisabled, onSelect }) {
  const inputCost  = fmtCost(model.cost_per_1k_input_usd)
  const outputCost = fmtCost(model.cost_per_1k_output_usd)

  return (
    <button
      className={`model-card ${isSelected ? 'model-card--selected' : ''} ${isDisabled ? 'model-card--disabled' : ''}`}
      onClick={() => !isDisabled && onSelect(model)}
      disabled={isDisabled}
      aria-pressed={isSelected}
      title={model.notes || undefined}
    >
      <div className="model-card-name">{model.display_name}</div>

      {model.vram_gb != null && (
        <div className="model-card-meta">
          {model.vram_gb <= 4
            ? <span className="badge badge--gpu">⚡ GPU {model.vram_gb}GB</span>
            : <span className="badge badge--cpu">RAM {model.vram_gb}GB</span>
          }
          {model.vram_gb <= 4 && (
            <span className="badge badge--speak" title="Fits in GPU VRAM — works for Speak">SPEAK</span>
          )}
        </div>
      )}

      {model.is_cloud && (
        <div className="model-card-meta">
          {inputCost && <span className="badge badge--cost">in {inputCost}</span>}
          {outputCost && <span className="badge badge--cost">out {outputCost}</span>}
        </div>
      )}

      {model.is_cloud && isDisabled && (
        <div className="model-card-locked">KEY REQUIRED</div>
      )}

      {isSelected && (
        <div className="model-card-active-dot" aria-label="Active" />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------
function Toggle({ checked, onChange, label, id }) {
  return (
    <label className="toggle-row" htmlFor={id}>
      <span className="toggle-label">{label}</span>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
      <span className="toggle-value">{checked ? 'ON' : 'OFF'}</span>
    </label>
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

export default function SettingsPage({ onFeaturesChanged }) {
  const { user, token } = useAuth()

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
    ]
    if (user?.role === 'admin') {
      fetches.push(
        fetch(`${API_BASE}/api/admin/model-visibility`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/feature-visibility`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/family`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/admin/family-groups`, { headers }).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/settings/orchestration`, { headers }).then(r => r.json()).catch(() => null),
      )
    }
    if (user?.role === 'parent') {
      fetches.push(
        null, null, null, null, // pad to keep indices consistent
        fetch(`${API_BASE}/api/parent/children`, { headers }).then(r => r.json()).catch(() => null),
      )
    }

    Promise.all(fetches)
      .then(([modData, llmData, memData, voiceData, visData, featVisData, familyRaw, familyGroupsRaw, orchData, childrenRaw]) => {
        setModels({ local: modData.local || [], cloud: modData.cloud || [] })
        setEnabledProviders(modData.enabled_providers || {})
        setLlmSettings(llmData)
        setMemSettings(memData)
        setVoiceSettings(voiceData)
        if (visData)          setVisibility(visData)
        if (featVisData)      setFeatureVis(featVisData)
        if (familyRaw)        setFamilyData(familyRaw)
        if (familyGroupsRaw)  setFamilyGroups(familyGroupsRaw)
        if (orchData)         setOrchestrationSettings(orchData)
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
    <div className="settings-page page-wrap">
      {/* CSS for recommended strip */}
      <style>{`
        .model-recommended-strip {
          display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px;
          padding: 12px 14px;
          background: color-mix(in srgb, var(--md-tertiary) 6%, transparent);
          border: 1px solid color-mix(in srgb, var(--md-tertiary) 20%, transparent);
          border-radius: var(--md-shape-md);
        }
      `}</style>

      <div className="page-breadcrumb">
        <span>◢</span><span>SYSTEM</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>CONFIGURATION</span>
      </div>
      <h1 className="page-title" style={{ marginBottom: 22 }}>Settings</h1>

      {/* Save status toast */}
      {saveStatus && (
        <div className={`save-toast save-toast--${saveStatus}`} aria-live="polite">
          {saveStatus === 'saving' && '● SAVING…'}
          {saveStatus === 'saved'  && '✓ SAVED'}
          {saveStatus === 'error'  && '✗ ERROR — CHECK CONSOLE'}
        </div>
      )}

      
      {/* ================================================================ */}
      {/* ORCHESTRATION                                                   */}
      {/* ================================================================ */}
      {orchestrationSettings && user?.role === "admin" && (
        <Section title="ORCHESTRATION (n8n)">
          <Toggle
            id="n8n-toggle"
            label="Enable n8n integration"
            checked={orchestrationSettings.n8n_enabled}
            onChange={v => saveOrchestration({ n8n_enabled: v })}
          />
          <label className="select-row">
            <span className="select-label">n8n URL</span>
            <input
              type="text"
              className="settings-input"
              value={orchestrationSettings.n8n_url}
              onChange={e => saveOrchestration({ n8n_url: e.target.value })}
            />
          </label>
          <label className="select-row">
            <span className="select-label">n8n API Key</span>
            <input
              type="password"
              className="settings-input"
              value={orchestrationSettings.n8n_api_key}
              placeholder="••••••••"
              onChange={e => saveOrchestration({ n8n_api_key: e.target.value })}
            />
          </label>
          <label className="select-row">
            <span className="select-label">n8n Webhook Secret</span>
            <input
              type="text"
              className="settings-input"
              value={orchestrationSettings.n8n_webhook_secret}
              onChange={e => saveOrchestration({ n8n_webhook_secret: e.target.value })}
            />
          </label>
          <p className="settings-hint">
            n8n handles complex multi-step routines. The webhook secret is required
            to validate incoming requests from n8n to River Song.
          </p>
        </Section>
      )}
    
      {/* ================================================================ */}
      {/* AI MODEL                                                         */}
      {/* ================================================================ */}
      <Section title="AI MODEL">
        <p className="settings-hint" style={{ marginBottom: 16 }}>
          The selected model is used for both Chat and Speak. For Speak, choose a model
          tagged <strong>⚡ GPU / SPEAK</strong> — these fit in your GPU's VRAM and respond
          faster for real-time voice conversation.
        </p>

        {/* RECOMMENDED STRIP */}
        {recommendedModels.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.08em', color: 'var(--md-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>
              ⚡ RECOMMENDED FOR SPEAK
            </div>
            <div className="model-recommended-strip">
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
        <div className="model-group">
          {/* QUICK FILTER BAR */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {['ALL', 'GPU', 'RAM', 'SPEAK'].map(f => (
              <button
                key={f}
                onClick={() => setModelFilter(f)}
                style={{
                  padding: '3px 12px',
                  borderRadius: 'var(--md-shape-full)',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  border: modelFilter === f ? 'none' : '1px solid var(--md-outline-variant)',
                  background: modelFilter === f ? 'var(--md-primary-container)' : 'transparent',
                  color: modelFilter === f ? 'var(--md-on-primary-container)' : 'var(--md-on-surface-variant)',
                  marginRight: 4
                }}
              >
                {f}
              </button>
            ))}
          </div>

          <h3 className="model-group-title">
            <span className="model-group-badge model-group-badge--local">LOCAL</span>
            Ollama — runs on your machine
          </h3>
          <div className="model-grid">
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
        <div className="model-group">
          <h3 className="model-group-title">
            <span className="model-group-badge model-group-badge--cloud">CLOUD</span>
            API providers — costs per token · requires API key in .env
          </h3>

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
              <div key={providerKey} className={`cloud-provider-group ${!enabled ? 'cloud-provider-group--locked' : ''}`}>
                <div className="cloud-provider-header">
                  <span className="cloud-provider-name">{providerNames[providerKey]}</span>
                  {!enabled && (
                    <span className="cloud-provider-status">
                      Set {providerKey.toUpperCase()}_ENABLED=true + API key in .env to unlock
                    </span>
                  )}
                  {enabled && (
                    <span className="cloud-provider-status cloud-provider-status--on">ENABLED</span>
                  )}
                </div>
                <div className="model-grid">
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

      {/* ================================================================ */}
      {/* CLOUD FALLBACK                                                   */}
      {/* ================================================================ */}
      <Section title="CLOUD FALLBACK">
        <p className="settings-hint" style={{ marginBottom: 12 }}>
          When the primary model is unavailable or overloaded, River can automatically
          fall back to a cloud provider. Requires the provider's API key in <code>.env</code>.
        </p>

        <Toggle
          id="fallback-toggle"
          label="Enable cloud fallback"
          checked={!!(llmSettings?.cloud_fallback_enabled)}
          onChange={v => saveFallback({ cloud_fallback_enabled: v })}
        />

        {llmSettings?.cloud_fallback_enabled && (
          <div className="fallback-config">
            <label className="select-row">
              <span className="select-label">Fallback provider</span>
              <select
                className="settings-select"
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
            </label>

            {llmSettings?.cloud_fallback_provider && (
              <label className="select-row">
                <span className="select-label">Fallback model</span>
                <select
                  className="settings-select"
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
              </label>
            )}
          </div>
        )}
      </Section>

      {/* ================================================================ */}
      {/* VOICE                                                            */}
      {/* ================================================================ */}
      <Section title="VOICE">
        {voiceSettings ? (
          <VoiceSection
            voiceSettings={voiceSettings}
            token={token}
            onSwitched={() => {
              const headers = token ? { Authorization: `Bearer ${token}` } : {}
              fetch(`${API_BASE}/api/settings/voice`, { headers })
                .then(r => r.json()).then(setVoiceSettings).catch(() => {})
            }}
          />
        ) : (
          <div className="voice-option">
            <div className="voice-option-name">Loading voices…</div>
          </div>
        )}
      </Section>

      {/* ================================================================ */}
      {/* MEMORY                                                           */}
      {/* ================================================================ */}
      {memSettings && (
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

          <label className="select-row">
            <span className="select-label">Default retention period</span>
            <select
              className="settings-select"
              value={memSettings.default_ttl}
              onChange={e => saveMemory({ default_ttl: e.target.value })}
            >
              {(memSettings.ttl_options || ['short','standard','extended','long','forever']).map(opt => (
                <option key={opt} value={opt}>
                  {TTL_LABELS[opt] || opt}
                </option>
              ))}
            </select>
          </label>

          <p className="settings-hint">
            Summaries are 2–3 sentence records of each conversation, injected into context
            at session start. Auto-extend resets the expiry each time a summary is referenced,
            keeping frequently-relevant memories alive naturally.
          </p>
        </Section>
      )}

      {/* ================================================================ */}
      {/* NOTIFICATIONS                                                    */}
      {/* ================================================================ */}
      <NotificationsSection token={token} />

      {/* ================================================================ */}
      {/* PARENT — my children (parent only)                              */}
      {/* ================================================================ */}
      {user?.role === 'parent' && childrenData && (
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
      {/* ADMIN — feature visibility (admin only)                         */}
      {/* ================================================================ */}
      {user?.role === 'admin' && featureVis && (
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
      {/* ADMIN — family groups (admin only)                              */}
      {/* ================================================================ */}
      {user?.role === 'admin' && familyGroups && (
        <FamilyGroupsSection
          data={familyGroups}
          token={token}
          onChanged={setFamilyGroups}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — family management (admin only)                          */}
      {/* ================================================================ */}
      {user?.role === 'admin' && familyData && (
        <AdminFamilySection
          data={familyData}
          token={token}
          onChanged={setFamilyData}
        />
      )}

      {/* ================================================================ */}
      {/* ADMIN — model visibility (admin only)                            */}
      {/* ================================================================ */}
      {user?.role === 'admin' && visibility && (
        <AdminVisibilitySection
          visibility={visibility}
          token={token}
          onChanged={updated => setVisibility(updated)}
        />
      )}

    </div>
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

function VoiceSection({ voiceSettings, token, onSwitched }) {
  const [switching, setSwitching] = useState(null)
  const [switchMsg, setSwitchMsg] = useState('')
  const [previewing, setPreviewing] = useState(null)
  const [previewErr, setPreviewErr] = useState('')
  const [accentFilter, setAccentFilter] = useState('ALL')

  if (voiceSettings.provider === 'none') {
    return (
      <p className="settings-hint" style={{ color: 'var(--md-error)' }}>
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
      setSwitchMsg(`✓ Switched to ${data.display_name}. Active on your next conversation.`)
      onSwitched()
    } catch (e) {
      setSwitchMsg(`✗ ${e.message}`)
    } finally {
      setSwitching(null)
    }
  }

  return (
    <>
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        <strong>{voiceSettings.provider_label}</strong> · Active:{' '}
        <strong>{voiceSettings.active_voice}</strong>
        {voiceSettings.active_voice_id && (
          <span style={{ color: 'var(--md-outline)', fontSize: '0.8rem', marginLeft: 8 }}>
            ({voiceSettings.active_voice_id})
          </span>
        )}
      </p>

      {switchMsg && (
        <p className="settings-hint" style={{
          marginBottom: 8,
          color: switchMsg.startsWith('✓') ? 'var(--md-tertiary)' : 'var(--md-error)',
        }}>
          {switchMsg}
        </p>
      )}

      {previewErr && (
        <p className="settings-hint" style={{ marginBottom: 8, color: 'var(--md-error)' }}>
          {previewErr}
        </p>
      )}

      {/* ACCENT FILTER TABS */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, overflowX: 'auto' }}>
        {['ALL', ...accents].map(accent => (
          <button
            key={accent}
            onClick={() => setAccentFilter(accent)}
            style={{
              padding: '4px 14px',
              borderRadius: 'var(--md-shape-full)',
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.06em',
              cursor: 'pointer',
              border: accentFilter === accent ? 'none' : '1px solid var(--md-outline-variant)',
              background: accentFilter === accent ? 'var(--md-secondary-container)' : 'transparent',
              color: accentFilter === accent ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface-variant)',
            }}
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
          <div key={accent} className="model-group" style={{ marginBottom: 20 }}>
            <h3 className="model-group-title">{accent}</h3>

            {[{ label: 'Female', list: females, color: 'var(--md-tertiary)' },
              { label: 'Male',   list: males,   color: 'var(--md-primary)'  }]
              .filter(g => g.list.length > 0)
              .map(({ label, list, color }) => (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.06em',
                    color, textTransform: 'uppercase', marginBottom: 6 }}>
                    {label}
                  </div>
                  <div className="model-grid">
                    {list.map(v => (
                      <button
                        key={v.voice_id}
                        className={`model-card${v.active ? ' model-card--selected' : ''}${!v.installed ? ' model-card--disabled' : ''}`}
                        onClick={() => v.installed && !v.active && handleSelect(v.voice_id)}
                        disabled={!v.installed || switching === v.voice_id}
                        style={{
                          ...(v.active ? { outline: '2px solid var(--md-primary)', outlineOffset: '2px' } : {})
                        }}
                        title={!v.installed
                          ? `Not installed. Run: python scripts/download_voices.py ${v.voice_id}`
                          : v.description}
                      >
                        <div className="model-card-name" style={{ color: v.active ? 'var(--md-primary)' : undefined }}>
                          {v.display_name}
                          {v.default && !v.active && (
                            <span style={{ fontSize: '0.6rem', color: 'var(--md-outline)', marginLeft: 6 }}>default</span>
                          )}
                        </div>

                        <div className="model-card-meta">
                          <span className={`badge badge--${v.quality === 'high' ? 'cost' : v.quality === 'fast' ? 'cpu' : 'gpu'}`}>
                            {QUALITY_LABELS[v.quality] || v.quality}
                          </span>
                          <span className="badge" style={{
                            background: 'color-mix(in srgb,' + ENGINE_COLORS[v.engine] + ' 14%, transparent)',
                            color: ENGINE_COLORS[v.engine],
                          }}>
                            {ENGINE_LABELS[v.engine] || v.engine}
                          </span>
                          {v.engine === 'piper' && v.size_mb > 0 && (
                            <span className="badge" style={{ background: 'var(--md-surface-container-highest)', color: 'var(--md-on-surface-variant)' }}>
                              {v.size_mb.toFixed(0)} MB
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: '0.72rem', color: 'var(--md-on-surface-variant)', lineHeight: 1.4 }}>
                          {v.description}
                        </div>

                        {/* Preview button */}
                        {v.installed && (
                          <button
                            onClick={e => { e.stopPropagation(); handlePreview(v.voice_id) }}
                            disabled={previewing === v.voice_id}
                            style={{
                              marginTop: 4,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              fontSize: '0.6875rem',
                              fontWeight: 500,
                              color: previewing === v.voice_id ? 'var(--md-primary)' : 'var(--md-on-surface-variant)',
                              background: 'var(--md-surface-container-highest)',
                              border: '1px solid var(--md-outline-variant)',
                              borderRadius: 'var(--md-shape-full)',
                              padding: '3px 10px',
                              cursor: previewing === v.voice_id ? 'default' : 'pointer',
                              transition: 'color 150ms, border-color 150ms',
                              alignSelf: 'flex-start',
                            }}
                          >
                            {previewing === v.voice_id ? '◉ Playing…' : '▶ Preview'}
                          </button>
                        )}

                        {!v.installed && <div className="model-card-locked">NOT INSTALLED</div>}
                        {switching === v.voice_id && <div className="model-card-locked" style={{ color: 'var(--md-primary)' }}>SWITCHING…</div>}
                        {v.active && (
                          <span style={{
                            fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em',
                            color: 'var(--md-primary)', textTransform: 'uppercase', marginTop: 2
                          }}>ACTIVE</span>
                        )}
                        {v.active && <div className="model-card-active-dot" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )
      })}

      <p className="settings-hint" style={{ marginTop: 4 }}>
        Voice changes take effect on your next conversation — no restart needed.
        To install more voices: <code>python scripts/download_voices.py atlas aria</code> on the server,
        or add them to <code>deploy.sh</code> to auto-download on every update.
      </p>
    </>
  )
}

// =============================================================================
// ParentChildrenSection — parent manages their children's feature access
// =============================================================================

function ParentChildrenSection({ data, token, onChanged }) {
  const [saving, setSaving] = useState(null) // child_id being saved

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
      console.error('[Parent] feature save failed:', e)
      onChanged(data)
    } finally {
      setSaving(null)
    }
  }

  const globallyOn = new Set(data.globally_on || [])

  return (
    <Section title="MY CHILDREN">
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        Enable features for each child. Features greyed out have been disabled globally by the admin.
      </p>
      {(data.children || []).length === 0 && (
        <p className="settings-hint">No children linked to your account yet.</p>
      )}
      {(data.children || []).map(child => (
        <div key={child.id} style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 8, color: 'var(--md-on-surface)' }}>
            {child.display_name}
            <span style={{ fontWeight: 400, fontSize: '0.72rem', color: 'var(--md-outline)', marginLeft: 8 }}>{child.email}</span>
            {saving === child.id && <span style={{ marginLeft: 8, fontSize: '0.7rem', color: 'var(--md-primary)' }}>Saving…</span>}
          </div>
          <div className="settings-grid">
            {(data.globally_on || []).map(key => {
              const enabled  = (child.enabled_features || []).includes(key)
              const locked   = !globallyOn.has(key)
              return (
                <label key={key} className="toggle-row" style={{ opacity: locked ? 0.4 : 1 }}>
                  <span className="toggle-label" style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>
                    {key.replace('_', ' ')}
                  </span>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    disabled={locked}
                    className={`toggle-switch ${enabled ? 'toggle-switch--on' : ''}`}
                    onClick={() => !locked && toggle(child, key)}
                  >
                    <span className="toggle-knob" />
                  </button>
                  <span className="toggle-value">{enabled ? 'ON' : 'OFF'}</span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </Section>
  )
}

// =============================================================================
// AdminFeatureSection — admin global feature on/off (hides from all non-admins)
// =============================================================================

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
      console.error('[Admin] feature visibility save failed:', e)
      onChanged(featureVis)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="ADMIN — FEATURE VISIBILITY">
      <p className="settings-hint" style={{ marginBottom: 16 }}>
        Hide features globally — hidden features disappear for all non-admin users.
        Useful while building or fixing a feature. Admin always sees everything.
        {saving && <span style={{ marginLeft: 8, color: 'var(--md-primary)' }}>Saving…</span>}
      </p>
      <div className="settings-grid">
        {(featureVis.all_features || []).map(f => (
          <label key={f.key} className="toggle-row" style={{ opacity: f.hidden ? 0.55 : 1 }}>
            <span className="toggle-label" style={{ fontSize: '0.8rem' }}>{f.label}</span>
            <button
              role="switch"
              aria-checked={!f.hidden}
              className={`toggle-switch ${!f.hidden ? 'toggle-switch--on' : ''}`}
              onClick={() => toggle(f.key)}
            >
              <span className="toggle-knob" />
            </button>
            <span className="toggle-value">{f.hidden ? 'HIDDEN' : 'VISIBLE'}</span>
          </label>
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
// NotificationsSection — manage Web Push subscriptions
// =============================================================================

function NotificationsSection({ token }) {
  const [status, setStatus] = useState('loading')
  const [working, setWorking] = useState(false)
  const [testResult, setTestResult] = useState('')

  useEffect(() => {
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

  const handleEnable = async () => {
    setWorking(true)
    const res = await registerPushNotifications(API_BASE)
    setStatus(res.status === 'subscribed' ? 'subscribed' : 'idle')
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

  return (
    <Section title="NOTIFICATIONS">
      <div className="toggle-row">
        <span className="toggle-label">Enable Push Notifications</span>
        <button
          className={`btn ${status === 'subscribed' ? 'btn--secondary' : 'btn--primary'}`}
          onClick={handleEnable}
          disabled={working || status === 'unsupported' || status === 'subscribed'}
          style={{ padding: '6px 16px', fontSize: '0.8rem' }}
        >
          {status === 'subscribed' ? 'Enabled' : working ? 'Enabling…' : 'Enable'}
        </button>
      </div>

      <p className="settings-hint">
        {status === 'subscribed' && '✓ This device is subscribed to alerts.'}
        {status === 'idle' && 'Alerts are not enabled on this device.'}
        {status === 'unsupported' && '✗ Web Push is not supported by your browser.'}
        {status === 'loading' && 'Checking status…'}
      </p>

      {status === 'subscribed' && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="btn btn--ghost"
            onClick={handleTest}
            disabled={working}
            style={{ padding: '4px 12px', fontSize: '0.75rem' }}
          >
            {working ? 'Sending…' : 'Test Notification'}
          </button>
          {testResult && <span style={{ fontSize: '0.75rem', color: 'var(--md-tertiary)' }}>{testResult}</span>}
        </div>
      )}
    </Section>
  )
}

