import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

export default function ProactivePage() {
  const [log, setLog] = useState([])
  const [prefs, setPrefs] = useState({ quiet_start: null, quiet_end: null, min_push_severity: 'info', kinds_muted: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const refresh = async () => {
    try {
      const [logRes, prefsRes] = await Promise.all([
        apiFetch('/api/proactive/log'),
        apiFetch('/api/proactive/prefs')
      ])
      if (logRes.ok) {
        const data = await logRes.json()
        setLog(data.log)
      }
      if (prefsRes.ok) {
        const data = await prefsRes.json()
        setPrefs(data.prefs)
      }
    } catch (e) {
      console.error("Failed to load proactive data", e)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    refresh()
  }, [])
  
  const savePrefs = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/proactive/prefs', {
        method: 'PATCH',
        body: JSON.stringify(prefs)
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }
  
  const toggleMutedKind = (kind) => {
    setPrefs(p => {
      const kinds = [...p.kinds_muted]
      if (kinds.includes(kind)) {
        return { ...p, kinds_muted: kinds.filter(k => k !== kind) }
      } else {
        kinds.push(kind)
        return { ...p, kinds_muted: kinds }
      }
    })
  }

  return (
    <div className="rs-page">
      <header className="rs-page-header">
        <h1>Proactive Settings</h1>
        <p className="rs-subtitle">Manage how River Song interrupts you</p>
      </header>
      
      {loading ? <p>Loading...</p> : (
        <>
          <section className="rs-section">
            <h2 className="rs-section-title">Quiet Hours</h2>
            <div className="rs-card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Start (Hour 0-23)</label>
                <input type="number" className="rs-input" min="0" max="23" value={prefs.quiet_start ?? ''} onChange={e => setPrefs({...prefs, quiet_start: e.target.value === '' ? null : parseInt(e.target.value)})} placeholder="e.g. 22" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>End (Hour 0-23)</label>
                <input type="number" className="rs-input" min="0" max="23" value={prefs.quiet_end ?? ''} onChange={e => setPrefs({...prefs, quiet_end: e.target.value === '' ? null : parseInt(e.target.value)})} placeholder="e.g. 7" />
              </div>
            </div>
            
            <h2 className="rs-section-title" style={{ marginTop: 24 }}>Push Notifications</h2>
            <div className="rs-card">
              <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Minimum Severity for Push</label>
              <select className="rs-input" value={prefs.min_push_severity} onChange={e => setPrefs({...prefs, min_push_severity: e.target.value})}>
                <option value="info">Info (All)</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical Only</option>
              </select>
            </div>
            
            <h2 className="rs-section-title" style={{ marginTop: 24 }}>Muted Categories (Non-Critical)</h2>
            <div className="rs-card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {["weather_alert", "device_alert", "routine", "maint_due", "custom"].map(kind => (
                <button 
                  key={kind} 
                  className={prefs.kinds_muted.includes(kind) ? "rs-pill rs-pill-active" : "rs-pill"}
                  onClick={() => toggleMutedKind(kind)}
                  style={prefs.kinds_muted.includes(kind) ? { background: '#ff4444', color: '#fff', border: 'none' } : {}}
                >
                  {kind}
                </button>
              ))}
            </div>
            
            <button className="rs-btn-primary" onClick={savePrefs} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </section>
          
          <section className="rs-section" style={{ marginTop: 32 }}>
            <h2 className="rs-section-title">Delivery Log</h2>
            <div className="rs-card">
              {log.length === 0 ? <p className="rs-hint">No proactive events yet.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Kind</th>
                        <th>Severity</th>
                        <th>Title</th>
                        <th>Delivered?</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.map(item => (
                        <tr key={item.id} style={{ opacity: item.delivered ? 1 : 0.6 }}>
                          <td>{new Date(item.created_at).toLocaleString()}</td>
                          <td>{item.kind}</td>
                          <td>{item.severity}</td>
                          <td>{item.title}</td>
                          <td>{item.delivered ? 'Yes' : 'No'}</td>
                          <td>{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
