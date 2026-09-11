// =============================================================================
// src/pages/settings/AdminVisibilitySection.jsx
// =============================================================================

import React, { useState } from 'react'
import { Section } from './shared.jsx'

// =============================================================================
// AdminVisibilitySection — admin-only global show/hide for voices + LLM models
// =============================================================================

const PROVIDER_DISPLAY = {
  anthropic:  'Anthropic',
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  mistral_ai: 'Mistral AI',
  deepseek:   'DeepSeek (cloud)',
  qwen:       'Qwen (cloud)',
  ollama:     'Ollama (local)',
}

export default function AdminVisibilitySection({ visibility, token, onChanged }) {
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
      const res = await fetch('/api/admin/model-visibility', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ hidden_voices: next.hidden_voices, hidden_llms: next.hidden_llms }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      window.dispatchEvent(new Event('rs-models-changed'))
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
    <Section title="MODEL VISIBILITY">
      <p className="rs-card-meta rs-mb-4">
        Toggle models off to hide them globally for all users. Hidden models cannot
        be selected but their settings are preserved.
        {saving && <span className="rs-c-primary" style={{ marginLeft: 'var(--rs-space-2)' }}>Saving…</span>}
      </p>

      {/* ── Voices ── */}
      <div className="rs-card-label rs-mb-2 rs-flex rs-items-center rs-gap-2">
        <span className="rs-pill is-active rs-type-nano" style={{ padding: '2px 8px' }}>VOICE</span>
        Voice Models
      </div>
      {voiceAccents.map(accent => {
        const group = allVoices.filter(v => v.accent === accent)
        return (
          <div key={accent} className="rs-mb-3">
            <div className="rs-mb-1 rs-type-nano rs-fw-600" style={{ color: 'var(--md-outline)', letterSpacing: '0.08em' }}>
              {accent.toUpperCase()}
            </div>
            <div className="rs-flex rs-flex-col rs-gap-1">
              {group.map(v => {
                const hidden = (visibility.hidden_voices || []).includes(v.voice_id)
                return (
                  <label key={v.voice_id} className="toggle-row" style={{ opacity: hidden ? 0.5 : 1 }}>
                    <span className="toggle-label rs-type-tiny">
                      {v.display_name}
                      {!v.installed && (
                        <span className="rs-type-nano" style={{ color: 'var(--md-outline)', marginLeft: 5 }}>not installed</span>
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
      <div className="rs-card-label rs-mt-5 rs-mb-2 rs-flex rs-items-center rs-gap-2">
        <span className="rs-pill rs-type-nano" style={{ padding: '2px 8px', background: 'var(--md-tertiary)', color: 'var(--md-on-tertiary)' }}>AI</span>
        AI Models
      </div>
      {llmProviders.map(provider => {
        const group = allLlms.filter(m => m.provider === provider)
        return (
          <div key={provider} className="rs-mb-3">
            <div className="rs-mb-1 rs-type-nano rs-fw-600" style={{ color: 'var(--md-outline)', letterSpacing: '0.08em' }}>
              {(PROVIDER_DISPLAY[provider] || provider).toUpperCase()}
            </div>
            <div className="rs-flex rs-flex-col rs-gap-1">
              {group.map(m => {
                const hidden = (visibility.hidden_llms || []).includes(m.model_id)
                return (
                  <label key={m.model_id} className="toggle-row" style={{ opacity: hidden ? 0.5 : 1 }}>
                    <span className="toggle-label rs-type-tiny">{m.display_name}</span>
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
