// =============================================================================
// src/pages/settings/ModelSection.jsx
//
// AI MODEL — pick local Ollama model or enabled cloud provider model.
// =============================================================================

import React, { useState } from 'react'
import { Section, Toggle } from './shared.jsx'

// ---------------------------------------------------------------------------
// Helper: format cost
// ---------------------------------------------------------------------------
function fmtCost(v) {
  if (v == null) return null
  return v < 0.001 ? `$${(v * 1000).toFixed(3)}/M` : `$${v.toFixed(4)}/K`
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
      <div className="rs-card-value" style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 600, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.display_name}</div>

      <div className="rs-flex rs-flex-wrap rs-gap-1">
        {model.vram_gb != null && (
          <>
            <span className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {model.vram_gb <= 4 && <span className="material-symbols-rounded" style={{ fontSize: '0.85rem' }}>bolt</span>}
              {model.vram_gb <= 4 ? 'GPU' : 'RAM'} {model.vram_gb}GB
            </span>
            {model.vram_gb <= 4 && (
              <span className="rs-pill is-active" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px' }}>SPEAK</span>
            )}
          </>
        )}

        {model.is_cloud && (
          (model.cost_per_1k_input_usd === 0 && model.cost_per_1k_output_usd === 0) ? (
            <span className="rs-pill is-active" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px' }}>FREE</span>
          ) : (
            <>
              {inputCost && <span className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px' }}>IN {inputCost}</span>}
              {outputCost && <span className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px' }}>OUT {outputCost}</span>}
            </>
          )
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

export default function ModelSection({
  showAdmin,
  models,
  enabledProviders,
  llmRoutingFlags,
  saveLlmRoutingFlags,
  currentProvider,
  currentModel,
  selectModel,
}) {
  const [modelFilter, setModelFilter] = useState('ALL')

  const recommendedModels = models.local.filter(m => m.vram_gb != null && m.vram_gb <= 4)
  const filteredLocalModels = models.local.filter(m => {
    if (modelFilter === 'ALL') return true
    if (modelFilter === 'GPU') return m.vram_gb != null && m.vram_gb <= 4
    if (modelFilter === 'RAM') return m.vram_gb != null && m.vram_gb > 4
    if (modelFilter === 'SPEAK') return m.vram_gb != null && m.vram_gb <= 4
    return true
  })

  const autoSelected = currentProvider === 'auto'

  return (
      <Section title="AI MODEL">
        {/* LET RIVER DECIDE — auto routing via the model intent router */}
        <div
          className={`rs-card is-tappable ${autoSelected ? 'is-elev' : ''}`}
          onClick={() => selectModel({ provider: 'auto', model_id: 'auto' })}
          style={{
            padding: '16px',
            marginBottom: 20,
            borderColor: autoSelected ? 'var(--primary)' : undefined,
            background: autoSelected
              ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
              : 'color-mix(in srgb, var(--md-tertiary) 6%, transparent)',
          }}
        >
          <div className="rs-flex rs-items-center rs-gap-3">
            <span className="material-symbols-rounded" style={{ fontSize: '1.4rem', color: 'var(--primary)' }}>auto_awesome</span>
            <div className="rs-grow">
              <div className="rs-card-value" style={{ fontSize: 'var(--rs-fs-body)', fontWeight: 600 }}>Let River Decide</div>
              <div className="rs-card-meta">
                River picks the best engine per message — local first, then NVIDIA NIM (free)
                or cloud, with an automatic local fallback if a cloud model is unavailable.
              </div>
            </div>
            {autoSelected && (
              <span className="material-symbols-rounded" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>check_circle</span>
            )}
          </div>
        </div>

        {showAdmin && (
          <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--md-outline-variant)' }}>
            <div className="rs-card-label" style={{ marginBottom: 8, color: 'var(--md-primary)' }}>ADMIN MASTER SWITCHES</div>
            <Toggle
              id="llm-routing-local"
              label="Globally Enable Local LLMs (Ollama)"
              checked={llmRoutingFlags.local_enabled}
              onChange={v => saveLlmRoutingFlags({ local_enabled: v })}
            />
            <Toggle
              id="llm-routing-cloud"
              label="Globally Enable Cloud LLMs"
              checked={llmRoutingFlags.cloud_enabled}
              onChange={v => saveLlmRoutingFlags({ cloud_enabled: v })}
            />
          </div>
        )}

        <p className="rs-card-meta rs-mb-4">
          The selected model is used for both Chat and Speak. For Speak, choose a model
          tagged <strong>⚡ GPU / SPEAK</strong> — these fit in your GPU's VRAM and respond
          faster for real-time voice conversation.
        </p>

        {/* RECOMMENDED STRIP */}
        {recommendedModels.length > 0 && (
          <div className="rs-mb-5">
            <div className="rs-card-label" style={{ color: 'var(--md-tertiary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: '0.9rem' }}>bolt</span>
              RECOMMENDED FOR SPEAK
            </div>
            <div className="rs-flex rs-flex-wrap rs-gap-3">
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
        <div className="rs-flex rs-flex-col rs-gap-3">
          {/* QUICK FILTER BAR */}
          <div className="rs-flex rs-gap-2 rs-mb-3">
            {['ALL', 'GPU', 'RAM', 'SPEAK'].map(f => (
              <button
                key={f}
                onClick={() => setModelFilter(f)}
                className={`rs-pill ${modelFilter === f ? 'is-active' : ''}`}
                style={{ fontSize: 'var(--rs-fs-nano)' }}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="rs-card-label rs-mb-2">
            <span className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px', background: 'var(--primary)', color: 'black' }}>LOCAL</span>
            {llmRoutingFlags?.local_enabled
              ? 'Ollama — runs on your machine'
              : 'Disabled globally by admin switch above.'}
          </div>
          <div className="rs-flex rs-flex-wrap rs-gap-3">
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
        <div className="rs-flex rs-flex-col rs-gap-5 rs-mt-5">
          <div className="rs-card-label">
            <span className="rs-pill" style={{ fontSize: 'var(--rs-fs-nano)', padding: '2px 8px', background: 'var(--md-tertiary)', color: 'black' }}>CLOUD</span>
            {llmRoutingFlags?.cloud_enabled
              ? 'API providers — costs per token · requires API key in .env'
              : 'Disabled globally by admin switch above.'}
          </div>

          {['anthropic', 'gemini', 'openai', 'mistral_ai', 'nvidia_nim', 'deepseek', 'qwen'].map(providerKey => {
            const provModels = models.cloud.filter(m => m.provider === providerKey)
            const enabled    = !!enabledProviders[providerKey]
            if (!provModels.length) return null

            const providerNames = {
              anthropic:  'Anthropic Claude',
              gemini:     'Google Gemini',
              openai:     'OpenAI',
              mistral_ai: 'Mistral AI',
              nvidia_nim: 'NVIDIA NIM (free tier)',
              deepseek:   'DeepSeek (cloud · paid)',
              qwen:       'Qwen (cloud · paid)',
            }

            return (
              <div key={providerKey} style={{ opacity: enabled ? 1 : 0.6 }}>
                <div className="rs-flex rs-items-center rs-gap-3 rs-mb-3">
                  <span style={{ fontWeight: 600, fontSize: 'var(--rs-fs-small)' }}>{providerNames[providerKey]}</span>
                  {!enabled && (
                    <span className="rs-card-label" style={{ fontSize: 'var(--rs-fs-nano)', color: 'var(--md-error)' }}>
                      {llmRoutingFlags?.cloud_enabled
                        ? 'LOCKED (MISSING KEY IN .ENV)'
                        : 'DISABLED GLOBALLY BY ADMIN SWITCH'}
                    </span>
                  )}
                  {enabled && (
                    <span className="rs-card-label" style={{ fontSize: 'var(--rs-fs-nano)', color: 'var(--rs-status-nominal)' }}>ENABLED</span>
                  )}
                </div>
                <div className="rs-flex rs-flex-wrap rs-gap-3">
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
  )
}
