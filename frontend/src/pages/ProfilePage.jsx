import React, { useState, useEffect, useCallback } from 'react'
import './ProfilePage.css'
import { useAuth } from '../context/AuthContext'
import { registerPushNotifications } from '../utils/pushNotifications'

// ── tiny helpers ─────────────────────────────────────────────────────────────

function Icon({ name, size = 18, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={{ fontSize: size, lineHeight: 1, ...style }}
    >
      {name}
    </span>
  )
}

// ── Three-axis presence catalog (kept in sync with App.jsx + auth.py) ──────
const UNIVERSES = [
  { key: 'dune',      label: 'DUNE',            primary: '#deb651', bg: '#1a1209',
    hint: 'Desert empire. Noble warfare and oppressive industry.' },
  { key: 'halo',      label: 'HALO',            primary: '#78c8e6', bg: '#050c14',
    hint: 'Forerunner mystics and UNSC steel under a shattered ring.' },
  { key: 'mv',        label: 'MONUMENT VALLEY', primary: '#b8a8d4', bg: '#1a1a2e',
    hint: 'Pastel sacred geometry. Impossible Escher architecture.' },
  { key: 'nightcity', label: 'NIGHT CITY',      primary: '#ff3c8c', bg: '#0e0e14',
    hint: 'Neon dystopia. Corporate chrome and Pacifica decay.' },
]

const ENVIRONMENTS = {
  dune:      [{ key: 'atreides',   label: 'ATREIDES',   primary: '#deb651', bg: '#1a1209' },
              { key: 'harkonnen',  label: 'HARKONNEN',  primary: '#c53a1f', bg: '#0a0606' }],
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
  forerunner: [{ key: 'hard-light',       label: 'HARD-LIGHT',       primary: '#00e5ff', bg: '#050c14' },
               { key: 'ceramic-veil',     label: 'CERAMIC VEIL',     primary: '#a8e0ff', bg: '#0a1820' }],
  unsc:       [{ key: 'combat-steel',     label: 'COMBAT STEEL',     primary: '#f08c32', bg: '#0c1116' },
               { key: 'night-vision',     label: 'NIGHT VISION',     primary: '#3dcc79', bg: '#050805' }],
  spires:     [{ key: 'sacred',           label: 'SACRED',           primary: '#a0a8c0', bg: '#1a1a2e' },
               { key: 'daybreak-temple',  label: 'DAYBREAK TEMPLE',  primary: '#7aa4cc', bg: '#1c2a3a' },
               { key: 'twilight-spires',  label: 'TWILIGHT SPIRES',  primary: '#b88abf', bg: '#1a1025' }],
  garden:     [{ key: 'pastel-day',       label: 'PASTEL DAY',       primary: '#d8a878', bg: '#1f1812' },
               { key: 'dusk-pavilion',    label: 'DUSK PAVILION',    primary: '#d66c59', bg: '#241510' }],
  corpo:      [{ key: 'chrome',           label: 'CHROME',           primary: '#c8c8d4', bg: '#0e0e14' },
               { key: 'executive',        label: 'EXECUTIVE',        primary: '#d4b478', bg: '#101010' }],
  pacifica:   [{ key: 'glitch-street',    label: 'GLITCH STREET',    primary: '#e8ff00', bg: '#0a0a05' },
               { key: 'smoke',            label: 'SMOKE',            primary: '#bcaa45', bg: '#0c0c08' }],
}

export default function ProfilePage({
  profile, onSave,
  universe, environment, mood,
  onUniverseChange, onEnvironmentChange, onMoodChange,
}) {
  const { token } = useAuth()
  const [form,    setForm]    = useState({ ...profile })
  const [pwForm,  setPwForm]  = useState({ current: '', next: '', confirm: '' })
  const [saved,   setSaved]   = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwOk,    setPwOk]    = useState(false)

  // Integrations state
  const [showLinked, setShowLinked] = useState(false)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [savingLinks, setSavingLinks] = useState(false)
  const [linksMsg, setLinksMsg] = useState('')
  const [pushMsg, setPushMsg] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [integrations, setIntegrations] = useState({
    amazon_sp_api: { lwa_app_id: '', lwa_client_secret: '', lwa_refresh_token: '', aws_access_key: '', aws_secret_key: '', seller_id: '' },
    walmart_api: { client_id: '', client_secret: '' }
  })

  const handlePushEnable = async () => {
    setPushBusy(true)
    setPushMsg('')
    const res = await registerPushNotifications()
    if (res.status === 'subscribed') {
      setPushMsg('Notifications enabled.')
    } else if (res.status === 'denied') {
      setPushMsg('Permission denied.')
    } else if (res.status === 'unsupported') {
      setPushMsg('Not supported by browser.')
    } else {
      setPushMsg(res.message || 'Failed to enable.')
    }
    setPushBusy(false)
    setTimeout(() => setPushMsg(''), 3000)
  }

  const loadIntegrations = useCallback(async () => {
    setLoadingLinks(true)
    try {
      const res = await fetch('/api/auth/integrations', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setIntegrations({
        amazon_sp_api: { ...integrations.amazon_sp_api, ...(data.amazon_sp_api || {}) },
        walmart_api:   { ...integrations.walmart_api,   ...(data.walmart_api || {}) }
      })
    } catch (e) {
      console.error('Failed to load integrations:', e)
    } finally {
      setLoadingLinks(false)
    }
  }, [token]) // eslint-disable-line

  useEffect(() => {
    if (showLinked) loadIntegrations()
  }, [showLinked, loadIntegrations])

  const handleLinkChange = (platform, field, value) => {
    setIntegrations(prev => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value }
    }))
  }

  const handleLinksSave = async () => {
    setSavingLinks(true)
    setLinksMsg('')
    try {
      const res = await fetch('/api/auth/integrations', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(integrations)
      })
      if (!res.ok) throw new Error('Failed to save integrations')
      setLinksMsg('Integrations updated successfully.')
      setTimeout(() => setLinksMsg(''), 3000)
    } catch (e) {
      setLinksMsg('Error saving integrations.')
    } finally {
      setSavingLinks(false)
    }
  }

  const initials = form.displayName
    ? form.displayName.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '??'

  const handleField = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
    setSaved(false)
  }

  const handleSave = () => {
    onSave({ ...form })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handlePwChange = (e) => {
    setPwForm(f => ({ ...f, [e.target.name]: e.target.value }))
    setPwError('')
    setPwOk(false)
  }

  const handlePwSave = async () => {
    if (!pwForm.current)          { setPwError('Enter your current password.'); return }
    if (pwForm.next.length < 8)   { setPwError('New password must be at least 8 characters.'); return }
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match.'); return }
    
    try {
      const response = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: pwForm.current,
          new_password: pwForm.next
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        setPwError(errorData.detail || 'Failed to update password.');
        return;
      }

      setPwOk(true)
      setPwForm({ current: '', next: '', confirm: '' })
      setTimeout(() => setPwOk(false), 2500)
    } catch (err) {
      setPwError('Network error. Could not change password.');
    }
  }

  return (
    <div className="profile-page page-wrap">
      <div className="page-breadcrumb">
        <span>◢</span><span>OPERATOR</span>
        <span className="page-breadcrumb-sep">/</span>
        <span>PROFILE &amp; SETTINGS</span>
      </div>
      <h1 className="page-title">Profile</h1>

      <div className="profile-grid">

        {/* LEFT: identity */}
        <div className="profile-col">

          {/* Avatar + name display */}
          <section className="card profile-card-identity">
            <div className="card-title">IDENTITY</div>
            <div className="profile-avatar-row">
              <div className="profile-avatar-lg">{initials}</div>
              <div className="profile-avatar-meta">
                <span className="profile-avatar-name">{form.displayName || 'Unknown Operator'}</span>
                <span className="profile-avatar-handle">{form.username ? `@${form.username}` : 'no callsign set'}</span>
              </div>
            </div>

            <div className="profile-fields">
              <label className="profile-label">
                DISPLAY NAME
                <input
                  className="profile-input"
                  name="displayName"
                  value={form.displayName}
                  onChange={handleField}
                  placeholder="Your name"
                  autoComplete="off"
                />
              </label>

              <label className="profile-label">
                CALLSIGN / USERNAME
                <input
                  className="profile-input"
                  name="username"
                  value={form.username}
                  onChange={handleField}
                  placeholder="e.g. charlie.w"
                  autoComplete="off"
                />
              </label>

              <label className="profile-label">
                DATE OF BIRTH — OPTIONAL
                <input
                  className="profile-input"
                  name="birthday"
                  type="date"
                  value={form.birthday}
                  onChange={handleField}
                  style={{ colorScheme: 'dark' }}
                />
                <p style={{
                  fontSize: '0.72rem', color: 'var(--md-on-surface-variant)',                      
                  margin: '4px 0 0', lineHeight: 1.4,                                              
                }}>
                  Used for personalized briefings and age-appropriate recommendations.             
                </p>
              </label>
            </div>

            <div className="profile-save-row">
              <button className="btn btn--primary" onClick={handleSave}>
                SAVE CHANGES
              </button>
              {saved && <span className="profile-saved-msg">Saved.</span>}
            </div>
          </section>

          {/* Password */}
          <section className="card">
            <div className="card-title">CHANGE CIPHER</div>
            <div className="profile-fields">
              <label className="profile-label">
                CURRENT PASSWORD
                <input
                  className="profile-input"
                  name="current"
                  type="password"
                  value={pwForm.current}
                  onChange={handlePwChange}
                  autoComplete="current-password"
                />
              </label>
              <label className="profile-label">
                NEW PASSWORD
                <input
                  className="profile-input"
                  name="next"
                  type="password"
                  value={pwForm.next}
                  onChange={handlePwChange}
                  autoComplete="new-password"
                />
              </label>
              <label className="profile-label">
                CONFIRM NEW PASSWORD
                <input
                  className="profile-input"
                  name="confirm"
                  type="password"
                  value={pwForm.confirm}
                  onChange={handlePwChange}
                  autoComplete="new-password"
                />
              </label>
            </div>

            {pwError && <div className="profile-pw-error">{pwError}</div>}

            <div className="profile-save-row">
              <button className="btn btn--primary" onClick={handlePwSave}>
                UPDATE CIPHER
              </button>
              {pwOk && <span className="profile-saved-msg">Password updated.</span>}
            </div>
          </section>
        </div>

        {/* RIGHT: presence (universe → environment → mood) */}
        <div className="profile-col">
          <section className="card">
            <div className="card-title">UNIVERSE</div>
            <p className="profile-hint">
              {UNIVERSES.find(u => u.key === universe)?.hint
                || 'Pick the fictional world River inhabits.'}
            </p>
            <div className="theme-grid">
              {UNIVERSES.map(u => (
                <button
                  key={u.key}
                  className={`theme-card ${universe === u.key ? 'theme-card--active' : ''}`}
                  onClick={() => onUniverseChange(u.key)}
                  style={{ '--tc-primary': u.primary, '--tc-bg': u.bg }}
                  aria-pressed={universe === u.key}
                >
                  <div className="theme-card-preview">
                    <div className="theme-card-ring" />
                    <div className="theme-card-bar" />
                  </div>
                  <span className="theme-card-label">{u.label}</span>
                  {universe === u.key && <span className="theme-card-active-dot" />}
                </button>
              ))}
            </div>

            <div className="card-title" style={{ marginTop: 32 }}>ENVIRONMENT</div>
            <p className="profile-hint">The room within {UNIVERSES.find(u => u.key === universe)?.label || 'this universe'}.</p>
            <div className="theme-grid">
              {(ENVIRONMENTS[universe] || []).map(e => (
                <button
                  key={e.key}
                  className={`theme-card ${environment === e.key ? 'theme-card--active' : ''}`}
                  onClick={() => onEnvironmentChange(e.key)}
                  style={{ '--tc-primary': e.primary, '--tc-bg': e.bg }}
                  aria-pressed={environment === e.key}
                >
                  <div className="theme-card-preview">
                    <div className="theme-card-ring" />
                    <div className="theme-card-bar" />
                  </div>
                  <span className="theme-card-label">{e.label}</span>
                  {environment === e.key && <span className="theme-card-active-dot" />}
                </button>
              ))}
            </div>

            <div className="card-title" style={{ marginTop: 32 }}>MOOD</div>
            <p className="profile-hint">Color finish within this room.</p>
            <div className="theme-grid">
              {(MOODS[environment] || []).map(m => (
                <button
                  key={m.key}
                  className={`theme-card ${mood === m.key ? 'theme-card--active' : ''}`}
                  onClick={() => onMoodChange(m.key)}
                  style={{ '--tc-primary': m.primary, '--tc-bg': m.bg }}
                  aria-pressed={mood === m.key}
                >
                  <div className="theme-card-preview">
                    <div className="theme-card-ring" />
                    <div className="theme-card-bar" />
                  </div>
                  <span className="theme-card-label">{m.label}</span>
                  {mood === m.key && <span className="theme-card-active-dot" />}
                </button>
              ))}
            </div>
          </section>

          {/* Notifications */}
          <section className="card">
            <div className="card-title">NOTIFICATIONS</div>
            <p className="profile-hint">Receive proactive briefings and alerts on this device.</p>
            <div className="profile-save-row" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" onClick={handlePushEnable} disabled={pushBusy}>
                {pushBusy ? 'ENABLING...' : 'ENABLE PUSH NOTIFICATIONS'}
              </button>
              {pushMsg && <span className="profile-saved-msg">{pushMsg}</span>}
            </div>
          </section>

          {/* Linked Accounts section */}
          <section className={`card profile-links-card ${showLinked ? 'profile-links-card--expanded' : ''}`}>
            <div className="profile-links-header" onClick={() => setShowLinked(!showLinked)}>
              <div className="card-title">LINKED ACCOUNTS</div>
              <Icon 
                name={showLinked ? 'expand_less' : 'expand_more'} 
                style={{ color: 'var(--text-dim)', transition: 'transform 0.2s' }} 
              />
            </div>
            
            <p className="profile-hint">Manage API keys for Amazon SP-API and Walmart Marketplace integration.</p>

            {showLinked && (
              <div className="profile-links-content">
                {loadingLinks ? (
                  <div className="profile-loading">RETRIEVING ENCRYPTED KEYS...</div>
                ) : (
                  <>
                    <div className="profile-links-subgrid">
                      {/* Amazon */}
                      <div className="profile-links-subgroup">
                        <div className="profile-subgroup-title">AMAZON SP-API</div>
                        <div className="profile-fields">
                          <label className="profile-label">
                            LWA APP ID
                            <input
                              className="profile-input"
                              value={integrations.amazon_sp_api.lwa_app_id}
                              onChange={e => handleLinkChange('amazon_sp_api', 'lwa_app_id', e.target.value)}
                              placeholder="amzn1.application-oa2-client..."
                            />
                          </label>
                          <label className="profile-label">
                            LWA CLIENT SECRET
                            <input
                              className="profile-input"
                              type="password"
                              value={integrations.amazon_sp_api.lwa_client_secret === '__SET__' ? '' : integrations.amazon_sp_api.lwa_client_secret}
                              onChange={e => handleLinkChange('amazon_sp_api', 'lwa_client_secret', e.target.value)}
                              placeholder={integrations.amazon_sp_api.lwa_client_secret === '__SET__' ? '••••••••' : 'Paste secret'}
                            />
                          </label>
                          <label className="profile-label">
                            LWA REFRESH TOKEN
                            <input
                              className="profile-input"
                              type="password"
                              value={integrations.amazon_sp_api.lwa_refresh_token === '__SET__' ? '' : integrations.amazon_sp_api.lwa_refresh_token}
                              onChange={e => handleLinkChange('amazon_sp_api', 'lwa_refresh_token', e.target.value)}
                              placeholder={integrations.amazon_sp_api.lwa_refresh_token === '__SET__' ? '••••••••' : 'Atzr|...'}
                            />
                          </label>
                          <label className="profile-label">
                            AWS ACCESS KEY
                            <input
                              className="profile-input"
                              value={integrations.amazon_sp_api.aws_access_key}
                              onChange={e => handleLinkChange('amazon_sp_api', 'aws_access_key', e.target.value)}
                              placeholder="AKIA..."
                            />
                          </label>
                          <label className="profile-label">
                            AWS SECRET KEY
                            <input
                              className="profile-input"
                              type="password"
                              value={integrations.amazon_sp_api.aws_secret_key === '__SET__' ? '' : integrations.amazon_sp_api.aws_secret_key}
                              onChange={e => handleLinkChange('amazon_sp_api', 'aws_secret_key', e.target.value)}
                              placeholder={integrations.amazon_sp_api.aws_secret_key === '__SET__' ? '••••••••' : 'Paste secret'}
                            />
                          </label>
                          <label className="profile-label">
                            SELLER ID
                            <input
                              className="profile-input"
                              value={integrations.amazon_sp_api.seller_id}
                              onChange={e => handleLinkChange('amazon_sp_api', 'seller_id', e.target.value)}
                              placeholder="A123456789..."
                            />
                          </label>
                        </div>
                      </div>

                      {/* Walmart */}
                      <div className="profile-links-subgroup">
                        <div className="profile-subgroup-title">WALMART MARKETPLACE</div>
                        <div className="profile-fields">
                          <label className="profile-label">
                            CLIENT ID
                            <input
                              className="profile-input"
                              value={integrations.walmart_api.client_id}
                              onChange={e => handleLinkChange('walmart_api', 'client_id', e.target.value)}
                            />
                          </label>
                          <label className="profile-label">
                            CLIENT SECRET
                            <input
                              className="profile-input"
                              type="password"
                              value={integrations.walmart_api.client_secret === '__SET__' ? '' : integrations.walmart_api.client_secret}
                              onChange={e => handleLinkChange('walmart_api', 'client_secret', e.target.value)}
                              placeholder={integrations.walmart_api.client_secret === '__SET__' ? '••••••••' : 'Paste secret'}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="profile-save-row">
                      <button className="btn btn--primary" onClick={handleLinksSave} disabled={savingLinks}>
                        {savingLinks ? 'SYNCING...' : 'SAVE INTEGRATIONS'}
                      </button>
                      {linksMsg && <span className="profile-saved-msg">{linksMsg}</span>}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
