import React, { useState, useEffect, useCallback } from 'react'
import './KillSwitchPage.css'

export default function KillSwitchPage() {
  const [active,    setActive]    = useState(null)   // null = loading
  const [loading,   setLoading]   = useState(true)
  const [confirm,   setConfirm]   = useState(false)  // first-click confirm gate
  const [password,  setPassword]  = useState('')
  const [resetMsg,  setResetMsg]  = useState('')     // feedback after reset attempt
  const [resetting, setResetting] = useState(false)
  const [activating,setActivating]= useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/killswitch')
      const data = await res.json()
      setActive(data.active)
    } catch {
      setActive(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const handleActivate = async () => {
    if (!confirm) { setConfirm(true); return }
    setActivating(true)
    try {
      const res  = await fetch('/api/killswitch/activate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ origin: 'Admin UI' }),
      })
      const data = await res.json()
      setActive(data.active)
    } finally {
      setActivating(false)
      setConfirm(false)
    }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    if (!password) return
    setResetting(true)
    setResetMsg('')
    try {
      const res  = await fetch('/api/killswitch/reset', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })
      const data = await res.json()
      if (data.success) {
        setActive(false)
        setResetMsg(data.message)
        setPassword('')
      } else {
        setResetMsg('Incorrect password — access denied.')
      }
    } catch {
      setResetMsg('Request failed. Check server status.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="page-wrap ks-wrap">
      {/* Header */}
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>ADMIN</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>SECTION 9</span>
          </div>
          <h1 className="page-title ks-page-title">Emergency Protocol</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" style={{ background: active ? 'var(--ks-red)' : undefined }} />
            Global kill switch — admin clearance required.
          </div>
        </div>
      </div>

      <div className="ks-layout">

        {/* Status card */}
        <div className={`card ks-status-card ${active ? 'ks-status-card--active' : ''}`}>
          <div className="ks-status-label">SYSTEM STATE</div>
          <div className={`ks-status-value ${active ? 'ks-status-value--active' : 'ks-status-value--nominal'}`}>
            {loading ? (
              <><span className="dot dot--standby" /> LOADING</>
            ) : active ? (
              <><span className="ks-pulse" />KILL ACTIVE</>
            ) : (
              <><span className="dot dot--on" />NOMINAL</>
            )}
          </div>
          {active && (
            <p className="ks-status-note">
              All conversation processing is blocked. Reset the kill switch and
              restart the server to resume normal operation.
            </p>
          )}
        </div>

        {/* Activate card — only shown when NOT active */}
        {!active && !loading && (
          <div className="card ks-action-card">
            <div className="card-title">ACTIVATE KILL SWITCH</div>
            <p className="ks-action-desc">
              Immediately blocks all AI conversation processing. The system will
              continue running but reject every request until manually reset.
            </p>
            {confirm ? (
              <div className="ks-confirm-row">
                <span className="ks-confirm-text">Are you sure? This cannot be undone remotely.</span>
                <button
                  className="btn ks-confirm-yes"
                  onClick={handleActivate}
                  disabled={activating}
                >
                  {activating ? 'ACTIVATING…' : '● CONFIRM ACTIVATE'}
                </button>
                <button className="btn" onClick={() => setConfirm(false)}>CANCEL</button>
              </div>
            ) : (
              <button className="btn ks-activate-btn" onClick={handleActivate}>
                ◼ ACTIVATE KILL SWITCH
              </button>
            )}
          </div>
        )}

        {/* Reset card — only shown when ACTIVE */}
        {active && !loading && (
          <div className="card ks-action-card">
            <div className="card-title">RESET KILL SWITCH</div>
            <p className="ks-action-desc">
              Enter the admin password to reset the kill switch. After a successful
              reset you must restart the server to resume normal operation.
            </p>
            <form className="ks-reset-form" onSubmit={handleReset}>
              <input
                className="ks-password-input"
                type="password"
                placeholder="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                className="btn ks-reset-btn"
                type="submit"
                disabled={resetting || !password}
              >
                {resetting ? 'VERIFYING…' : '↺ RESET'}
              </button>
            </form>
            {resetMsg && (
              <div className={`ks-reset-msg ${resetMsg.includes('denied') || resetMsg.includes('failed') ? 'ks-reset-msg--err' : 'ks-reset-msg--ok'}`}>
                {resetMsg}
              </div>
            )}
          </div>
        )}

        {/* Info card */}
        <div className="card ks-info-card">
          <div className="card-title">HOW IT WORKS</div>
          <div className="ks-info-list">
            <div className="ks-info-row">
              <span className="ks-info-num">01</span>
              <span>Activation immediately writes state to disk — persists across restarts.</span>
            </div>
            <div className="ks-info-row">
              <span className="ks-info-num">02</span>
              <span>All WebSocket conversation turns are rejected while the switch is active.</span>
            </div>
            <div className="ks-info-row">
              <span className="ks-info-num">03</span>
              <span>Reset requires the bcrypt password hash set in <code>KILL_SWITCH_PASSWORD_HASH</code> in your .env file.</span>
            </div>
            <div className="ks-info-row">
              <span className="ks-info-num">04</span>
              <span>After reset, restart the server process to resume conversation handling.</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
