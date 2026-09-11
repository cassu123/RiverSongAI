import React from 'react'
import { Section } from './shared.jsx'

export default function CapabilityFlagsSection({ data }) {
  if (!data || !data.flags) return null

  return (
    <Section title="ENVIRONMENT CAPABILITY FLAGS">
      <p className="rs-card-meta rs-mb-4">
        These core capabilities are hard-toggled via <code>.env</code> on the server and require a system restart to take effect. <strong>They are read-only here.</strong>
      </p>

      <div className="rs-flex rs-flex-col" style={{ gap: 'var(--rs-space-4)' }}>
        {data.flags.map(flag => (
          <div key={flag.key} style={{
            padding: 'var(--rs-space-3) var(--rs-space-4)',
            background: 'var(--md-surface-container-lowest)',
            border: '1px solid var(--md-outline-variant)',
            borderRadius: 'var(--md-shape-md)'
          }}>
            <div className="rs-flex rs-items-center rs-justify-between rs-mb-2">
              <div className="rs-type-small rs-fw-600" style={{ color: 'var(--md-on-surface)' }}>
                {flag.key}
              </div>
              <div className="rs-type-micro rs-fw-700" style={{
                padding: '2px 8px',
                borderRadius: 'var(--md-shape-md)',
                background: flag.enabled ? 'color-mix(in srgb, var(--rs-status-success) 15%, transparent)' : 'color-mix(in srgb, var(--md-outline) 15%, transparent)',
                color: flag.enabled ? 'var(--rs-status-success)' : 'var(--md-on-surface-variant)',
              }}>
                {flag.enabled ? 'ON' : 'OFF'}
              </div>
            </div>
            
            <p className="rs-mb-3 rs-type-tiny" style={{ color: 'var(--md-on-surface-variant)', lineHeight: 1.4 }}>
              {flag.description}
            </p>
            
            <div className="rs-type-micro" style={{
              fontFamily: 'var(--font-mono, monospace)',
              background: 'var(--md-surface-container)',
              padding: 'var(--rs-space-2) var(--rs-space-3)',
              borderRadius: 'var(--md-shape-sm)',
              color: 'var(--md-on-surface)',
              userSelect: 'all',
              border: '1px solid color-mix(in srgb, var(--md-outline) 20%, transparent)',
            }}>
              {flag.env_var}={flag.enabled ? 'true' : 'false'}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
