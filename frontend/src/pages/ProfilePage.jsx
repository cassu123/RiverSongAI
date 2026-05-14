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

const THEMES = [
  { key: 'halo',          label: 'Halo Blue',     primary: '#35a7ff', bg: '#080c13' },
  { key: 'crimson-dark',  label: 'Crimson Dark',  primary: '#c53a1f', bg: '#140c0b' },
  { key: 'combat',        label: 'Combat',        primary: '#3dcc79', bg: '#0a100a' },
  { key: 'midnight-violet', label: 'Midnight Violet', primary: '#9b6b9e', bg: '#1a1025' },
  { key: 'amber',     label: 'Peach Dream', primary: '#D66C59', bg: '#FEE7D9' },
  { key: 'arctic',    label: 'Arctic',    primary: '#4A7AA8', bg: '#dce6f0' },
  { key: 'cyberpunk', label: 'Cyberpunk', primary: '#e8ff00', bg: '#050505' },
  { key: 'dune',      label: 'Dune',      primary: '#deb651', bg: '#0a0804' },
]

export default function ProfilePage({ profile, onSave, theme, onThemeChange }) {
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

        {/* RIGHT: appearance */}
        <div className="profile-col">
          <section className="card">
            <div className="card-title">INTERFACE SKIN</div>
            <p className="profile-hint">Choose how River's interface looks. Your selection is saved to your profile.</p>

            <div className="theme-grid">
              {THEMES.map(t => (
                <button
                  key={t.key}
                  className={`theme-card ${theme === t.key ? 'theme-card--active' : ''}`}
                  onClick={() => onThemeChange(t.key)}
                  style={{ '--tc-primary': t.primary, '--tc-bg': t.bg }}
                  aria-pressed={theme === t.key}
                >
                  <div className="theme-card-preview">
                    <div className="theme-card-ring" />
                    <div className="theme-card-bar" />
                  </div>
                  <span className="theme-card-label">{t.label.toUpperCase()}</span>
                  {theme === t.key && <span className="theme-card-active-dot" />}
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
