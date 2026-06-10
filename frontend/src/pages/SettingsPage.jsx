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
import { API_BASE, Section, Toggle } from './settings/shared.jsx'
import NimSection from './settings/NimSection.jsx'
import ModelSection from './settings/ModelSection.jsx'
import FeedsSection from './settings/FeedsSection.jsx'
import BriefingSection from './settings/BriefingSection.jsx'
import PersonaSection from './settings/PersonaSection.jsx'
import DaemonControlSection from './settings/DaemonControlSection.jsx'
import LocalAiFeaturesSection from './settings/LocalAiFeaturesSection.jsx'
import HardwareCookbookSection from './settings/HardwareCookbookSection.jsx'
import IntentRouterSection from './settings/IntentRouterSection.jsx'
import ChronosSection from './settings/ChronosSection.jsx'
import CloudFallbackSection from './settings/CloudFallbackSection.jsx'
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
        <IntentRouterSection
          intentRouterSettings={intentRouterSettings}
          saveIntentRouter={saveIntentRouter}
        />
      )}

      {/* ================================================================ */}
      {/* CHRONOS / SCRIBE — admin                                         */}
      {/* ================================================================ */}
      {showAdmin && (
        <ChronosSection
          scribeEnabled={scribeEnabled}
          saveScribeEnabled={saveScribeEnabled}
          daemonStatus={daemonStatus}
        />
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
        <HardwareCookbookSection hardwareCookbook={hardwareCookbook} />
      )}

      {/* ================================================================ */}
      {/* DAEMON CONTROL — admin                                          */}
      {/* ================================================================ */}
      {showAdmin && (
        <DaemonControlSection
          daemonStatus={daemonStatus}
          aiFeatures={aiFeatures}
          saveAiFeature={saveAiFeature}
          triggerDaemonTask={triggerDaemonTask}
        />
      )}

      {/* ================================================================ */}
      {/* LOCAL AI FEATURES — admin                                        */}
      {/* ================================================================ */}
      {showAdmin && (
        <LocalAiFeaturesSection
          aiFeatures={aiFeatures}
          saveAiFeature={saveAiFeature}
        />
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
        <CloudFallbackSection
          llmSettings={llmSettings}
          saveFallback={saveFallback}
          enabledProviders={enabledProviders}
          models={models}
        />
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

