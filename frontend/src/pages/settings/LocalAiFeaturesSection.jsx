// =============================================================================
// src/pages/settings/LocalAiFeaturesSection.jsx
//
// LOCAL AI FEATURES — admin: global AI capability toggles.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function LocalAiFeaturesSection({ aiFeatures, saveAiFeature }) {
  return (
    <Section title="LOCAL AI FEATURES">
          <p className="rs-card-meta rs-mb-4">
            Toggle advanced AI capabilities. These are global settings that affect all users.
          </p>
          
          <div className="rs-gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-semantic"
                label="Semantic Memory"
                checked={!!aiFeatures.SEMANTIC_MEMORY_ENABLED}
                onChange={v => saveAiFeature('SEMANTIC_MEMORY_ENABLED', v)}
              />
              <p className="rs-card-meta">Use vector search for memory recall</p>
            </div>

            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-vision"
                label="Vision Analysis"
                checked={!!aiFeatures.VISION_ENABLED}
                onChange={v => saveAiFeature('VISION_ENABLED', v)}
              />
              <p className="rs-card-meta">AI photo analysis for inventory & recipes</p>
            </div>

            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-image"
                label="Image Generation"
                checked={!!aiFeatures.IMAGE_GENERATION_ENABLED}
                onChange={v => saveAiFeature('IMAGE_GENERATION_ENABLED', v)}
              />
              <div className="rs-flex rs-items-center rs-gap-2 rs-mt-2">
                <p className="rs-card-meta rs-m-0">Local product/recipe visuals</p>
                <span className="rs-card-label rs-type-nano" style={{ color: 'var(--md-error)' }}>GPU REQ</span>
              </div>
            </div>

            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-rag"
                label="RAG Documents"
                checked={!!aiFeatures.RAG_ENABLED}
                onChange={v => saveAiFeature('RAG_ENABLED', v)}
              />
              <p className="rs-card-meta">Answer questions from documents</p>
            </div>

            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-streaming"
                label="LLM Streaming"
                checked={!!aiFeatures.LLM_STREAMING_ENABLED}
                onChange={v => saveAiFeature('LLM_STREAMING_ENABLED', v)}
              />
              <p className="rs-card-meta">Stream AI responses token by token</p>
            </div>

            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <Toggle
                id="feat-chatterbox"
                label="Chatterbox TTS"
                checked={!!aiFeatures.CHATTERBOX_ENABLED}
                onChange={v => saveAiFeature('CHATTERBOX_ENABLED', v)}
              />
              <div className="rs-flex rs-items-center rs-gap-2 rs-mt-2">
                <p className="rs-card-meta rs-m-0">AI voice cloning for River</p>
                <span className="rs-card-label rs-type-nano" style={{ color: 'var(--md-error)' }}>GPU REQ</span>
              </div>
            </div>
          </div>
          
          <div className="rs-mt-4 rs-flex rs-items-center rs-gap-2" style={{ padding: 'var(--rs-space-3)', background: 'color-mix(in srgb, var(--rs-status-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--rs-status-warning) 45%, transparent)', borderRadius: 'var(--md-shape-sm)' }}>
            <span className="material-symbols-rounded rs-no-shrink" style={{ fontSize: '1rem', color: 'var(--rs-status-warning)' }}>warning</span>
            <span className="rs-type-tiny" style={{ color: 'var(--rs-status-warning)', fontWeight: 600 }}>
              Backend restart required for changes to take effect.
            </span>
          </div>
        </Section>
  )
}
