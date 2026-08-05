import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import Sheet from '../chrome/Sheet'

export default function ReadingIntegrationsModal({ open, onClose, onRefresh }) {
  const { token } = useAuth()
  const [connections, setConnections] = useState({})
  const [loading, setLoading] = useState(false)

  // Libby
  const [libbyCode, setLibbyCode] = useState('')
  const [libbyStart, setLibbyStart] = useState(null)

  // CSV
  const [csvFile, setCsvFile] = useState(null)

  const apiFetch = async (path, opts = {}) => {
    const res = await fetch(`/api/reading${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || res.statusText)
    }
    return res.status === 204 ? null : res.json()
  }

  const loadConnections = async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/connections')
      setConnections(data || {})
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadConnections()
  }, [open, token])

  const handleLibbyConnect = async () => {
    if (!libbyStart) {
      const res = await apiFetch('/connect/libby/start', { method: 'POST' })
      setLibbyStart(res)
    } else {
      await apiFetch('/connect/libby/complete', { method: 'POST', body: JSON.stringify({ code: libbyCode }) })
      setLibbyStart(null)
      loadConnections()
      if (onRefresh) onRefresh()
    }
  }

  const handleLibbyDisconnect = async () => {
    await apiFetch('/connect/libby', { method: 'DELETE' })
    loadConnections()
  }

  const handleGooglePlay = async () => {
    const res = await apiFetch('/connect/google_play/authorize')
    localStorage.removeItem('rs-books-oauth-code')
    localStorage.removeItem('rs-books-oauth-error')
    const w = window.open(res.auth_url, 'GoogleAuth', 'width=500,height=600')
    const timer = setInterval(async () => {
      const code = localStorage.getItem('rs-books-oauth-code')
      const oauthError = localStorage.getItem('rs-books-oauth-error')
      if (code) {
        clearInterval(timer)
        if (w) w.close()
        localStorage.removeItem('rs-books-oauth-code')
        await apiFetch('/connect/google_play/callback', { method: 'POST', body: JSON.stringify({ code }) })
        loadConnections()
        if (onRefresh) onRefresh()
      } else if (oauthError) {
        clearInterval(timer)
        if (w) w.close()
        localStorage.removeItem('rs-books-oauth-error')
        console.error('[ReadingIntegrations] Google Play OAuth failed:', oauthError)
      }
      if (w && w.closed) clearInterval(timer)
    }, 1000)
  }

  const handleGoogleDisconnect = async () => {
    await apiFetch('/connect/google_play', { method: 'DELETE' })
    loadConnections()
  }

  const handleCsvImport = async () => {
    if (!csvFile) return
    const fd = new FormData()
    fd.append('file', csvFile)
    const res = await fetch(`/api/reading/import/csv`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    })
    if (res.ok) {
      alert('CSV Imported!')
      setCsvFile(null)
      if (onRefresh) onRefresh()
    } else {
      alert('Import failed')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Data Sources">
      <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* Libby */}
        <div className="rs-card">
          <div className="rs-card-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span className="material-symbols-rounded" style={{color: '#00aaff', fontSize: '2rem'}}>local_library</span>
              <div>
                <div style={{fontWeight: 700}}>Libby / OverDrive</div>
                <div className="rs-card-meta">Live loans and holds telemetry</div>
              </div>
            </div>
            {connections.libby ? (
               <div>
                 <div className="rs-status-strip" style={{marginBottom: 12}}>
                    <span className="rs-status-dot" style={{ background: '#4ade80' }} />
                    <span>CONNECTED</span>
                 </div>
                 <button className="rs-pill btn-danger" onClick={handleLibbyDisconnect}>DISCONNECT</button>
               </div>
            ) : (
               <div>
                 {libbyStart ? (
                   <div style={{display: 'flex', gap: 8, marginTop: 12}}>
                     <input className="rs-input" style={{flex: 1}} placeholder="8-Digit Code" value={libbyCode} onChange={e => setLibbyCode(e.target.value)} />
                     <button className="rs-pill is-active" onClick={handleLibbyConnect}>PAIR</button>
                   </div>
                 ) : (
                   <button className="rs-pill" onClick={handleLibbyConnect}>CONNECT LIBBY</button>
                 )}
               </div>
            )}
          </div>
        </div>

        {/* Google Play */}
        <div className="rs-card">
          <div className="rs-card-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span className="material-symbols-rounded" style={{color: '#4285f4', fontSize: '2rem'}}>play_arrow</span>
              <div>
                <div style={{fontWeight: 700}}>Google Play Books</div>
                <div className="rs-card-meta">Sync annotations and reading states</div>
              </div>
            </div>
            {connections.google_play ? (
               <div>
                 <div className="rs-status-strip" style={{marginBottom: 12}}>
                    <span className="rs-status-dot" style={{ background: '#4ade80' }} />
                    <span>CONNECTED</span>
                 </div>
                 <div style={{display: 'flex', gap: 8}}>
                   <button className="rs-pill btn-danger" onClick={handleGoogleDisconnect}>DISCONNECT</button>
                   <button className="rs-pill is-active" onClick={async () => {
                     await apiFetch('/sync/google_play', {method: 'POST'})
                     if (onRefresh) onRefresh()
                   }}>SYNC NOW</button>
                 </div>
               </div>
            ) : (
               <button className="rs-pill" onClick={handleGooglePlay}>OAUTH CONNECT</button>
            )}
          </div>
        </div>

        {/* CSV Import */}
        <div className="rs-card">
          <div className="rs-card-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span className="material-symbols-rounded" style={{color: 'var(--text-dim)', fontSize: '2rem'}}>upload_file</span>
              <div>
                <div style={{fontWeight: 700}}>Legacy Archive Import</div>
                <div className="rs-card-meta">Goodreads, Kobo, or Play Books CSV</div>
              </div>
            </div>
            <div style={{display: 'flex', gap: 8}}>
              <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files[0])} style={{fontSize: '0.8rem', flex: 1}} />
              <button className="rs-pill is-active" disabled={!csvFile} onClick={handleCsvImport}>IMPORT</button>
            </div>
          </div>
        </div>

      </div>
    </Sheet>
  )
}
