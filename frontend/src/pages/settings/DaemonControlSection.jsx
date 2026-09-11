// =============================================================================
// src/pages/settings/DaemonControlSection.jsx
//
// DAEMON CONTROL — admin: Warden / Mechanic / Pulse / Scribe / Sifter daemons.
// =============================================================================

import React from 'react'
import { Section, Toggle } from './shared.jsx'

export default function DaemonControlSection({ daemonStatus, aiFeatures, saveAiFeature, triggerDaemonTask }) {
  return (
    <Section title="DAEMON CONTROL">
          <p className="rs-card-meta rs-mb-4">
            Manage background daemon processes. These run as independent services on the server.
          </p>

          <div className="rs-flex rs-flex-col rs-gap-3">
            {/* WARDEN */}
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <div className="rs-flex rs-justify-between rs-items-center rs-gap-3">
                <div className="rs-min-w-0">
                  <div className="rs-type-tiny rs-fw-600">WARDEN (Vision/Security)</div>
                  <div className="rs-card-meta rs-m-0">RTSP Camera Monitoring</div>
                </div>
                <div className="rs-flex rs-items-center rs-gap-3 rs-no-shrink">
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
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <div className="rs-flex rs-justify-between rs-items-center rs-gap-3">
                <div className="rs-min-w-0">
                  <div className="rs-type-tiny rs-fw-600">MECHANIC (Telemetry)</div>
                  <div className="rs-card-meta rs-m-0">MAVLink / ArduRover Link</div>
                </div>
                <div className="rs-flex rs-items-center rs-gap-3 rs-no-shrink">
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
                <div className="rs-mt-3 rs-flex rs-gap-2">
                  <button className="rs-pill" onClick={() => triggerDaemonTask('mechanic', 'telemetry')}>TELEMETRY</button>
                  <button className="rs-pill" onClick={() => triggerDaemonTask('mechanic', 'arm')}>ARM ROVER</button>
                </div>
              )}
            </div>

            {/* PULSE */}
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <div className="rs-flex rs-justify-between rs-items-center rs-gap-3">
                <div className="rs-min-w-0">
                  <div className="rs-type-tiny rs-fw-600">PULSE (Ambient Feeds)</div>
                  <div className="rs-card-meta rs-m-0">News, Markets, and Flights Poller</div>
                </div>
                <div className="rs-flex rs-items-center rs-gap-3 rs-no-shrink">
                  <span className="rs-card-label" style={{ color: daemonStatus.pulse?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
                    {daemonStatus.pulse?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="pulse-toggle"
                    label=""
                    checked={!!aiFeatures.DAEMON_PULSE_ENABLED}
                    onChange={v => saveAiFeature('DAEMON_PULSE_ENABLED', v)}
                  />
                </div>
              </div>
            </div>

            {/* SCRIBE */}
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <div className="rs-flex rs-justify-between rs-items-center rs-gap-3">
                <div className="rs-min-w-0">
                  <div className="rs-type-tiny rs-fw-600">SCRIBE (Chronos Heuristics)</div>
                  <div className="rs-card-meta rs-m-0">Schedule & Chronobiology Heuristics</div>
                </div>
                <div className="rs-flex rs-items-center rs-gap-3 rs-no-shrink">
                  <span className="rs-card-label" style={{ color: daemonStatus.scribe?.alive ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
                    {daemonStatus.scribe?.alive ? '● ONLINE' : '○ OFFLINE'}
                  </span>
                  <Toggle
                    id="scribe-toggle"
                    label=""
                    checked={!!aiFeatures.DAEMON_SCRIBE_ENABLED}
                    onChange={v => saveAiFeature('DAEMON_SCRIBE_ENABLED', v)}
                  />
                </div>
              </div>
            </div>

            {/* SIFTER */}
            <div className="rs-p-4" style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)', borderRadius: 'var(--md-shape-md)' }}>
              <div className="rs-flex rs-justify-between rs-items-center rs-gap-3">
                <div className="rs-min-w-0">
                  <div className="rs-type-tiny rs-fw-600">SIFTER (RAG)</div>
                  <div className="rs-card-meta rs-m-0">Background Document Indexing</div>
                </div>
                <div className="rs-flex rs-items-center rs-gap-3 rs-no-shrink">
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
