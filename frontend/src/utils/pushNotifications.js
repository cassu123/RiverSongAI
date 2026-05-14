// Utility to register service worker and subscribe to push notifications.

export async function registerPushNotifications(apiBase = '') {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Not supported in this browser.')
    return { status: 'unsupported' }
  }

  try {
    // 1. Get VAPID public key from backend
    const keyResp = await fetch(`${apiBase}/api/push/vapid-public-key`)
    const { public_key } = await keyResp.json()

    if (!public_key) {
      console.info('[Push] Push notifications not enabled on server.')
      return { status: 'disabled' }
    }

    // 2. Register service worker
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    // 3. Request permission
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      console.info('[Push] Notification permission denied.')
      return { status: 'denied' }
    }

    // 4. Subscribe
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    })

    // 5. Send subscription to backend
    const token = localStorage.getItem('rs-auth-token')
    await fetch(`${apiBase}/api/push/subscribe`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    })

    console.info('[Push] Successfully subscribed to push notifications.')
    return { status: 'subscribed' }
  } catch (err) {
    console.error('[Push] Registration failed:', err)
    return { status: 'error', message: err.message }
  }
}

export async function unregisterPushNotifications(apiBase = '') {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { status: 'unsupported' }
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return { status: 'not-registered' }

    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { status: 'not-subscribed' }

    const endpoint = sub.endpoint
    await sub.unsubscribe()

    const token = localStorage.getItem('rs-auth-token')
    await fetch(`${apiBase}/api/push/unsubscribe`, {
      method: 'DELETE',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ endpoint }),
    })

    console.info('[Push] Successfully unsubscribed.')
    return { status: 'unsubscribed' }
  } catch (err) {
    console.error('[Push] Unregistration failed:', err)
    return { status: 'error', message: err.message }
  }
}

export async function getPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null
  }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  return await reg.pushManager.getSubscription()
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}
