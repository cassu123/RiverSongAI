// =============================================================================
// src/pages/settings/VoiceIDSection.jsx
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react'
import { useAudioRecorder } from '../../hooks/useAudioRecorder'
import { Section } from './shared.jsx'

export default function VoiceIDSection({ token }) {
  const [status, setStatus] = useState(null)
  const [recording, setRecording] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/voice-id/me', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setStatus(await res.json())
    } catch (e) {
      console.error('Failed to fetch Voice ID status:', e)
    }
  }, [token])

  useEffect(() => { refreshStatus() }, [refreshStatus])

  const onComplete = useCallback(async (wavB64) => {
    setRecording(false)
    setCountdown(0)
    setError('')
    setSuccess('')
    
    try {
      const binary = atob(wavB64)
      const array = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)
      const blob = new Blob([array], { type: 'audio/wav' })

      const formData = new FormData()
      formData.append('file', blob, 'sample.wav')
      
      const res = await fetch('/api/voice-id/enroll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      
      if (!res.ok) {
        const txt = await res.text()
        setError('Enrollment failed: ' + txt)
        return
      }
      
      const result = await res.json()
      setSuccess(`Sample added. You now have ${result.sample_count} samples.`)
      await refreshStatus()
    } catch (e) {
      setError('Enrollment error: ' + e.message)
    }
  }, [token, refreshStatus])

  const recorder = useAudioRecorder({ onComplete })

  const startEnroll = async () => {
    setError('')
    setSuccess('')
    const ok = await recorder.startRecording()
    if (!ok) {
      setError('Could not start microphone.')
      return
    }

    setRecording(true)
    let left = 5
    setCountdown(left)
    const interval = setInterval(() => {
      left -= 1
      setCountdown(left)
      if (left <= 0) {
        clearInterval(interval)
        recorder.stopRecording()
      }
    }, 1000)
  }

  const deleteEnrollment = async () => {
    setConfirmDelete(false)
    try {
      await fetch('/api/voice-id/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      await refreshStatus()
      setSuccess('Enrollment deleted.')
    } catch (e) {
      setError('Delete failed: ' + e.message)
    }
  }

  if (!status) return null

  return (
    <Section title="VOICE ID">
      <div style={{ marginBottom: 16 }}>
        {status.enrolled ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '1.1rem', color: 'var(--rs-status-nominal)', flexShrink: 0, marginTop: 1 }}>check_circle</span>
            <div>
              <div style={{ color: 'var(--rs-status-nominal)', fontSize: '0.875rem', fontWeight: 600 }}>
                ENROLLED — {status.sample_count} SAMPLES
              </div>
              <div className="rs-card-meta">
                Last updated: {new Date(status.last_updated).toLocaleString()}
              </div>
            </div>
          </div>
        ) : (
          <p className="rs-card-meta">
            River Song doesn't recognize your voice yet. Record 3–5 samples to enable speaker recognition on kiosks.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button 
          className="rs-btn-primary" 
          onClick={startEnroll} 
          disabled={recording || recorder.isRecording}
          style={{ padding: '10px 20px' }}
        >
          <span className="material-symbols-rounded">{recording ? 'radio_button_checked' : 'mic'}</span>
          {recording ? `RECORDING... ${countdown}S` : 'RECORD SAMPLE'}
        </button>

        {status.sample_count > 0 && !recording && !confirmDelete && (
          <button className="rs-pill" onClick={() => setConfirmDelete(true)} style={{ color: 'var(--md-error)', cursor: 'pointer' }}>
            DELETE ENROLLMENT
          </button>
        )}
      </div>

      {confirmDelete && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginTop: 8,
          background: 'color-mix(in srgb, var(--md-error) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--md-error) 35%, transparent)',
          borderRadius: 8, fontSize: '0.8rem',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '1rem', color: 'var(--md-error)', flexShrink: 0 }}>warning</span>
          <span style={{ flex: 1 }}>Delete your voice prints? River Song will no longer recognize your voice.</span>
          <button className="rs-pill" style={{ color: 'var(--md-error)', cursor: 'pointer' }} onClick={deleteEnrollment}>DELETE</button>
          <button className="rs-pill" style={{ cursor: 'pointer' }} onClick={() => setConfirmDelete(false)}>CANCEL</button>
        </div>
      )}

      {error && <div className="rs-card-meta" style={{ color: 'var(--md-error)' }}>{error}</div>}
      {success && <div className="rs-card-meta" style={{ color: 'var(--rs-status-nominal)' }}>{success}</div>}

      <p className="rs-card-meta">
        Recommended: at least 3 samples of about 5 seconds each.
      </p>
    </Section>
  )
}
