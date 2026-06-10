// =============================================================================
// src/pages/settings/HardwareCookbookSection.jsx
//
// HARDWARE COOKBOOK — admin: detected GPU/RAM/CPU vs. local model fits.
// =============================================================================

import React from 'react'
import { Section } from './shared.jsx'

export default function HardwareCookbookSection({ hardwareCookbook }) {
  return (
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
  )
}
