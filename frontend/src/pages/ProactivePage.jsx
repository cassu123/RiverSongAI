import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'
import { Section } from './settings/shared.jsx'

/**
 * ProactivePage — controls for how River Song proactively reaches out
 * (quiet hours, push severity, muted categories) plus a delivery log.
 *
 * Lives inside Settings (`embedded`); the standalone `/proactive` route is
 * kept reachable by direct URL but is no longer in the drawer nav.
 */
export default function ProactivePage({ embedded = false }) {
  const [log, setLog] = useState([])
  const [prefs, setPrefs] = useState({ quiet_start: null, quiet_end: null, min_push_severity: 'info', kinds_muted: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const refresh = async () => {
    try {
      const [logData, prefsData] = await Promise.all([
        apiFetch('/api/proactive/log'),
        apiFetch('/api/proactive/prefs')
      ])
      setLog(logData?.log ?? [])
      if (prefsData?.prefs) {
        setPrefs({ quiet_start: null, quiet_end: null, min_push_severity: 'info', kinds_muted: [], ...prefsData.prefs })
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
        body: prefs
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }
  
  const toggleMutedKind = (kind) => {
    setPrefs(p => {
      const kinds = [...(p.kinds_muted || [])]
      if (kinds.includes(kind)) {
        return { ...p, kinds_muted: kinds.filter(k => k !== kind) }
      } else {
        kinds.push(kind)
        return { ...p, kinds_muted: kinds }
      }
    })
  }

  // Shared field JSX so the standalone page and the embedded Settings view
  // render identical controls.
  const quietHoursFields = (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Start (Hour 0-23)</label>
        <input type="number" className="rs-input" min="0" max="23" value={prefs.quiet_start ?? ''} onChange={e => setPrefs({...prefs, quiet_start: e.target.value === '' ? null : parseInt(e.target.value)})} placeholder="e.g. 22" />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>End (Hour 0-23)</label>
        <input type="number" className="rs-input" min="0" max="23" value={prefs.quiet_end ?? ''} onChange={e => setPrefs({...prefs, quiet_end: e.target.value === '' ? null : parseInt(e.target.value)})} placeholder="e.g. 7" />
      </div>
    </div>
  )

  const pushSeverityField = (
    <div>
      <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Minimum Severity for Push</label>
      <select className="rs-input" value={prefs.min_push_severity} onChange={e => setPrefs({...prefs, min_push_severity: e.target.value})}>
        <option value="info">Info (All)</option>
        <option value="warning">Warning</option>
        <option value="critical">Critical Only</option>
      </select>
    </div>
  )

  const mutedCategoriesField = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {["weather_alert", "device_alert", "routine", "maint_due", "custom"].map(kind => (
        <button
          key={kind}
          className={(prefs.kinds_muted || []).includes(kind) ? "rs-pill rs-pill-active" : "rs-pill"}
          onClick={() => toggleMutedKind(kind)}
          style={(prefs.kinds_muted || []).includes(kind) ? { background: '#ff4444', color: '#fff', border: 'none' } : {}}
        >
          {kind}
        </button>
      ))}
    </div>
  )

  const saveButton = (
    <button className="rs-btn-primary" onClick={savePrefs} disabled={saving} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
      {saving ? 'Saving...' : 'Save Preferences'}
    </button>
  )

  const logTable = log.length === 0
    ? <p className="rs-hint">No proactive events yet.</p>
    : (
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
    )

  // Embedded in the Settings page: use the shared Section cards, no page chrome.
  if (embedded) {
    if (loading) return <Section title="PROACTIVE NOTIFICATIONS"><p className="rs-hint">Loading…</p></Section>
    return (
      <>
        <Section title="PROACTIVE — QUIET HOURS & PUSH">
          <div>
            <div className="rs-card-label" style={{ marginBottom: 8 }}>QUIET HOURS</div>
            {quietHoursFields}
          </div>
          {pushSeverityField}
          <div>
            <div className="rs-card-label" style={{ marginBottom: 8 }}>MUTED CATEGORIES (NON-CRITICAL)</div>
            {mutedCategoriesField}
          </div>
          {saveButton}
        </Section>
        <Section title="PROACTIVE — DELIVERY LOG">
          {logTable}
        </Section>
      </>
    )
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
            <div className="rs-card">{quietHoursFields}</div>

            <h2 className="rs-section-title" style={{ marginTop: 24 }}>Push Notifications</h2>
            <div className="rs-card">{pushSeverityField}</div>

            <h2 className="rs-section-title" style={{ marginTop: 24 }}>Muted Categories (Non-Critical)</h2>
            <div className="rs-card">{mutedCategoriesField}</div>

            {saveButton}
          </section>

          <section className="rs-section" style={{ marginTop: 32 }}>
            <h2 className="rs-section-title">Delivery Log</h2>
            <div className="rs-card">{logTable}</div>
          </section>
        </>
      )}
    </div>
  )
}
