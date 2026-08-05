// =============================================================================
// src/pages/settings/VoiceSection.jsx
// =============================================================================

import React, { useState } from 'react'

// =============================================================================
// Voice Section — curated voice registry with install status + live switching
// =============================================================================

const QUALITY_LABELS = { fast: 'Fast', balanced: 'Balanced', high: 'High Quality' }
const ACCENT_ORDER   = ['American', 'British', 'British (Northern)']
const ENGINE_LABELS  = { piper: 'Piper', kokoro: 'Kokoro · CPU' }
const ENGINE_COLORS  = { piper: 'var(--md-outline)', kokoro: 'var(--md-tertiary)' }

async function playVoicePreview(voice_id, token) {
  const res = await fetch(`/api/tts/preview/${voice_id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || res.statusText)
  }
  const { audio_b64 } = await res.json()
  const binary = atob(audio_b64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const ctx    = new AudioContext()
  const buffer = await ctx.decodeAudioData(bytes.buffer)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return new Promise(resolve => { source.onended = () => { ctx.close(); resolve() } })
}

export default function VoiceSection({ voiceSettings, token, user, elevenLabsSettings, onSaveElevenLabs, onSwitched }) {
  const [switching, setSwitching] = useState(null)
  const [switchMsg, setSwitchMsg] = useState('')
  const [previewing, setPreviewing] = useState(null)
  const [previewErr, setPreviewErr] = useState('')
  const [accentFilter, setAccentFilter] = useState('ALL')

  if (voiceSettings.provider === 'none') {
    return (
      <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
        TTS is disabled. Set <code>TTS_PROVIDER=piper</code> in <code>.env</code> to enable speech.
      </p>
    )
  }

  const voices  = voiceSettings.voices || []
  const accents = [...new Set(voices.map(v => v.accent))]
    .sort((a, b) => (ACCENT_ORDER.indexOf(a) + 99) - (ACCENT_ORDER.indexOf(b) + 99))

  const handlePreview = async (voice_id) => {
    setPreviewing(voice_id)
    setPreviewErr('')
    try {
      await playVoicePreview(voice_id, token)
    } catch (e) {
      setPreviewErr(`Preview failed: ${e.message}`)
    } finally {
      setPreviewing(null)
    }
  }

  const handleSelect = async (voice_id) => {
    setSwitching(voice_id)
    setSwitchMsg('')
    try {
      const res = await fetch('/api/settings/voice', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body:    JSON.stringify({ voice_id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Switch failed')
      setSwitchMsg(`✓ Switched to ${data.display_name}.`)
      onSwitched()
    } catch (e) {
      setSwitchMsg(`✗ ${e.message}`)
    } finally {
      setSwitching(null)
    }
  }

  return (
    <>
      <p className="rs-card-meta" style={{ marginBottom: 16 }}>
        <strong>{voiceSettings.provider_label}</strong> · Active:{' '}
        <span className="rs-pill is-active" style={{ fontSize: '0.75rem' }}>{voiceSettings.active_voice}</span>
      </p>

      {/* ELEVENLABS STATUS (Admin Only) — credentials live in .env */}
      {user?.role === 'admin' && elevenLabsSettings && (
        <div className="rs-card" style={{
          marginBottom: 24, padding: 16,
          background: 'var(--md-surface-container-high)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="rs-card-label" style={{ color: 'var(--md-primary)' }}>
              ELEVENLABS
            </div>
            <span className="rs-card-label" style={{ color: elevenLabsSettings.api_key ? 'var(--rs-status-nominal)' : 'var(--md-outline)' }}>
              {elevenLabsSettings.api_key ? '● KEY LOADED' : '○ NO KEY'}
            </span>
          </div>
          <p className="rs-card-meta" style={{ margin: 0 }}>
            Set <code>ELEVENLABS_API_KEY</code>, <code>ELEVENLABS_VOICE_ID</code>, and{' '}
            <code>ELEVENLABS_MODEL_ID</code> in <code>.env</code> to enable cloud voices.
            {voiceSettings.provider === 'elevenlabs' && (
              <span style={{ color: 'var(--rs-status-nominal)', marginLeft: 8 }}>● ACTIVE</span>
            )}
          </p>
        </div>
      )}

      {switchMsg && (
        <p className="rs-card-meta" style={{ color: switchMsg.startsWith('✓') ? 'var(--rs-status-nominal)' : 'var(--md-error)' }}>
          {switchMsg}
        </p>
      )}

      {previewErr && (
        <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
          {previewErr}
        </p>
      )}

      {/* ACCENT FILTER TABS */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {['ALL', ...accents].map(accent => (
          <button
            key={accent}
            onClick={() => setAccentFilter(accent)}
            className={`rs-pill ${accentFilter === accent ? 'is-active' : ''}`}
            style={{ fontSize: '0.7rem' }}
          >
            {accent}
          </button>
        ))}
      </div>

      {accents.filter(a => accentFilter === 'ALL' || a === accentFilter).map(accent => {
        const av      = voices.filter(v => v.accent === accent)
        const females = av.filter(v => v.gender === 'female')
        const males   = av.filter(v => v.gender === 'male')

        return (
          <div key={accent} style={{ marginBottom: 24 }}>
            <div className="rs-card-label" style={{ marginBottom: 12 }}>{accent}</div>

            {[{ label: 'Female', list: females, color: 'var(--md-tertiary)' },
              { label: 'Male',   list: males,   color: 'var(--md-primary)'  }]
              .filter(g => g.list.length > 0)
              .map(({ label, list, color }) => (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div className="rs-card-label" style={{ fontSize: '0.65rem', color, marginBottom: 8 }}>
                    {label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                    {list.map(v => (
                      <div
                        key={v.voice_id}
                        className={`rs-card is-tappable ${v.active ? 'is-elev' : ''} ${!v.installed ? 'is-disabled' : ''}`}
                        onClick={() => v.installed && !v.active && handleSelect(v.voice_id)}
                        style={{ opacity: v.installed ? 1 : 0.5, borderColor: v.active ? 'var(--primary)' : undefined }}
                      >
                        <div className="rs-card-value" style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>
                          {v.display_name}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                          <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                            {QUALITY_LABELS[v.quality] || v.quality}
                          </span>
                          <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                            {ENGINE_LABELS[v.engine] || v.engine}
                          </span>
                        </div>

                        <div className="rs-card-meta" style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
                          {v.description}
                        </div>

                        {v.installed && (
                          <button
                            onClick={e => { e.stopPropagation(); handlePreview(v.voice_id) }}
                            disabled={previewing === v.voice_id}
                            className="rs-pill"
                            style={{ marginTop: 12, fontSize: '0.7rem' }}
                          >
                            <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>{previewing === v.voice_id ? 'volume_up' : 'play_arrow'}</span>
                            {previewing === v.voice_id ? 'PLAYING…' : 'PREVIEW'}
                          </button>
                        )}

                        {!v.installed && <div className="rs-card-meta" style={{ color: 'var(--md-error)', fontWeight: 700 }}>NOT INSTALLED</div>}
                        {v.active && (
                          <div style={{ position: 'absolute', top: 12, right: 12 }}>
                             <span className="material-symbols-rounded" style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>check_circle</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )
      })}
    </>
  )
}
