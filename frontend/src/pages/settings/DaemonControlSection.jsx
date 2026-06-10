// =============================================================================
// src/pages/settings/DaemonControlSection.jsx
//
// DAEMON CONTROL — admin: Warden / Mechanic / Herald / Sifter daemons.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function DaemonControlSection({ daemonStatus, aiFeatures, saveAiFeature, triggerDaemonTask }) {
  return (
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
  )
}
