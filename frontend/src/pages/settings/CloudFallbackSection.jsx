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
  deepseek:   'DeepSeek (cloud)',
  qwen:       'Qwen (cloud)',
  ollama:     'Ollama (local)',
  auto:       'River Decides (Auto)',
}

export default function CloudFallbackSection({ llmSettings, saveFallback, enabledProviders, models }) {
  return (
    <Section title="CLOUD FALLBACK">
        <p className="rs-card-meta rs-mb-3">
          Admin only. When local models are unavailable, River falls back to a cloud
          provider. Anthropic Claude and Google Gemini are supported; usage and cost
          are tracked in Token Usage below.
        </p>

        <Toggle
          id="fallback-toggle"
          label="Enable cloud fallback"
          checked={!!(llmSettings?.cloud_fallback_enabled)}
          onChange={v => saveFallback({ cloud_fallback_enabled: v })}
        />

        {llmSettings?.cloud_fallback_enabled && (
          <div className="rs-grid rs-grid-cols-1 rs-md-grid-cols-2 rs-gap-4 rs-mt-4">
            <div className="rs-card-meta">
              <span className="rs-card-label rs-mb-1 rs-type-nano">Provider</span>
              <select
                className="settings-select rs-w-full"
               
                value={llmSettings?.cloud_fallback_provider || ''}
                onChange={e => saveFallback({ cloud_fallback_provider: e.target.value, cloud_fallback_model: '' })}
              >
                <option value="">— choose —</option>
                {['anthropic', 'gemini'].map(p => (
                  <option key={p} value={p} disabled={!enabledProviders[p]}>
                    {PROVIDER_NAMES[p]}{!enabledProviders[p] ? ' (key required)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {llmSettings?.cloud_fallback_provider && (
              <div className="rs-card-meta">
                <span className="rs-card-label rs-mb-1 rs-type-nano">Model</span>
                <select
                  className="settings-select rs-w-full"
                 
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
