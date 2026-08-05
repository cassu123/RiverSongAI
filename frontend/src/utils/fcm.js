// =============================================================================
// src/utils/fcm.js
//
// Capacitor FCM registration for the native Android wrap. No-op on web — the
// service worker + Web Push channel handles the browser. On native, this:
//   1) requests notification permission (Android 13+ POST_NOTIFICATIONS)
//   2) registers for FCM push (gets the device token)
//   3) POSTs the token to /api/push/fcm/register with the user's auth token
//   4) deregisters cleanly on logout via unregisterFcm()
//
// Safe to call repeatedly — the listeners are added once and the server-side
// upsert is idempotent.
// =============================================================================

import { Capacitor } from '@capacitor/core'
import { API_BASE } from './useApi.js'

let listenersRegistered = false
let lastToken = null

async function postRegistration(authToken, deviceToken, platform) {
  if (!authToken || !deviceToken) return
  try {
    await fetch(`${API_BASE || ''}/api/push/fcm/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: deviceToken, platform }),
    })
  } catch (err) {
    console.warn('[fcm] register failed:', err)
  }
}

export async function setupFcm(authToken) {
  if (!Capacitor.isNativePlatform()) return
  if (!authToken) return

  let PushNotifications
  try {
    ({ PushNotifications } = await import('@capacitor/push-notifications'))
  } catch (err) {
    console.warn('[fcm] @capacitor/push-notifications missing:', err)
    return
  }

  if (!listenersRegistered) {
    PushNotifications.addListener('registration', (t) => {
      lastToken = t.value
      const platform = Capacitor.getPlatform() || 'android'
      postRegistration(authToken, t.value, platform)
    })
    PushNotifications.addListener('registrationError', (err) => {
      console.warn('[fcm] registration error:', err)
    })
    listenersRegistered = true
  }

  try {
    const perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions()
      if (req.receive !== 'granted') return
    }
    await PushNotifications.register()
  } catch (err) {
    console.warn('[fcm] permission/register error:', err)
  }
}

export async function unregisterFcm(authToken) {
  if (!Capacitor.isNativePlatform()) return
  if (!lastToken || !authToken) return
  try {
    await fetch(`${API_BASE || ''}/api/push/fcm/unregister`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: lastToken }),
    })
  } catch (err) {
    console.warn('[fcm] unregister failed:', err)
  }
  lastToken = null
}
