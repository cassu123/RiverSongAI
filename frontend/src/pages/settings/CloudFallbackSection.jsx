// =============================================================================
// src/pages/settings/CloudFallbackSection.jsx
//
// CLOUD FALLBACK — user: fallback provider/model when local is unavailable.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

const PROVIDER_NAMES = {
  anthropic:  'Anthropic Claude',
  gemini:     'Google Gemini',
  openai:     'OpenAI',
  mistral_ai: 'Mistral AI',
  nvidia_nim: 'NVIDIA NIM',
  ollama:     'Ollama (local)',
  auto:       'River Decides (Auto)',
}

export default function CloudFallbackSection({ llmSettings, saveFallback, enabledProviders, models }) {
  return (
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
  )
}
