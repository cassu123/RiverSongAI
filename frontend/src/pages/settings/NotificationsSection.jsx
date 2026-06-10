// =============================================================================
// src/pages/settings/NotificationsSection.jsx
// =============================================================================

import React, { useState, useEffect } from 'react'
import { registerPushNotifications, unregisterPushNotifications } from '../../utils/pushNotifications'
import { API_BASE, Section, Toggle } from './shared.jsx'

// =============================================================================
// NotificationsSection — manage Web Push subscriptions
// =============================================================================

export default function NotificationsSection({ token }) {
  const [status, setStatus] = useState('loading')
  const [working, setWorking] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [serverEnabled, setServerEnabled] = useState(true)

  useEffect(() => {
    // 1. Check server support
    fetch(`${API_BASE}/api/push/vapid-public-key`)
      .then(r => r.json())
      .then(data => {
        if (!data.public_key) setServerEnabled(false)
      })
      .catch(() => setServerEnabled(false))

    // 2. Check current browser subscription
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }

    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setStatus(sub ? 'subscribed' : 'idle')
      })
    })
  }, [])

  const handleToggle = async (val) => {
    setWorking(true)
    if (val) {
      const res = await registerPushNotifications(API_BASE)
      setStatus(res.status === 'subscribed' ? 'subscribed' : 'idle')
    } else {
      const res = await unregisterPushNotifications(API_BASE)
      setStatus('idle')
    }
    setWorking(false)
  }

  const handleTest = async () => {
    setWorking(true)
    setTestResult('')
    try {
      const res = await fetch(`${API_BASE}/api/push/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      setTestResult(`Sent to ${data.sent} device(s).`)
    } catch (err) {
      setTestResult('Failed to send test push.')
    } finally {
      setWorking(false)
    }
  }

  if (!serverEnabled) {
    return (
      <Section title="NOTIFICATIONS">
        <p className="rs-card-meta" style={{ color: 'var(--md-error)' }}>
          Push notifications are disabled in server config. Set <code>PUSH_NOTIFICATIONS_ENABLED=true</code> in <code>.env</code>.
        </p>
      </Section>
    )
  }

  return (
    <Section title="NOTIFICATIONS">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 600 }}>PUSH NOTIFICATIONS</div>
          <p className="rs-card-meta">Receive proactive briefings and system alerts.</p>
        </div>
        <Toggle 
          id="push-toggle"
          checked={status === 'subscribed'}
          onChange={handleToggle}
          disabled={working || status === 'unsupported' || status === 'loading'}
        />
      </div>

      <p className="rs-card-meta" style={{ marginTop: 8 }}>
        {status === 'subscribed' && '✓ This device is active and receiving alerts.'}
        {status === 'idle' && 'Notifications are currently muted for this device.'}
        {status === 'unsupported' && '✗ Web Push is not supported by your browser.'}
        {status === 'loading' && 'Checking status…'}
      </p>

      {status === 'subscribed' && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="rs-pill"
            onClick={handleTest}
            disabled={working}
          >
            {working ? 'SENDING…' : 'TEST NOTIFICATION'}
          </button>
          {testResult && <span className="rs-card-label" style={{ color: 'var(--rs-status-nominal)' }}>{testResult}</span>}
        </div>
      )}
    </Section>
  )
}
