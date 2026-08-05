import React, { useState, useEffect, useCallback } from 'react'

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
    <div className="rs-foyer animate-fade-in">
      <header className="rs-foyer-head">
        <div className="rs-card-label">ADMIN / SECTION 9</div>
        <h1 className="rs-greeting">Emergency Protocol</h1>
        <div className="rs-status-strip">
          <span className="rs-status-dot" style={{ background: active ? '#ff3322' : undefined }} />
          <span>GLOBAL KILL SWITCH — ADMIN CLEARANCE REQUIRED</span>
        </div>
      </header>

      <div className="rs-card-flow" style={{ maxWidth: 640 }}>

        {/* Status card */}
        <div className="rs-card is-wide" style={{ 
          backdropFilter: 'var(--glass-blur)',
          border: active ? '1px solid rgba(255, 51, 34, 0.5)' : undefined,
          background: active ? 'color-mix(in srgb, #ff3322 5%, var(--rs-card-bg))' : undefined
        }}>
          <div className="rs-card-head">
             <span className="rs-card-label">SYSTEM STATE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: '1.4rem', fontWeight: 600, letterSpacing: '0.1em' }}>
            {loading ? (
              <><span className="rs-status-dot" /> LOADING</>
            ) : active ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#ff3322' }}>
                <span style={{ 
                  display: 'inline-block', 
                  width: 12, 
                  height: 12, 
                  borderRadius: '50%', 
                  background: '#ff3322', 
                  boxShadow: '0 0 15px #ff3322' 
                }} />
                KILL ACTIVE
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: 'var(--secondary)' }}>
                <span className="rs-status-dot" style={{ background: 'var(--secondary)' }} />
                NOMINAL
              </div>
            )}
          </div>
          {active && (
            <p className="rs-card-meta" style={{ marginTop: 12, borderTop: '1px solid rgba(255, 51, 34, 0.15)', paddingTop: 12 }}>
              All conversation processing is blocked. Reset the kill switch and
              restart the server to resume normal operation.
            </p>
          )}
        </div>

        {/* Activate card — only shown when NOT active */}
        {!active && !loading && (
          <div className="rs-card is-wide" style={{ backdropFilter: 'var(--glass-blur)' }}>
            <div className="rs-card-head">
               <span className="rs-card-label">ACTIVATE KILL SWITCH</span>
            </div>
            <p className="rs-card-meta" style={{ marginBottom: 16 }}>
              Immediately blocks all AI conversation processing. The system will
              continue running but reject every request until manually reset.
            </p>
            {confirm ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 100%', marginBottom: 8, color: 'var(--warn)', fontSize: '0.85rem', fontWeight: 600 }}>Are you sure? This cannot be undone remotely.</span>
                <button
                  className="rs-btn-primary"
                  style={{ background: '#ff3322', color: 'white' }}
                  onClick={handleActivate}
                  disabled={activating}
                >
                  {activating ? 'ACTIVATING…' : '● CONFIRM ACTIVATE'}
                </button>
                <button className="rs-pill" onClick={() => setConfirm(false)}>CANCEL</button>
              </div>
            ) : (
              <button className="rs-pill" style={{ color: '#ff3322', borderColor: '#ff3322' }} onClick={handleActivate}>
                ◼ ACTIVATE KILL SWITCH
              </button>
            )}
          </div>
        )}

        {/* Reset card — only shown when ACTIVE */}
        {active && !loading && (
          <div className="rs-card is-wide" style={{ backdropFilter: 'var(--glass-blur)' }}>
            <div className="rs-card-head">
               <span className="rs-card-label">RESET KILL SWITCH</span>
            </div>
            <p className="rs-card-meta" style={{ marginBottom: 16 }}>
              Enter the admin password to reset the kill switch. After a successful
              reset you must restart the server to resume normal operation.
            </p>
            <form style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }} onSubmit={handleReset}>
              <input
                style={{ 
                  flex: '1 1 200px', 
                  background: 'var(--md-surface-container)', 
                  border: '1px solid rgba(255, 51, 34, 0.3)', 
                  borderRadius: 'var(--md-shape-xl)',
                  color: 'white',
                  padding: '12px 16px',
                  outline: 'none'
                }}
                type="password"
                placeholder="Admin password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                className="rs-btn-primary"
                type="submit"
                style={{ flex: '1 1 100px', padding: '12px' }}
                disabled={resetting || !password}
              >
                {resetting ? 'VERIFYING…' : '↺ RESET'}
              </button>
            </form>

            {resetMsg && (
              <div style={{ 
                marginTop: 12, 
                padding: '8px 16px', 
                borderRadius: 'var(--md-shape-xl)', 
                border: '1px solid',
                borderColor: resetMsg.includes('denied') || resetMsg.includes('failed') ? 'rgba(255,51,34,0.3)' : 'rgba(0,255,204,0.3)',
                color: resetMsg.includes('denied') || resetMsg.includes('failed') ? '#ff6655' : 'var(--secondary)',
                fontSize: '0.85rem'
              }}>
                {resetMsg}
              </div>
            )}
          </div>
        )}

        {/* Info card */}
        <div className="rs-card is-wide" style={{ backdropFilter: 'var(--glass-blur-sm)' }}>
          <div className="rs-card-head">
             <span className="rs-card-label">HOW IT WORKS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              "Activation immediately writes state to disk — persists across restarts.",
              "All WebSocket conversation turns are rejected while the switch is active.",
              "Reset requires the bcrypt password hash set in KILL_SWITCH_PASSWORD_HASH in your .env file.",
              "After reset, restart the server process to resume conversation handling."
            ].map((text, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, fontSize: '0.85rem' }}>
                <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>0{i+1}</span>
                <span className="rs-card-meta" style={{ color: 'inherit', opacity: 0.8 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
