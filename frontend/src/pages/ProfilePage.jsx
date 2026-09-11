import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@context/AuthContext'
import { registerPushNotifications } from '../utils/pushNotifications'

/**
 * ProfilePage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Personal identity and UI environment controller.
 */

const UNIVERSES = [
  { key: 'dune',      label: 'DUNE',       hint: 'Desert power. High-end ceramics, spice-dust, and noble houses.' },
  { key: 'halo',      label: 'HALO',       hint: 'Ancient hard-light and military industrial steel.' },
  { key: 'mv',        label: 'MONUMENT',   hint: 'Impossible architecture and pastel zeniths.' },
  { key: 'nightcity', label: 'NIGHT CITY', hint: 'Neon dystopia. Corporate chrome and Pacifica decay.' },
]

const ENVIRONMENTS = {
  dune:      [{ key: 'atreides',   label: 'ATREIDES',   primary: '#deb651', bg: '#1a1209' },
              { key: 'harkonnen',  label: 'HARKONNEN',  primary: '#c53a1f', bg: '#0a0606' },
              { key: 'arrakis',    label: 'ARRAKIS',    primary: '#d47438', bg: '#1a0a04' }],
  halo:      [{ key: 'forerunner', label: 'FORERUNNER', primary: '#00e5ff', bg: '#050c14' },
              { key: 'unsc',       label: 'UNSC',       primary: '#f08c32', bg: '#0c1116' }],
  mv:        [{ key: 'spires',     label: 'SACRED SPIRES',    primary: '#a0a8c0', bg: '#1a1a2e' },
              { key: 'garden',     label: 'GARDEN PAVILION',  primary: '#d8a878', bg: '#1f1812' }],
  nightcity: [{ key: 'corpo',      label: 'CORPO PLAZA',      primary: '#c8c8d4', bg: '#0e0e14' },
              { key: 'pacifica',   label: 'PACIFICA STREET',  primary: '#e8ff00', bg: '#0a0a05' }],
}

const MOODS = {
  atreides:   [{ key: 'caladan',          label: 'CALADAN',          primary: '#deb651', bg: '#1a1209' },
               { key: 'spice-hall',       label: 'SPICE HALL',       primary: '#deb651', bg: '#0b0805' }],
  harkonnen:  [{ key: 'giedi',            label: 'GIEDI PRIME',      primary: '#7a8390', bg: '#050505' },
               { key: 'bloodlight',       label: 'BLOODLIGHT',       primary: '#c53a1f', bg: '#140c0b' }],
  arrakis:    [{ key: 'deep-desert',      label: 'DEEP DESERT',      primary: '#d47438', bg: '#1a0a04' },
               { key: 'wormsign',         label: 'WORMSIGN',         primary: '#8a4820', bg: '#0a0402' }],
  forerunner: [{ key: 'hard-light',       label: 'HARD-LIGHT',       primary: '#00e5ff', bg: '#050c14' },
               { key: 'ceramic-veil',     label: 'CERAMIC VEIL',     primary: '#a8e0ff', bg: '#0a1820' }],
  unsc:       [{ key: 'combat-steel',     label: 'COMBAT STEEL',     primary: '#f08c32', bg: '#0c1116' },
               { key: 'night-vision',     label: 'NIGHT VISION',     primary: '#3dcc79', bg: '#050805' }],
  spires:     [{ key: 'sacred',           label: 'SACRED',           primary: '#a0a8c0', bg: '#1a1a2e' },
               { key: 'daybreak-temple',  label: 'DAYBREAK TEMPLE',  primary: '#e0c0ff', bg: '#1c152a' },
               { key: 'twilight-spires',  label: 'TWILIGHT SPIRES',  primary: '#7888f8', bg: '#101020' }],
  garden:     [{ key: 'pastel-day',       label: 'PASTEL DAY',       primary: '#d8a878', bg: '#1f1812' },
               { key: 'dusk-pavilion',    label: 'DUSK PAVILION',    primary: '#f8a878', bg: '#251a14' }],
  corpo:      [{ key: 'chrome',           label: 'CHROME',           primary: '#c8c8d4', bg: '#0e0e14' },
               { key: 'executive',        label: 'EXECUTIVE',        primary: '#ff40a0', bg: '#100a12' }],
  pacifica:   [{ key: 'glitch-street',    label: 'GLITCH STREET',    primary: '#e8ff00', bg: '#0a0a05' },
               { key: 'smoke',            label: 'SMOKE',            primary: '#a0ffaa', bg: '#080c08' }],
}

// Each connectable service fetches its provider auth URL (with the JWT in
// the Authorization header) and then redirects the window to it. Services
// without a built OAuth flow yet are flagged comingSoon so the button is
// disabled instead of navigating to a 404.
const SERVICES = [
  {
    key: 'google',
    name: 'Google Workspace',
    icon: 'account_circle',
    authorizeUrl: '/api/integrations/google/authorize'
  },
  {
    key: 'amazon_sp_api',
    name: 'Amazon Seller Central',
    icon: 'storefront',
    comingSoon: true
  },
  {
    key: 'shopify',
    name: 'Shopify Store',
    icon: 'shopping_bag',
    requiresInput: true,
    inputLabel: 'Store URL',
    inputPlaceholder: 'your-store.myshopify.com',
    authorizeUrl: (input) => `/api/shopify/auth/url?shop=${encodeURIComponent(input)}`
  },
  {
    key: 'walmart',
    name: 'Walmart Marketplace',
    icon: 'store',
    comingSoon: true
  },
  {
    key: 'tiktok',
    name: 'TikTok Shop',
    icon: 'video_library',
    comingSoon: true
  }
]

/* =============================================================================
 * Two-Factor Authentication card — Q1#5
 *   Status fetch → enroll (QR + verify + recovery codes) → optionally disable.
 *   Reuses existing rs-card / rs-pill / rs-btn-primary classes — no new CSS.
 * ============================================================================= */
function TwoFactorCard({ token }) {
  const [status, setStatus]               = React.useState(null)
  const [phase, setPhase]                 = React.useState('idle')  // idle | enrolling | confirming | showing-codes | disabling
  const [enrollment, setEnrollment]       = React.useState(null)    // {secret, qr_png_b64, otpauth_uri}
  const [verifyCode, setVerifyCode]       = React.useState('')
  const [recoveryCodes, setRecoveryCodes] = React.useState(null)    // shown ONCE after enrol
  const [disablePwd, setDisablePwd]       = React.useState('')
  const [disableCode, setDisableCode]     = React.useState('')
  const [error, setError]                 = React.useState('')

  const refreshStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/auth/2fa/status', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setStatus(await res.json())
    } catch (e) { /* swallow — card just stays in idle */ }
  }, [token])

  React.useEffect(() => { refreshStatus() }, [refreshStatus])

  const beginEnrol = async () => {
    setError('')
    try {
      const res = await fetch('/api/auth/2fa/enroll/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e.detail || 'Could not start enrolment.')
        return
      }
      setEnrollment(await res.json())
      setPhase('confirming')
    } catch (e) {
      setError('Network error.')
    }
  }

  const confirmEnrol = async () => {
    setError('')
    if (!verifyCode || verifyCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator.')
      return
    }
    try {
      const res = await fetch('/api/auth/2fa/enroll/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ secret: enrollment.secret, code: verifyCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Code did not match — try the next one.')
        return
      }
      setRecoveryCodes(data.recovery_codes || [])
      setVerifyCode('')
      setEnrollment(null)
      setPhase('showing-codes')
      refreshStatus()
    } catch (e) {
      setError('Network error.')
    }
  }

  const cancelEnrol = () => {
    setEnrollment(null)
    setVerifyCode('')
    setError('')
    setPhase('idle')
  }

  const dismissRecoveryCodes = () => {
    setRecoveryCodes(null)
    setPhase('idle')
  }

  const disable2fa = async () => {
    setError('')
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: disablePwd, code: disableCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Could not disable 2FA.')
        return
      }
      setDisablePwd('')
      setDisableCode('')
      setPhase('idle')
      refreshStatus()
    } catch (e) {
      setError('Network error.')
    }
  }

  const enabled = !!status?.enabled

  return (
    <div className="rs-card is-wide">
      <div className="rs-card-head">
        <span className="rs-card-label">TWO-FACTOR AUTHENTICATION</span>
        <span className="rs-card-label" style={{ color: enabled ? 'var(--primary)' : 'var(--md-outline)', opacity: 1 }}>
          {enabled ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>

      {phase === 'idle' && !enabled && (
        <div className="rs-flex rs-gap-4 rs-items-center rs-flex-wrap">
          <div className="rs-grow" style={{ minWidth: 200 }}>
            <div className="rs-card-meta">
              Protect your account with an authenticator app (Aegis, 1Password, Authy, Google Authenticator).
              You'll be asked for a 6-digit code on every login.
            </div>
          </div>
          <button className="rs-btn-primary" onClick={beginEnrol}>ENABLE 2FA</button>
        </div>
      )}

      {phase === 'idle' && enabled && (
        <div className="rs-flex rs-gap-4 rs-items-center rs-flex-wrap">
          <div className="rs-grow" style={{ minWidth: 200 }}>
            <div className="rs-card-meta">
              2FA is active. {status?.recovery_codes_left ?? 0} recovery {(status?.recovery_codes_left ?? 0) === 1 ? 'code' : 'codes'} remaining.
            </div>
          </div>
          <button className="rs-pill" onClick={() => setPhase('disabling')}>DISABLE 2FA</button>
        </div>
      )}

      {phase === 'confirming' && enrollment && (
        <div className="rs-flex rs-gap-5 rs-flex-wrap rs-items-start">
          {enrollment.qr_png_b64 && (
            <img
              src={`data:image/png;base64,${enrollment.qr_png_b64}`}
              alt="2FA QR code"
              className="rs-p-3" style={{ width: 180, height: 180, background: 'white', borderRadius: 'var(--md-shape-sm)' }}
            />
          )}
          <div className="rs-grow" style={{ minWidth: 240 }}>
            <div className="rs-card-meta rs-mb-2">
              Scan the code, or paste this secret manually:
            </div>
            <code
              className="rs-mb-4 rs-type-tiny" style={{
                display: 'block',
                padding: 'var(--rs-space-2) var(--rs-space-3)',
                background: 'var(--md-surface-container)',
                borderRadius: 'var(--md-shape-xs)',
                wordBreak: 'break-all',
              }}
            >
              {enrollment.secret}
            </code>
            <div className="rs-card-label rs-mb-2 rs-type-nano">VERIFY WITH FIRST CODE</div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="rs-pill rs-w-full"
              style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)', letterSpacing: '0.2em' }}
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            <div className="rs-flex rs-gap-3 rs-mt-4">
              <button className="rs-btn-primary" onClick={confirmEnrol}>CONFIRM</button>
              <button className="rs-pill" onClick={cancelEnrol}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'showing-codes' && recoveryCodes && (
        <div>
          <div className="rs-card-meta rs-mb-3">
            Save these recovery codes somewhere safe. Each works once and replaces the 6-digit code
            if you ever lose your authenticator. <strong>You will not see them again.</strong>
          </div>
          <div
            className="rs-gap-2 rs-mb-4 rs-p-3" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
              background: 'var(--md-surface-container)',
              borderRadius: 'var(--md-shape-sm)',
            }}
          >
            {recoveryCodes.map((c, i) => (
              <code key={i} className="rs-text-center rs-type-small">{c}</code>
            ))}
          </div>
          <button className="rs-btn-primary" onClick={dismissRecoveryCodes}>I'VE SAVED THEM</button>
        </div>
      )}

      {phase === 'disabling' && (
        <div className="rs-flex rs-flex-col rs-gap-3" style={{ maxWidth: 360 }}>
          <div className="rs-card-meta">Confirm with your password and a current 6-digit code.</div>
          <input
            type="password"
            className="rs-pill"
            style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)' }}
            placeholder="Password"
            value={disablePwd}
            onChange={e => setDisablePwd(e.target.value)}
          />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            className="rs-pill"
            style={{ padding: 'var(--rs-space-3) var(--rs-space-4)', background: 'var(--md-surface-container)', letterSpacing: '0.2em' }}
            placeholder="000000"
            value={disableCode}
            onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="rs-flex rs-gap-3">
            <button className="rs-btn-primary" onClick={disable2fa}>DISABLE 2FA</button>
            <button className="rs-pill" onClick={() => { setPhase('idle'); setError('') }}>CANCEL</button>
          </div>
        </div>
      )}

      {error && (
        <div className="rs-card-meta rs-mt-3" style={{ color: 'var(--md-error)' }}>{error}</div>
      )}
    </div>
  )
}


export default function ProfilePage({
  profile = {}, onSave = () => {},
  universe = 'dune', environment = 'atreides', mood = 'caladan',
  onUniverseChange = () => {}, onEnvironmentChange = () => {}, onMoodChange = () => {},
  embedded = false,
}) {
  const { user, token } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.displayName || user?.display_name || '')
  const [pushStatus, setPushStatus] = useState('idle')
  const [saveStatus, setSaveStatus] = useState(null)
  
  const [integrations, setIntegrations] = useState(null)
  const [disconnecting, setDisconnecting] = useState(null)

  useEffect(() => {
    if (user?.role === 'admin') {
      fetch('/api/integrations/status', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          if (data && data.integrations) setIntegrations(data.integrations)
        })
        .catch(err => console.error('Failed to load integrations', err))
    }
  }, [user, token])

  const handleConnect = async (serviceKey) => {
    const serviceConfig = SERVICES.find(s => s.key === serviceKey);
    if (!serviceConfig || serviceConfig.comingSoon) return;

    let url = serviceConfig.authorizeUrl;
    if (serviceConfig.requiresInput) {
      const userInput = prompt(`Enter your ${serviceConfig.inputLabel} (${serviceConfig.inputPlaceholder}):`);
      if (!userInput) return;
      url = serviceConfig.authorizeUrl(userInput.trim());
    }

    // A plain navigation can't carry the Authorization header, so fetch the
    // provider auth URL with the JWT and redirect the window to the result.
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.auth_url) throw new Error('No auth URL returned.');
      window.location.href = data.auth_url;
    } catch (err) {
      console.error(`[ProfilePage] ${serviceKey} connect failed:`, err);
      alert(`Could not start ${serviceConfig.name} connection: ${err.message}`);
    }
  }

  const handleDisconnect = async (service) => {
    setDisconnecting(service);
    try {
      await fetch(`/api/integrations/${service}/disconnect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const res = await fetch('/api/integrations/status', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      // Normalize: initial load unwraps .integrations; do the same here so
      // state shape stays consistent across the page lifetime.
      if (data && typeof data === 'object') {
        setIntegrations(data.integrations ?? data);
      }
    } catch (err) {
      console.error('Disconnect failed', err);
    } finally {
      setDisconnecting(null);
    }
  }

  const handleSaveProfile = async () => {
    setSaveStatus('SAVING...')
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: displayName })
      })
      if (res.ok) {
        onSave({ ...profile, displayName })
        setSaveStatus('IDENTITY SYNCED')
      }
    } catch {
      setSaveStatus('SYNC ERROR')
    }
    setTimeout(() => setSaveStatus(null), 3000)
  }

  const handlePushEnable = async () => {
    setPushStatus('linking...')
    try {
      const success = await registerPushNotifications(token)
      setPushStatus(success ? 'linked' : 'failed')
    } catch {
      setPushStatus('failed')
    }
  }

  return (
    <div className={`rs-foyer animate-fade-in ${embedded ? 'embedded-profile' : ''}`}>
      
      {/* Header (only shown if not embedded in Settings Hub) */}
      {!embedded && (
        <div className="rs-foyer-head">
          <h1 className="rs-greeting">Identity & Context</h1>
          <div className="rs-greeting-sub">Define your presence and calibrate the visual stage.</div>
        </div>
      )}

      <div className="rs-card-flow">

        {/* Identity Card */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
             <span className="rs-card-label">PROFILE IDENTITY</span>
             {saveStatus && <span className="rs-card-label" style={{ color: 'var(--primary)', opacity: 1 }}>{saveStatus}</span>}
          </div>
          <div className="rs-flex rs-gap-5 rs-flex-wrap" style={{ alignItems: 'flex-end' }}>
            <div className="rs-grow" style={{ minWidth: 240 }}>
              <div className="rs-card-label rs-mb-2 rs-type-micro">DISPLAY NAME</div>
              <input 
                type="text" 
                className="rs-pill rs-w-full rs-type-body" 
                style={{ padding: 'var(--rs-space-3) var(--rs-space-5)', background: 'var(--md-surface-container)' }}
                value={displayName} 
                onChange={e => setDisplayName(e.target.value)} 
              />
            </div>
            <button className="rs-btn-primary rs-type-small" style={{ padding: 'var(--rs-space-3) var(--rs-space-5)' }} onClick={handleSaveProfile}>SAVE CHANGES</button>
          </div>
          <div className="rs-card-meta rs-mt-5 rs-flex rs-gap-6">
            <div>
              <div className="rs-card-label rs-type-nano">ACCOUNT EMAIL</div>
              <div className="rs-mt-1 rs-type-body">{user?.email}</div>
            </div>
            <div>
              <div className="rs-card-label rs-type-nano">ROLE & CLEARANCE</div>
              <div className="rs-mt-1 rs-type-body" style={{ color: user?.role === 'admin' ? '#96cbff' : 'var(--primary)', fontWeight: 700 }}>
                {user?.role ? user.role.toUpperCase() : 'USER'}
              </div>
            </div>
          </div>
        </div>

        {/* Universe Selector */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">VISUAL THEME</span>
          </div>
          <div className="rs-gap-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {UNIVERSES.map(u => (
              <div 
                key={u.key} 
                className={`rs-card is-tappable ${universe === u.key ? 'is-elev' : ''}`}
                style={{ borderColor: universe === u.key ? 'var(--primary)' : undefined }}
                onClick={() => onUniverseChange(u.key)}
              >
                <div className="rs-card-value rs-type-body" style={{ letterSpacing: '0.06em' }}>{u.label}</div>
                <div className="rs-card-meta rs-type-tiny">{u.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Environment & Mood */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">ENVIRONMENT</span>
          </div>
          <div className="rs-flex rs-flex-col rs-gap-2">
            {(ENVIRONMENTS[universe] || []).map(e => (
              <button 
                key={e.key} 
                className={`rs-pill ${environment === e.key ? 'is-active' : ''}`}
                onClick={() => onEnvironmentChange(e.key)}
                style={{ justifyContent: 'space-between', padding: 'var(--rs-space-3) var(--rs-space-4)', fontSize: 'var(--rs-fs-small)' }}
              >
                <span>{e.label}</span>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: e.primary }} />
              </button>
            ))}
          </div>
        </div>

        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">ATMOSPHERIC MOOD</span>
          </div>
          <div className="rs-flex rs-flex-col rs-gap-2">
            {(MOODS[environment] || []).map(m => (
              <button 
                key={m.key} 
                className={`rs-pill ${mood === m.key ? 'is-active' : ''}`}
                onClick={() => onMoodChange(m.key)}
                style={{ justifyContent: 'space-between', padding: 'var(--rs-space-3) var(--rs-space-4)', fontSize: 'var(--rs-fs-small)' }}
              >
                <span>{m.label}</span>
                {mood === m.key && <span className="material-symbols-rounded" style={{ fontSize: '1.1rem' }}>check</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Device Push Notifications */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">PUSH NOTIFICATIONS</span>
          </div>
          <div className="rs-flex rs-items-center rs-gap-5 rs-flex-wrap">
            <div className="rs-grow">
              <div className="rs-card-value rs-type-body">Device Push Alerts</div>
              <div className="rs-card-meta rs-type-small">Enable push notifications to receive system briefings, alerts, and smart home events directly on this device.</div>
            </div>
            <button 
              className={`rs-btn-primary ${pushStatus === 'linked' ? 'is-active' : ''}`} 
              disabled={pushStatus === 'linked'}
              onClick={handlePushEnable}
              style={{ padding: 'var(--rs-space-3) var(--rs-space-5)', fontSize: 'var(--rs-fs-small)' }}
            >
              {pushStatus === 'linked' ? 'LINK ESTABLISHED' : 'AUTHORIZE LINK'}
            </button>
          </div>
        </div>

        {/* Two-Factor Authentication (Q1#5) */}
        <TwoFactorCard token={token} />

        {/* Admin Integrations (Links) */}
        {user?.role === 'admin' && integrations && (
          <div className="rs-card is-wide">
            <div className="rs-card-head">
              <span className="rs-card-label">CONNECTED ACCOUNTS</span>
            </div>
            <div className="rs-flex rs-flex-col rs-gap-4">
              <p className="rs-card-meta">
                Connect your personal accounts to enable analytics and integrations. 
                Your credentials are securely stored and never shared.
              </p>
              
              <div className="rs-flex rs-flex-col rs-gap-3">
                {SERVICES.map(service => {
                  // Status shape: { connected: bool, metadata: {...} } — never
                  // truthiness-check the object itself, it's always truthy.
                  const status = integrations?.[service.key];
                  const isConnected = status?.connected === true;
                  const meta = status?.metadata || {};

                  return (
                    <div 
                      key={service.key}
                      className="rs-input-group rs-flex rs-items-center rs-justify-between"
                      style={{
                        padding: 'var(--rs-space-3) var(--rs-space-4)',
                        background: 'var(--md-surface-container)',
                        borderRadius: 'var(--md-shape-sm)',
                        border: '1px solid var(--md-outline-variant)',
                      }}
                    >
                      <div className="rs-flex rs-items-center rs-gap-4">
                        <span className="material-symbols-rounded" style={{ fontSize: '24px', opacity: 0.8 }}>{service.icon}</span>
                        <div>
                          <div className="rs-type-small" style={{ fontWeight: 600, color: 'var(--text-base)' }}>
                            {service.name}
                          </div>
                          {isConnected && (
                            <div className="rs-mt-1 rs-flex rs-items-center rs-gap-1 rs-type-micro" style={{ color: 'var(--rs-status-nominal)' }}>
                              <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>check_circle</span>
                              Connected
                              {meta.email && ` as ${meta.email}`}
                              {meta.store_name && ` - ${meta.store_name}`}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {isConnected ? (
                        <button
                          className="rs-pill rs-justify-center rs-type-nano"
                          onClick={() => handleDisconnect(service.key)}
                          disabled={disconnecting === service.key}
                          style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', minWidth: '110px' }}
                        >
                          {disconnecting === service.key ? 'DISCONNECTING...' : 'DISCONNECT'}
                        </button>
                      ) : service.comingSoon ? (
                        <button
                          className="rs-pill rs-justify-center rs-muted rs-type-nano"
                          disabled
                          title="This integration is not available yet."
                          style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', minWidth: '110px' }}
                        >
                          COMING SOON
                        </button>
                      ) : (
                        <button
                          className="rs-btn-primary rs-justify-center rs-type-micro"
                          onClick={() => handleConnect(service.key)}
                          style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', minWidth: '110px', borderRadius: 'var(--md-shape-xs)' }}
                        >
                          CONNECT
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
