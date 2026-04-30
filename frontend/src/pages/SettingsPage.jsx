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
      setSwitchMsg(`✓ Switched to ${data.display_name}. Restart the service to apply.`)
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

      {accents.map(accent => {
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
        To install a voice: <code>python scripts/download_voices.py atlas aria</code> on the server,
        or edit <code>deploy.sh</code> to auto-download on every update. After switching,
        restart the service: <code>sudo systemctl restart river-song</code>
      </p>
    </>
  )
}
