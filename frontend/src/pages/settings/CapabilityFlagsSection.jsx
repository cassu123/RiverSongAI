import React from 'react'
import { Section } from './shared.jsx'

export default function CapabilityFlagsSection({ data }) {
  if (!data || !data.flags) return null

  return (
    <Section title="ENVIRONMENT CAPABILITY FLAGS">
      <p className="rs-card-meta rs-mb-4">
        These core capabilities are hard-toggled via <code>.env</code> on the server and require a system restart to take effect. <strong>They are read-only here.</strong>
      </p>

      <div className="rs-flex rs-flex-col" style={{ gap: '16px' }}>
        {data.flags.map(flag => (
          <div key={flag.key} style={{
            padding: '12px 16px',
            background: 'var(--md-surface-container-lowest)',
            border: '1px solid var(--md-outline-variant)',
            borderRadius: 'var(--md-shape-md)'
          }}>
            <div className="rs-flex rs-items-center rs-justify-between rs-mb-2">
              <div style={{ fontWeight: 600, fontSize: 'var(--rs-fs-small)', color: 'var(--md-on-surface)' }}>
                {flag.key}
              </div>
              <div style={{
                fontSize: 'var(--rs-fs-micro)',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
                background: flag.enabled ? 'color-mix(in srgb, var(--rs-status-success) 15%, transparent)' : 'color-mix(in srgb, var(--md-outline) 15%, transparent)',
                color: flag.enabled ? 'var(--rs-status-success)' : 'var(--md-on-surface-variant)'
              }}>
                {flag.enabled ? 'ON' : 'OFF'}
              </div>
            </div>
            
            <p className="rs-mb-3" style={{ fontSize: 'var(--rs-fs-tiny)', color: 'var(--md-on-surface-variant)', lineHeight: 1.4 }}>
              {flag.description}
            </p>
            
            <div style={{
              fontSize: 'var(--rs-fs-micro)',
              fontFamily: 'var(--font-mono, monospace)',
              background: 'var(--md-surface-container)',
              padding: '6px 10px',
              borderRadius: 'var(--md-shape-sm)',
              color: 'var(--md-on-surface)',
              userSelect: 'all',
              border: '1px solid color-mix(in srgb, var(--md-outline) 20%, transparent)'
            }}>
              {flag.env_var}={flag.enabled ? 'true' : 'false'}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
