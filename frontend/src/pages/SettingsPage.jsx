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

export default function SettingsPage() {
  const { user, token } = useAuth()

  const [models,           setModels]           = useState({ local: [], cloud: [] })
  const [enabledProviders, setEnabledProviders] = useState({})
  const [llmSettings,      setLlmSettings]      = useState(null)
  const [memSettings,      setMemSettings]      = useState(null)
  const [voiceSettings,    setVoiceSettings]    = useState(null)
  const [loading,          setLoading]          = useState(true)
  const [saveStatus,       setSaveStatus]       = useState('')

  // ---- Initial data load ----
  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {}
    const query = user?.id ? `?user_id=${user.id}` : ''

    Promise.all([
      fetch(`${API_BASE}/api/models`).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/llm${query}`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/memory${query}`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/api/settings/voice`, { headers }).then(r => r.json()).catch(() => null),
    ])
      .then(([modData, llmData, memData, voiceData]) => {
        setModels({ local: modData.local || [], cloud: modData.cloud || [] })
        setEnabledProviders(modData.enabled_providers || {})
        setLlmSettings(llmData)
        setMemSettings(memData)
        setVoiceSettings(voiceData)
        setLoading(false)
      })
      .catch(err => {
        console.error('[SettingsPage] Load failed:', err)
        setLoading(false)
        setSaveStatus('error')
      })
  }, [user?.id, token])

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

  return (
    <div className="settings-page page-wrap">

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
      {/* AI MODEL                                                         */}
      {/* ================================================================ */}
      <Section title="AI MODEL">
        <p className="settings-hint" style={{ marginBottom: 16 }}>
          The selected model is used for both Chat and Speak. For Speak, choose a model
          tagged <strong>⚡ GPU / SPEAK</strong> — these fit in your GPU's VRAM and respond
          faster for real-time voice conversation.
        </p>

        {/* Local models */}
        <div className="model-group">
          <h3 className="model-group-title">
            <span className="model-group-badge model-group-badge--local">LOCAL</span>
            Ollama — runs on your machine
          </h3>
          <div className="model-grid">
            {models.local.map(m => (
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
          <>
            {/* Active voice card */}
            <div className="voice-option voice-option--active">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="voice-option-name">
                  {voiceSettings.provider_label}
                </div>
                <div className="voice-option-meta">
                  {voiceSettings.active_voice || 'No voice configured'}
                </div>
              </div>
              {voiceSettings.provider !== 'none' && (
                <div className="voice-option-dot" aria-label="Active" />
              )}
            </div>

            {/* All installed voices */}
            {voiceSettings.available?.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <p className="settings-hint" style={{ marginBottom: 0 }}>
                  Installed voice models — change <code>PIPER_MODEL_PATH</code> in <code>.env</code> to switch.
                </p>
                {voiceSettings.available.map(v => (
                  <div
                    key={v.path}
                    className={`voice-option${v.active ? ' voice-option--active' : ''}`}
                    style={{ opacity: v.active ? 1 : 0.6 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="voice-option-name">{v.name}</div>
                      <div className="voice-option-meta" style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                        {v.path}
                      </div>
                    </div>
                    {v.active && <div className="voice-option-dot" aria-label="Active" />}
                  </div>
                ))}
              </div>
            )}

            {voiceSettings.provider === 'none' && (
              <p className="settings-hint" style={{ color: 'var(--error)' }}>
                TTS is disabled. Set <code>TTS_PROVIDER=piper</code> in <code>.env</code> to enable speech output.
              </p>
            )}

            <p className="settings-hint" style={{ marginTop: 8 }}>
              Additional voices: download <code>.onnx</code> models from{' '}
              <strong>huggingface.co/rhasspy/piper-voices</strong> and update <code>PIPER_MODEL_PATH</code>.
              Cloud TTS (ElevenLabs, OpenAI TTS) coming in a future phase.
            </p>
          </>
        ) : (
          <div className="voice-option voice-option--active">
            <div className="voice-option-name">Piper — Local TTS</div>
            <div className="voice-option-meta">Loading voice info…</div>
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

    </div>
  )
}