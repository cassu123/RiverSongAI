import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
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
    authorizeUrl: '/api/auth/amazon_sp_api/authorize'
  },
  { 
    key: 'shopify', 
    name: 'Shopify Store', 
    icon: 'shopping_bag',
    requiresInput: true,
    inputLabel: 'Store URL',
    inputPlaceholder: 'your-store.myshopify.com',
    authorizeUrl: (input) => `/api/shopify_auth/login?shop=${input}`
  },
  { 
    key: 'walmart', 
    name: 'Walmart Marketplace', 
    icon: 'store',
    authorizeUrl: '/api/auth/walmart/authorize'
  },
  { 
    key: 'tiktok', 
    name: 'TikTok Shop', 
    icon: 'video_library',
    authorizeUrl: '/api/auth/tiktok/authorize'
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
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="rs-card-meta">
              Protect your account with an authenticator app (Aegis, 1Password, Authy, Google Authenticator).
              You'll be asked for a 6-digit code on every login.
            </div>
          </div>
          <button className="rs-btn-primary" onClick={beginEnrol}>ENABLE 2FA</button>
        </div>
      )}

      {phase === 'idle' && enabled && (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="rs-card-meta">
              2FA is active. {status?.recovery_codes_left ?? 0} recovery {(status?.recovery_codes_left ?? 0) === 1 ? 'code' : 'codes'} remaining.
            </div>
          </div>
          <button className="rs-pill" onClick={() => setPhase('disabling')}>DISABLE 2FA</button>
        </div>
      )}

      {phase === 'confirming' && enrollment && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {enrollment.qr_png_b64 && (
            <img
              src={`data:image/png;base64,${enrollment.qr_png_b64}`}
              alt="2FA QR code"
              style={{ width: 180, height: 180, background: 'white', padding: 12, borderRadius: 8 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="rs-card-meta" style={{ marginBottom: 8 }}>
              Scan the code, or paste this secret manually:
            </div>
            <code
              style={{
                display: 'block', padding: '8px 12px',
                background: 'var(--md-surface-container)',
                borderRadius: 6, fontSize: '0.85rem',
                wordBreak: 'break-all', marginBottom: 16,
              }}
            >
              {enrollment.secret}
            </code>
            <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 6 }}>VERIFY WITH FIRST CODE</div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="rs-pill"
              style={{ width: '100%', padding: '12px 16px', background: 'var(--md-surface-container)', letterSpacing: '0.2em' }}
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button className="rs-btn-primary" onClick={confirmEnrol}>CONFIRM</button>
              <button className="rs-pill" onClick={cancelEnrol}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'showing-codes' && recoveryCodes && (
        <div>
          <div className="rs-card-meta" style={{ marginBottom: 12 }}>
            Save these recovery codes somewhere safe. Each works once and replaces the 6-digit code
            if you ever lose your authenticator. <strong>You will not see them again.</strong>
          </div>
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 8, marginBottom: 16,
              padding: 12, background: 'var(--md-surface-container)', borderRadius: 8,
            }}
          >
            {recoveryCodes.map((c, i) => (
              <code key={i} style={{ fontSize: '0.9rem', textAlign: 'center' }}>{c}</code>
            ))}
          </div>
          <button className="rs-btn-primary" onClick={dismissRecoveryCodes}>I'VE SAVED THEM</button>
        </div>
      )}

      {phase === 'disabling' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
          <div className="rs-card-meta">Confirm with your password and a current 6-digit code.</div>
          <input
            type="password"
            className="rs-pill"
            style={{ padding: '12px 16px', background: 'var(--md-surface-container)' }}
            placeholder="Password"
            value={disablePwd}
            onChange={e => setDisablePwd(e.target.value)}
          />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            className="rs-pill"
            style={{ padding: '12px 16px', background: 'var(--md-surface-container)', letterSpacing: '0.2em' }}
            placeholder="000000"
            value={disableCode}
            onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="rs-btn-primary" onClick={disable2fa}>DISABLE 2FA</button>
            <button className="rs-pill" onClick={() => { setPhase('idle'); setError('') }}>CANCEL</button>
          </div>
        </div>
      )}

      {error && (
        <div className="rs-card-meta" style={{ color: 'var(--md-error)', marginTop: 12 }}>{error}</div>
      )}
    </div>
  )
}


export default function ProfilePage({
  profile, onSave,
  universe, environment, mood,
  onUniverseChange, onEnvironmentChange, onMoodChange
}) {
  const { user, token } = useAuth()
  const [displayName, setDisplayName] = useState(profile.displayName || '')
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

  const handleConnect = (serviceKey) => {
    const serviceConfig = SERVICES.find(s => s.key === serviceKey);
    if (!serviceConfig) return;
    
    if (serviceConfig.requiresInput) {
      const userInput = prompt(`Enter your ${serviceConfig.inputLabel} (${serviceConfig.inputPlaceholder}):`);
      if (userInput) {
        window.location.href = serviceConfig.authorizeUrl(userInput);
      }
    } else {
      window.location.href = serviceConfig.authorizeUrl;
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
    <div className="rs-foyer animate-fade-in">
      
      {/* Header */}
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Identity & Context</h1>
        <div className="rs-greeting-sub">Define your presence and calibrate the visual stage.</div>
      </div>

      <div className="rs-card-flow">

        {/* Identity Card */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
             <span className="rs-card-label">PRIMARY IDENTITY</span>
             {saveStatus && <span className="rs-card-label" style={{ color: 'var(--primary)', opacity: 1 }}>{saveStatus}</span>}
          </div>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="rs-card-label" style={{ fontSize: '0.6rem', marginBottom: 8 }}>CALL-SIGN</div>
              <input 
                type="text" 
                className="rs-pill" 
                style={{ width: '100%', padding: '12px 16px', background: 'var(--md-surface-container)' }}
                value={displayName} 
                onChange={e => setDisplayName(e.target.value)} 
              />
            </div>
            <button className="rs-btn-primary" onClick={handleSaveProfile}>UPDATE</button>
          </div>
          <div className="rs-card-meta" style={{ marginTop: 20, display: 'flex', gap: 32 }}>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>IDENTIFIER</div>
              <div style={{ fontSize: '0.9rem', marginTop: 4 }}>{user?.email}</div>
            </div>
            <div>
              <div className="rs-card-label" style={{ fontSize: '0.6rem' }}>CLEARANCE</div>
              <div style={{ fontSize: '0.9rem', marginTop: 4, color: 'var(--primary)' }}>LEVEL 01 ADMIN</div>
            </div>
          </div>
        </div>

        {/* Universe Selector */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">COSMOS SELECTION</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {UNIVERSES.map(u => (
              <div 
                key={u.key} 
                className={`rs-card is-tappable ${universe === u.key ? 'is-elev' : ''}`}
                style={{ borderColor: universe === u.key ? 'var(--primary)' : undefined }}
                onClick={() => onUniverseChange(u.key)}
              >
                <div className="rs-card-value" style={{ fontSize: '1rem', letterSpacing: '0.1em' }}>{u.label}</div>
                <div className="rs-card-meta" style={{ fontSize: '0.75rem' }}>{u.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Environment & Mood */}
        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">ENVIRONMENT</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(ENVIRONMENTS[universe] || []).map(e => (
              <button 
                key={e.key} 
                className={`rs-pill ${environment === e.key ? 'is-active' : ''}`}
                onClick={() => onEnvironmentChange(e.key)}
                style={{ justifyContent: 'space-between' }}
              >
                <span>{e.label}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: e.primary }} />
              </button>
            ))}
          </div>
        </div>

        <div className="rs-card">
          <div className="rs-card-head">
            <span className="rs-card-label">ATMOSPHERIC MOOD</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(MOODS[environment] || []).map(m => (
              <button 
                key={m.key} 
                className={`rs-pill ${mood === m.key ? 'is-active' : ''}`}
                onClick={() => onMoodChange(m.key)}
                style={{ justifyContent: 'space-between' }}
              >
                <span>{m.label}</span>
                {mood === m.key && <span className="material-symbols-rounded" style={{ fontSize: '1rem' }}>check</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Neural Link / Push */}
        <div className="rs-card is-wide">
          <div className="rs-card-head">
            <span className="rs-card-label">NEURAL LINK (NOTIFICATIONS)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div className="rs-card-value">External Alerts</div>
              <div className="rs-card-meta">Enable push telemetry to receive system briefings and urgent alerts directly on your device.</div>
            </div>
            <button 
              className={`rs-btn-primary ${pushStatus === 'linked' ? 'is-active' : ''}`} 
              disabled={pushStatus === 'linked'}
              onClick={handlePushEnable}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p className="rs-card-meta">
                Connect your personal accounts to enable analytics and integrations. 
                Your credentials are securely stored and never shared.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {SERVICES.map(service => {
                  const isConnected = integrations?.[service.key];
                  
                  return (
                    <div 
                      key={service.key}
                      className="rs-input-group"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--md-surface-container)',
                        borderRadius: '8px',
                        border: '1px solid var(--md-outline-variant)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '24px', opacity: 0.8 }}>{service.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--text-base)', fontSize: '0.95rem' }}>
                            {service.name}
                          </div>
                          {isConnected && (
                            <div style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>check_circle</span>
                              Connected
                              {isConnected.email && ` as ${isConnected.email}`}
                              {isConnected.store_name && ` - ${isConnected.store_name}`}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {isConnected ? (
                        <button
                          className="rs-pill"
                          onClick={() => handleDisconnect(service.key)}
                          disabled={disconnecting === service.key}
                          style={{ padding: '6px 16px', fontSize: '0.7rem', minWidth: '110px', justifyContent: 'center' }}
                        >
                          {disconnecting === service.key ? 'DISCONNECTING...' : 'DISCONNECT'}
                        </button>
                      ) : (
                        <button
                          className="rs-btn-primary"
                          onClick={() => handleConnect(service.key)}
                          style={{ padding: '8px 16px', fontSize: '0.75rem', minWidth: '110px', justifyContent: 'center', borderRadius: '4px' }}
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
