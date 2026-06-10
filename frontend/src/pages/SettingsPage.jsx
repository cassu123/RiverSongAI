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
import { API_BASE, Section, Toggle } from './settings/shared.jsx'
import NimSection from './settings/NimSection.jsx'
import ModelSection from './settings/ModelSection.jsx'
import FeedsSection from './settings/FeedsSection.jsx'
import BriefingSection from './settings/BriefingSection.jsx'
import PersonaSection from './settings/PersonaSection.jsx'
import VoiceSection from './settings/VoiceSection.jsx'
import AdminWakeWordSection from './settings/AdminWakeWordSection.jsx'
import ParentChildrenSection from './settings/ParentChildrenSection.jsx'
import AdminFeatureSection from './settings/AdminFeatureSection.jsx'
import FamilyGroupsSection from './settings/FamilyGroupsSection.jsx'
import AdminVisibilitySection from './settings/AdminVisibilitySection.jsx'
import AdminModelFamiliesSection from './settings/AdminModelFamiliesSection.jsx'
import NotificationsSection from './settings/NotificationsSection.jsx'
import TokenUsageSection from './settings/TokenUsageSection.jsx'
import VoiceIDSection from './settings/VoiceIDSection.jsx'

const TTL_LABELS = {
  short:    '7 days',
  standard: '30 days',
  extended: '90 days',
  long:     '365 days',
  forever:  'Forever',
}

// ---------------------------------------------------------------------------
// Main settings page
// ---------------------------------------------------------------------------
const PROVIDER_NAMES = {
  anthropic:  'Anthropic Claude',
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  mistral_ai: 'Mistral AI',
  nvidia_nim: 'NVIDIA NIM',
  ollama:     'Ollama (local)',
  auto:       'River Decides (Auto)',
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
  const [userPrefs,        setUserPrefs]        = useState(null)
  const [voiceSettings,    setVoiceSettings]    = useState(null)
  const [aiFeatures,       setAiFeatures]       = useState({})
  const [elevenLabsSettings, setElevenLabsSettings] = useState(null)
  const [personaSettings,    setPersonaSettings]    = useState(null)
  const [briefingSettings,   setBriefingSettings]   = useState(null)
  const [daemonStatus,       setDaemonStatus]       = useState({})
  const [wakeWordRestart,    setWakeWordRestart]    = useState(false)
  const [orchestrationSettings, setOrchestrationSettings] = useState({
    n8n_enabled: false,
    n8n_url: '',
    n8n_api_key: '',
    n8n_webhook_secret: ''
  })
  const [intentRouterSettings, setIntentRouterSettings] = useState({ enabled: false, min_hits: 2 })
  const [llmRoutingFlags,      setLlmRoutingFlags]      = useState({ local_enabled: true, cloud_enabled: true, nvidia_enabled: true })
  const [scribeEnabled,        setScribeEnabled]        = useState(false)
  const [feedPrefs,            setFeedPrefs]            = useState(null)
  const [hardwareCookbook,     setHardwareCookbook]     = useState(null)  // admin: GPU/RAM/CPU + per-model fit (null when flag off)
  const [loading,          setLoading]          = useState(true)
  const [saveStatus,       setSaveStatus]       = useState('')
  const [reloadPending,    setReloadPending]    = useState(false)

  // ---- Initial data load ----
  useEffect(() => {
    let active = true
    const loadData = async () => {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const query = user?.id ? `?user_id=${user.id}` : ''
      const okJson = (r) => { if (!r.ok) throw new Error(`HTTP ${r.status} from ${r.url}`); return r.json() }
      try {
        const [modData, llmData, memData, voiceData, featData, prefData, feedPrefsData] = await Promise.all([
          fetch(`${API_BASE}/api/models`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/llm${query}`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/memory${query}`, { headers }).then(okJson),
          fetch(`${API_BASE}/api/settings/voice`, { headers }).then(r => r.json()).catch(() => null),
          fetch(`${API_BASE}/api/features`, { headers }).then(r => r.json()).catch(() => ({ ai_features: {} })),
          fetch(`${API_BASE}/api/settings`, { headers }).then(r => r.json()).catch(() => ({ music_provider: 'youtube_music' })),
          fetch(`${API_BASE}/api/feeds/preferences`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        ])

        if (!active) return

        setModels({ local: modData.local || [], cloud: modData.cloud || [] })
        setEnabledProviders(modData.enabled_providers || {})
        setLlmSettings(llmData)
        setMemSettings(memData)
        setVoiceSettings(voiceData)
        setUserPrefs(prefData)
        if (feedPrefsData) setFeedPrefs(feedPrefsData)
        if (featData) setAiFeatures(featData.ai_features || {})

        if (user?.role === 'admin') {
          const [visData, featVisData, familyRaw, familyGroupsRaw, orchData, elData, personaData, briefingData, dStatus, intentRouterData, routingFlags, hwData] = await Promise.all([
            fetch(`${API_BASE}/api/admin/model-visibility`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/admin/feature-visibility`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/admin/family`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/admin/family-groups`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/settings/orchestration`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/settings/elevenlabs`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/settings/persona`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/settings/briefing`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/daemon/status`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/settings/intent-router`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/admin/llm-routing-flags`, { headers }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/models/hardware`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
          ])
          if (!active) return
          if (visData) setVisibility(visData)
          if (featVisData) setFeatureVis(featVisData)
          if (familyRaw) setFamilyData(familyRaw)
          if (familyGroupsRaw) setFamilyGroups(familyGroupsRaw)
          if (orchData) {
            setOrchestrationSettings(orchData)
            if (orchData.daemon_scribe_enabled != null) setScribeEnabled(orchData.daemon_scribe_enabled)
          }
          if (elData) setElevenLabsSettings(elData)
          if (personaData) setPersonaSettings(personaData)
          if (briefingData) setBriefingSettings(briefingData)
          if (dStatus) setDaemonStatus(dStatus.daemons || {})
          if (intentRouterData) setIntentRouterSettings(intentRouterData)
          if (routingFlags) setLlmRoutingFlags(routingFlags)
          if (hwData) setHardwareCookbook(hwData)
        } else if (user?.role === 'parent') {
          const [childrenRaw] = await Promise.all([
            fetch(`${API_BASE}/api/parent/children`, { headers }).then(r => r.json()).catch(() => null)
          ])
          if (!active) return
          if (childrenRaw) setChildrenData(childrenRaw)
        }

        setLoading(false)
      } catch (err) {
        console.error('[SettingsPage] Load failed:', err)
        if (!active) return
        setLoading(false)
        setSaveStatus('error')
      }
    }
    loadData()
    return () => { active = false }
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
  const saveIntentRouter = useCallback(async (patch) => {
    const next = { ...intentRouterSettings, ...patch }
    setIntentRouterSettings(next)
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    await fetch(`${API_BASE}/api/settings/intent-router`, {
      method: 'POST', headers, body: JSON.stringify(next),
    }).catch(err => console.error('Intent router save failed:', err))
  }, [intentRouterSettings, token])

  const saveLlmRoutingFlags = useCallback(async (patch) => {
    const next = { ...llmRoutingFlags, ...patch }
    setLlmRoutingFlags(next)
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    await fetch(`${API_BASE}/api/admin/llm-routing-flags`, {
      method: 'POST', headers, body: JSON.stringify(next),
    }).then(res => {
      if (res.ok) setReloadPending(true)
    }).catch(err => console.error('LLM routing flags save failed:', err))
  }, [llmRoutingFlags, token])

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
        body:    JSON.stringify({ ...next, daemon_scribe_enabled: scribeEnabled }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [orchestrationSettings, scribeEnabled, token])

  const saveScribeEnabled = useCallback(async (enabled) => {
    setScribeEnabled(enabled)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/orchestration`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...orchestrationSettings, daemon_scribe_enabled: enabled }),
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

  const saveUserPrefs = useCallback(async (patch) => {
    const next = { ...userPrefs, ...patch }
    setUserPrefs(next)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings`, {
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
  }, [userPrefs, token])

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

  const saveBriefingSettings = useCallback(async (patch) => {
    const next = { ...briefingSettings, ...patch }
    setBriefingSettings(next)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/settings/briefing`, {
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
  }, [briefingSettings, token])

  const saveFeedPrefs = useCallback(async (patch) => {
    const next = { ...feedPrefs, ...patch }
    setFeedPrefs(next)
    setSaveStatus('saving')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${API_BASE}/api/feeds/preferences`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(next),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 2500)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus(''), 4000)
    }
  }, [feedPrefs, token])

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

      {/* Reload-pending banner for LLM routing flag changes */}
      {reloadPending && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 18px', marginBottom: 8,
          background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--rs-status-warning) 40%, transparent)',
          borderRadius: 'var(--md-shape-sm)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)' }}>warning</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--rs-status-warning)', fontWeight: 600 }}>
              LLM routing change saved — reload required to take effect.
            </span>
          </div>
          <button className="rs-btn-primary" style={{ fontSize: '0.75rem', padding: '6px 14px' }} onClick={() => window.location.reload()}>
            RELOAD NOW
          </button>
        </div>
      )}

      {/* Save status toast */}
      {saveStatus && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: 32, right: 32, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px',
            borderRadius: 'var(--md-shape-lg)',
            background: saveStatus === 'error'
              ? 'var(--md-error-container)'
              : 'var(--md-primary-container)',
            color: saveStatus === 'error'
              ? 'var(--md-on-error-container)'
              : 'var(--md-on-primary-container)',
            fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.06em',
            boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5)',
            border: '1px solid',
            borderColor: saveStatus === 'error'
              ? 'color-mix(in srgb, var(--md-error) 40%, transparent)'
              : 'color-mix(in srgb, var(--primary) 40%, transparent)',
          }}
        >
          {saveStatus === 'saving' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>sync</span>SAVING…</>
          )}
          {saveStatus === 'saved' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>check_circle</span>SAVED</>
          )}
          {saveStatus === 'error' && (
            <><span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>error</span>ERROR — CHECK CONSOLE</>
          )}
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
      {/* NVIDIA NIM — admin                                               */}
      {/* ================================================================ */}
      {showAdmin && (
        <NimSection
          enabled={enabledProviders.nvidia_nim || false}
          token={token}
          llmRoutingFlags={llmRoutingFlags}
          saveLlmRoutingFlags={saveLlmRoutingFlags}
        />
      )}

      {/* ================================================================ */}
      {/* INTENT ROUTER — admin                                            */}
      {/* ================================================================ */}
      {showAdmin && (
        <Section title="INTENT ROUTER">
          <Toggle
            id="intent-router-toggle"
            label="Enable Auto Model Routing"
            checked={intentRouterSettings.enabled}
            onChange={v => saveIntentRouter({ enabled: v })}
          />
          <p className="rs-card-meta">
            Selecting <strong>River Decides</strong> in the chat model picker routes each message
            to the best provider automatically. Home commands stay local, complex reasoning goes
            to Nemotron, creative writing to Kimi, research to Gemini.
          </p>

          {/* Sensitivity selector — min 44px touch targets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="rs-card-meta" style={{ margin: 0, flexShrink: 0 }}>Signal sensitivity</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { n: 1, label: 'High',          desc: 'Routes on 1+ match' },
                { n: 2, label: 'Balanced',      desc: 'Routes on 2+ matches' },
                { n: 3, label: 'Conservative',  desc: 'Routes on 3+ matches' },
              ].map(({ n, label }) => (
                <button
                  key={n}
                  className={`rs-pill is-tappable${intentRouterSettings.min_hits === n ? ' is-active' : ''}`}
                  style={{ fontSize: '0.75rem', minHeight: 44, minWidth: 44, padding: '0 14px', cursor: 'pointer' }}
                  onClick={() => saveIntentRouter({ min_hits: n })}
                  aria-pressed={intentRouterSettings.min_hits === n}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Routing map — 2-column grid, intent → model */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {[
              { intent: 'Home Control', model: 'Llama 1B',    icon: 'home',          where: 'local' },
              { intent: 'Quick Lookup', model: 'Llama 3B',    icon: 'bolt',          where: 'local' },
              { intent: 'Reasoning',    model: 'Nemotron',    icon: 'psychology',    where: 'NIM' },
              { intent: 'Creative',     model: 'Kimi K2.6',   icon: 'draw',          where: 'NIM' },
              { intent: 'Code',         model: 'Qwen Coder',  icon: 'code',          where: 'local' },
              { intent: 'Commerce',     model: 'Claude',      icon: 'storefront',    where: 'cloud' },
              { intent: 'Research',     model: 'Gemini',      icon: 'travel_explore', where: 'cloud' },
              { intent: 'General',      model: 'Llama 3B',    icon: 'chat',          where: 'local' },
            ].map(({ intent, model, icon, where }) => (
              <div key={intent} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '1rem', opacity: 0.75 }}>{icon}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{intent}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="rs-card-meta" style={{ fontSize: '0.68rem' }}>{model}</span>
                  <span className="rs-pill" style={{
                    fontSize: '0.65rem', padding: '1px 6px',
                    opacity: 0.7,
                    background: where === 'local' ? 'color-mix(in srgb, var(--primary) 12%, transparent)' :
                                where === 'NIM'   ? 'color-mix(in srgb, var(--md-sys-color-tertiary) 12%, transparent)' :
                                                    'color-mix(in srgb, var(--md-sys-color-secondary) 12%, transparent)',
                  }}>{where}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* CHRONOS / SCRIBE — admin                                         */}
      {/* ================================================================ */}
      {showAdmin && (
        <Section title="CHRONOS · MEMORY VAULT">
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.6rem', color: 'var(--primary)', flexShrink: 0 }}>history_edu</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Local markdown vault · Obsidian-style</div>
              <div className="rs-card-meta">Voice-to-note · Conversation memory · Editable facts · Backlinks</div>
            </div>
            <span className="rs-pill is-active" style={{ fontSize: '0.6rem', flexShrink: 0 }}>LIVE</span>
          </div>

          {/* Vault tree — 3-column, folder icons, monospace paths */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {[
              { path: 'Personal/',       desc: 'Private to you',     icon: 'lock',         color: 'var(--primary)' },
              { path: 'Household/',      desc: 'Shared with family',  icon: 'home',         color: 'var(--md-sys-color-tertiary)' },
              { path: 'Shared with me/', desc: 'Explicit invites',    icon: 'group',        color: 'var(--md-sys-color-secondary)' },
            ].map(({ path, desc, icon, color }) => (
              <div key={path} style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '0.95rem', color }}>{icon}</span>
                  <code style={{ fontSize: '0.7rem', fontWeight: 600 }}>{path}</code>
                </div>
                <div className="rs-card-meta" style={{ fontSize: '0.63rem' }}>{desc}</div>
              </div>
            ))}
          </div>

          {/* Scribe daemon toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle
              id="scribe-toggle"
              label="Enable Scribe Daemon"
              checked={scribeEnabled}
              onChange={v => saveScribeEnabled(v)}
            />
            <span className="rs-pill" style={{ fontSize: '0.6rem', flexShrink: 0, color: daemonStatus?.scribe?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
              {daemonStatus?.scribe?.alive ? '● ONLINE' : '○ OFFLINE'}
            </span>
          </div>
          <p className="rs-card-meta" style={{ marginTop: -8 }}>
            Watches the vault, re-indexes notes, extracts facts, and logs conversation summaries to your daily note.
            Path: <code>data/vault/</code>
          </p>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--primary)', flexShrink: 0 }}>check_circle</span>
            <span className="rs-card-meta" style={{ fontSize: '0.72rem' }}>
              CHRONOS page, CodeMirror editor, backlinks, search, and Scribe daemon are fully operational. Graph view is Phase 3.
            </span>
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* AI MODEL — user-facing                                           */}
      {/* ================================================================ */}
      {showUser && (
        <ModelSection
          showAdmin={showAdmin}
          models={models}
          enabledProviders={enabledProviders}
          llmRoutingFlags={llmRoutingFlags}
          saveLlmRoutingFlags={saveLlmRoutingFlags}
          currentProvider={currentProvider}
          currentModel={currentModel}
          selectModel={selectModel}
        />
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
          <div className="rs-card-label" style={{ marginBottom: 6 }}>WHISPER MODEL SIZE</div>
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
      {/* HARDWARE COOKBOOK — admin, flag-gated                            */}
      {/* Hidden when settings.hardware_cookbook_enabled = False (route    */}
      {/* returns 404 → fetch null → section does not render).             */}
      {/* ================================================================ */}
      {showAdmin && hardwareCookbook && (
        <Section title="HARDWARE COOKBOOK">
          <p className="rs-card-meta" style={{ marginBottom: 12 }}>
            What runs well on this rig. Detected GPU/RAM/CPU vs. every local model in the registry.
          </p>

          {/* Detected hardware row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ marginBottom: 14 }}>
            <div className="rs-card" style={{ padding: 10 }}>
              <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>GPU</div>
              {hardwareCookbook.hardware.gpus.length === 0 ? (
                <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>No NVIDIA GPU detected.</div>
              ) : hardwareCookbook.hardware.gpus.map(g => (
                <div key={g.index} style={{ fontSize: '0.78rem' }}>
                  <div style={{ fontWeight: 600 }}>{g.name}</div>
                  <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
                    {g.vram_free_gb} / {g.vram_total_gb} GB free · driver {g.driver_version}
                  </div>
                </div>
              ))}
            </div>
            <div className="rs-card" style={{ padding: 10 }}>
              <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>RAM</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                {hardwareCookbook.hardware.ram_gb.total_gb} GB
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
                {hardwareCookbook.hardware.ram_gb.available_gb} GB available
              </div>
            </div>
            <div className="rs-card" style={{ padding: 10 }}>
              <div className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>CPU</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hardwareCookbook.hardware.cpu.model}
              </div>
              <div className="rs-card-meta" style={{ fontSize: '0.7rem' }}>
                {hardwareCookbook.hardware.cpu.cores} cores · {hardwareCookbook.hardware.cpu.arch}
              </div>
            </div>
          </div>

          {/* Fit summary pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {[
              ['fits', 'FITS GPU', 'var(--md-primary)'],
              ['tight', 'TIGHT', 'var(--rs-status-warning)'],
              ['ram_fallback', 'CPU+RAM', 'var(--md-outline)'],
              ['oom', 'OOM', 'var(--md-error)'],
            ].map(([key, label, color]) => (
              <span key={key} className="rs-pill" style={{ fontSize: '0.65rem', padding: '3px 10px', borderColor: color, color }}>
                {label} · {hardwareCookbook.summary[key]}
              </span>
            ))}
          </div>

          {/* Per-model fit list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {hardwareCookbook.models.map(m => {
              const palette = {
                fits:         { dot: 'var(--md-primary)',         label: 'FITS GPU' },
                tight:        { dot: 'var(--rs-status-warning)',  label: 'TIGHT' },
                ram_fallback: { dot: 'var(--md-outline)',         label: 'CPU+RAM' },
                oom:          { dot: 'var(--md-error)',           label: 'OOM' },
                unknown:      { dot: 'var(--md-outline-variant)', label: '?' },
              }[m.status] || { dot: 'var(--md-outline-variant)', label: '?' }
              return (
                <div key={m.model_id} className="toggle-row" style={{ alignItems: 'center', gap: 8 }} title={m.reason}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: palette.dot, flexShrink: 0,
                  }} />
                  <span className="toggle-label" style={{ fontSize: '0.8rem', flex: 1 }}>
                    {m.display_name}
                    {m.vram_gb != null && (
                      <span className="rs-card-meta" style={{ fontSize: '0.65rem', marginLeft: 8 }}>
                        ~{m.vram_gb} GB
                      </span>
                    )}
                  </span>
                  <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px', borderColor: palette.dot, color: palette.dot }}>
                    {palette.label}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="rs-card-meta" style={{ marginTop: 12, fontSize: '0.68rem' }}>
            Detected {new Date(hardwareCookbook.hardware.detected_at).toLocaleString()}.
            Reload Settings to refresh. VRAM estimates assume Q4_K_M quantisation.
          </p>
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
            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>WARDEN (Vision/Security)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>RTSP Camera Monitoring</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.warden?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
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
            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>MECHANIC (Telemetry)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>MAVLink / ArduRover Link</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.mechanic?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
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
            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>HERALD (Casting/Lip-Sync)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>Google Home Hub Integration</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.herald?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
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
            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>SIFTER (RAG)</div>
                  <div className="rs-card-meta" style={{ margin: 0 }}>Background Document Indexing</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span className="rs-card-label" style={{ color: daemonStatus.sifter?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
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
            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <Toggle
                id="feat-semantic"
                label="Semantic Memory"
                checked={!!aiFeatures.SEMANTIC_MEMORY_ENABLED}
                onChange={v => saveAiFeature('SEMANTIC_MEMORY_ENABLED', v)}
              />
              <p className="rs-card-meta">Use vector search for memory recall</p>
            </div>

            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <Toggle
                id="feat-vision"
                label="Vision Analysis"
                checked={!!aiFeatures.VISION_ENABLED}
                onChange={v => saveAiFeature('VISION_ENABLED', v)}
              />
              <p className="rs-card-meta">AI photo analysis for inventory & recipes</p>
            </div>

            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
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

            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <Toggle
                id="feat-rag"
                label="RAG Documents"
                checked={!!aiFeatures.RAG_ENABLED}
                onChange={v => saveAiFeature('RAG_ENABLED', v)}
              />
              <p className="rs-card-meta">Answer questions from documents</p>
            </div>

            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
              <Toggle
                id="feat-streaming"
                label="LLM Streaming"
                checked={!!aiFeatures.LLM_STREAMING_ENABLED}
                onChange={v => saveAiFeature('LLM_STREAMING_ENABLED', v)}
              />
              <p className="rs-card-meta">Stream AI responses token by token</p>
            </div>

            <div style={{ padding: 16, background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 12 }}>
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
          
          <div style={{ marginTop: 16, padding: '12px', background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)', borderRadius: 'var(--md-shape-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)', flexShrink: 0 }}>warning</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--rs-status-warning)', fontWeight: 600 }}>
              Backend restart required for changes to take effect.
            </span>
          </div>
        </Section>
      )}

      {/* ================================================================ */}
      {/* PERSONALITY — admin                                              */}
      {/* ================================================================ */}
      {showAdmin && personaSettings && (
        <PersonaSection
          personaSettings={personaSettings}
          setPersonaSettings={setPersonaSettings}
          savePersona={savePersona}
          resetPersona={resetPersona}
        />
      )}

      {/* ================================================================ */}
      {/* BRIEFING — admin                                                 */}
      {/* ================================================================ */}
      {showAdmin && briefingSettings && (
        <BriefingSection
          briefingSettings={briefingSettings}
          setBriefingSettings={setBriefingSettings}
          saveBriefingSettings={saveBriefingSettings}
        />
      )}

      {/* ================================================================ */}
      {/* FEEDS — user                                                     */}
      {/* ================================================================ */}
      {showUser && feedPrefs !== null && (
        <FeedsSection
          feedPrefs={feedPrefs}
          setFeedPrefs={setFeedPrefs}
          saveFeedPrefs={saveFeedPrefs}
        />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginTop: 16 }}>
            <div className="rs-card-meta">
              <span className="rs-card-label" style={{ fontSize: '0.65rem', marginBottom: 4 }}>Provider</span>
              <select
                className="settings-select"
                style={{ width: '100%' }}
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
                  className="settings-select"
                  style={{ width: '100%' }}
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
      {/* MUSIC & ENTERTAINMENT — user                                    */}
      {/* ================================================================ */}
      {showUser && (
      <Section title="MUSIC & ENTERTAINMENT">
        <p className="rs-card-meta" style={{ marginTop: -8 }}>
          Select your preferred discovery and playback service.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="toggle-row" style={{ padding: 0 }}>
            <span className="toggle-label">Preferred Provider</span>
            <select
              className="rs-input"
              style={{ width: 'auto', minWidth: 180 }}
              value={userPrefs?.music_provider || 'youtube_music'}
              onChange={(e) => saveUserPrefs({ music_provider: e.target.value })}
            >
              <option value="youtube_music">YouTube Music</option>
              <option value="spotify" disabled>Spotify (Coming Soon)</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
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
          <div style={{ marginTop: 12, padding: '12px', background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)', borderRadius: 'var(--md-shape-sm)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)', flexShrink: 0 }}>warning</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--rs-status-warning)', fontWeight: 600 }}>
              System restart required to apply changes.
            </span>
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--md-surface-container-low)', padding: '12px 16px', borderRadius: 'var(--md-shape-sm)' }}>
          <div style={{ display: 'flex', gap: 16, fontSize: '0.75rem' }}>
            <span>Active Phrase: <strong>Hey River</strong></span>
          </div>
          <span className="rs-card-label" style={{ color: aiFeatures.WAKE_WORD_ENABLED ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
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
              className="settings-select"
              style={{ width: '100%' }}
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

