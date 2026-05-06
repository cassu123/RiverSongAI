import React, { useState } from 'react'
import './ProfilePage.css'
import { useAuth } from '../context/AuthContext'

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

export default function ProfilePage({ profile, onSave, theme, onThemeChange, onNavigate }) {
  const { token } = useAuth()
  const [form,    setForm]    = useState({ ...profile })
  const [pwForm,  setPwForm]  = useState({ current: '', next: '', confirm: '' })
  const [saved,   setSaved]   = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwOk,    setPwOk]    = useState(false)

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
                DATE OF BIRTH
                <input
                  className="profile-input"
                  name="birthday"
                  type="date"
                  value={form.birthday}
                  onChange={handleField}
                />
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

          {/* Linked Accounts shortcut */}
          <section className="card profile-links-card">
            <div className="card-title">LINKED ACCOUNTS</div>
            <p className="profile-hint">Connect TikTok, Amazon, Etsy, Instagram, and more to power your Analytics dashboard.</p>
            <button className="btn btn--outlined profile-links-btn" onClick={() => onNavigate?.('linked-accounts')}>
              Manage Linked Accounts →
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
