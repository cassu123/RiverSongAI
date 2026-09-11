import React, { useState, useEffect } from 'react'
import { useAuth } from '@context/AuthContext'
import { useBreakpoint } from '@hooks/useBreakpoint'

/**
 * MemoryPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Browse the long-term semantic memory of River Song.
 */

export default function MemoryPage({ setAction }) {
  const { token } = useAuth()
  const { isPhone } = useBreakpoint()
  // Add-fact / add-pref forms are a single row on desktop; stack them into a
  // column on phones so the inputs don't collapse to unusable circles.
  const addFormStyle = {
    background: 'var(--md-surface-container-high)', marginBottom: 24,
    display: 'flex', gap: 12,
    flexDirection: isPhone ? 'column' : 'row',
    alignItems: isPhone ? 'stretch' : 'center',
  }
  const addInput = (grow) => ({
    flex: isPhone ? '0 0 auto' : grow, padding: 8, fontSize: 'var(--rs-fs-tiny)',
    minWidth: 0, boxSizing: 'border-box',
  })
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [activeTab, setActiveTab] = useState('ALL')
  
  // Forms
  const [newFact, setNewFact] = useState({ key: '', value: '' })
  const [newPref, setNewPref] = useState({ category: '', value: '', confidence: 'low' })

  // Editing state
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})

  const fetchMemories = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/memory/facts', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
      fetch('/api/memory/preferences', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
      fetch('/api/memory/summaries', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
      fetch('/api/memory/pending-habits', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : [])
    ]).then(([facts, prefs, summaries, pending]) => {
      const combined = [
        ...facts.map(f => ({ ...f, _type: 'FACT', text: `${f.key}: ${f.value}` })),
        ...prefs.map(p => ({ ...p, _type: 'PREFERENCE', text: `${p.category}: ${p.value}` })),
        ...summaries.map(s => ({ ...s, _type: 'SUMMARY', text: s.summary })),
        ...pending.map(h => ({ ...h, _type: 'SUGGESTION', text: h.pattern }))
      ]
      combined.sort((a, b) => new Date(b.created_at || b.last_updated || 0) - new Date(a.created_at || a.last_updated || 0))
      setMemories(combined)
      setLoading(false)
    })
  }

  useEffect(() => {
    fetchMemories()
  }, [token])

  const handleDelete = async (id, type) => {
    if (!window.confirm("Are you sure you want to delete this memory?")) return;
    
    let endpoint = ''
    if (type === 'FACT') endpoint = `/api/memory/facts/${id}`
    if (type === 'PREFERENCE') endpoint = `/api/memory/preferences/${id}`
    if (type === 'SUMMARY') endpoint = `/api/memory/summaries/${id}`
    if (type === 'SUGGESTION') endpoint = `/api/memory/pending-habits/${id}`
    
    await fetch(endpoint, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchMemories()
  }

  const handleApproveSuggestion = async (id) => {
    await fetch(`/api/memory/pending-habits/${id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    fetchMemories()
  }

  const handleCreateFact = async (e) => {
    e.preventDefault()
    if (!newFact.key || !newFact.value) return
    await fetch('/api/memory/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newFact)
    })
    setNewFact({ key: '', value: '' })
    fetchMemories()
  }

  const handleCreatePref = async (e) => {
    e.preventDefault()
    if (!newPref.category || !newPref.value) return
    await fetch('/api/memory/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(newPref)
    })
    setNewPref({ category: '', value: '', confidence: 'low' })
    fetchMemories()
  }

  const handleUpdate = async (id, type) => {
    let endpoint = ''
    if (type === 'FACT') endpoint = `/api/memory/facts/${id}`
    if (type === 'PREFERENCE') endpoint = `/api/memory/preferences/${id}`
    if (type === 'SUMMARY') {
      endpoint = `/api/memory/summaries/${id}/ttl`
      await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ttl_setting: editForm.ttl_setting })
      })
    } else {
      await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(editForm)
      })
    }
    setEditingId(null)
    setEditForm({})
    fetchMemories()
  }

  const filtered = memories.filter(m => 
    (activeTab === 'ALL' || m._type === activeTab) &&
    ((m.text || '').toLowerCase().includes(filter.toLowerCase()) || 
    (m._type || '').toLowerCase().includes(filter.toLowerCase()))
  )

  useEffect(() => {
    setAction(
      <div className="rs-flex rs-gap-3 rs-items-center">
        <div className="rs-card rs-grow" style={{ padding: 'var(--rs-space-2) var(--rs-space-4)', background: 'var(--md-surface-container-low)' }}>
          <input 
            type="text" 
            className="rs-w-full rs-type-small" style={{ all: 'unset' }} 
            placeholder="FILTER ARCHIVES..." 
            value={filter} 
            onChange={e => setFilter(e.target.value)} 
          />
        </div>
        <button className="rs-pill" onClick={() => setFilter('')}>CLEAR</button>
      </div>
    )
  }, [filter, setAction])

  const startEdit = (m) => {
    setEditingId(m.id)
    if (m._type === 'FACT') setEditForm({ key: m.key, value: m.value })
    if (m._type === 'PREFERENCE') setEditForm({ category: m.category, value: m.value })
    if (m._type === 'SUMMARY') setEditForm({ ttl_setting: m.ttl_setting })
  }

  const renderProvenance = (m) => {
    const kind = m.source_kind || 'conversation'
    const ref = m.source_ref ? ` (${m.source_ref})` : ''
    const date = new Date(m.created_at || m.last_updated).toLocaleDateString()
    return <span className="rs-muted rs-type-nano">Learned from {kind}{ref}, {date}</span>
  }

  return (
    <div className="rs-foyer animate-fade-in" style={{ paddingBottom: 60 }}>
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Memory Hub</h1>
        <div className="rs-greeting-sub">Inspect, edit, and control everything River Song knows about you.</div>
        
        <div className="rs-flex rs-flex-wrap" style={{ gap: 'var(--rs-space-2)', marginTop: 'var(--rs-space-4)' }}>
          {['ALL', 'FACT', 'PREFERENCE', 'SUMMARY', 'SUGGESTION'].map(t => (
            <button 
              key={t}
              className="rs-pill" 
              style={{ background: activeTab === t ? 'var(--primary)' : 'var(--md-surface-container)', color: activeTab === t ? 'var(--bg)' : 'inherit' }}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {(activeTab === 'ALL' || activeTab === 'FACT') && (
        <form onSubmit={handleCreateFact} className="rs-card is-wide animate-page-in" style={addFormStyle}>
          <span className="rs-card-label rs-no-shrink rs-c-accent" style={{ alignSelf: isPhone ? 'flex-start' : 'center' }}>ADD FACT</span>
          <input className="rs-card" placeholder="Key (e.g. name)" value={newFact.key} onChange={e => setNewFact({...newFact, key: e.target.value})} style={addInput(1)} />
          <input className="rs-card" placeholder="Value (e.g. Alice)" value={newFact.value} onChange={e => setNewFact({...newFact, value: e.target.value})} style={addInput(2)} />
          <button type="submit" className="rs-pill rs-no-shrink rs-nowrap" style={{ background: 'var(--primary)', color: 'var(--bg)' }}>ADD</button>
        </form>
      )}

      {(activeTab === 'ALL' || activeTab === 'PREFERENCE') && (
        <form onSubmit={handleCreatePref} className="rs-card is-wide animate-page-in" style={addFormStyle}>
          <span className="rs-card-label rs-no-shrink rs-c-warning" style={{ alignSelf: isPhone ? 'flex-start' : 'center' }}>ADD PREF</span>
          <input className="rs-card" placeholder="Category" value={newPref.category} onChange={e => setNewPref({...newPref, category: e.target.value})} style={addInput(1)} />
          <input className="rs-card" placeholder="Value" value={newPref.value} onChange={e => setNewPref({...newPref, value: e.target.value})} style={addInput(2)} />
          <select className="rs-card" value={newPref.confidence} onChange={e => setNewPref({...newPref, confidence: e.target.value})} style={{ ...addInput('0 0 auto'), padding: 'var(--rs-space-2)' }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="submit" className="rs-pill rs-no-shrink rs-nowrap" style={{ background: 'var(--rs-status-warning)', color: 'var(--bg)' }}>ADD</button>
        </form>
      )}

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">SCANNING NEURAL PATHWAYS...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card-meta">No matching memories found.</div>
        ) : (
          filtered.map((m, i) => (
            <div key={m.id || i} className="rs-card is-wide animate-page-in">
              <div className="rs-card-head rs-mb-3" style={{ borderBottom: '1px solid var(--rs-hairline-soft)', paddingBottom: 'var(--rs-space-2)' }}>
                <span className="rs-card-label" style={{ 
                  color: m._type === 'FACT' ? 'var(--primary)' 
                       : m._type === 'PREFERENCE' ? 'var(--rs-status-warning)' 
                       : m._type === 'SUGGESTION' ? 'var(--rs-status-info)'
                       : 'var(--text-dim)' 
                }}>
                  {m._type}
                </span>
                
                {m._type === 'FACT' && (
                  <span className="rs-pill rs-type-nano" style={{ padding: '2px 6px', background: m.source === 'explicit' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)' }}>
                    {m.source.toUpperCase()}
                  </span>
                )}
                {m._type === 'PREFERENCE' && (
                  <span className="rs-pill rs-type-nano" style={{ padding: '2px 6px', opacity: 0.8 }}>
                    CONFIDENCE: {m.confidence.toUpperCase()}
                  </span>
                )}
                
                <div className="rs-flex rs-gap-2" style={{ marginLeft: 'auto' }}>
                  {m._type === 'SUGGESTION' && (
                    <button className="rs-pill rs-type-nano" onClick={() => handleApproveSuggestion(m.id)} style={{ padding: 'var(--rs-space-1) var(--rs-space-2)', background: 'var(--rs-status-success)' }}>
                      APPROVE
                    </button>
                  )}
                  {editingId !== m.id && m._type !== 'SUGGESTION' && (
                    <button className="rs-pill rs-type-nano" onClick={() => startEdit(m)} style={{ padding: 'var(--rs-space-1) var(--rs-space-2)' }}>EDIT</button>
                  )}
                  <button className="rs-pill rs-type-nano" onClick={() => handleDelete(m.id, m._type)} style={{ padding: 'var(--rs-space-1) var(--rs-space-2)', color: 'var(--rs-status-error)' }}>
                    {m._type === 'SUGGESTION' ? 'DISMISS' : 'DELETE'}
                  </button>
                </div>
              </div>
              
              {editingId === m.id ? (
                <div className="rs-flex rs-flex-col rs-gap-2">
                  {m._type === 'FACT' && (
                    <>
                      <input className="rs-card rs-p-2" value={editForm.key} onChange={e => setEditForm({...editForm, key: e.target.value})} />
                      <input className="rs-card rs-p-2" value={editForm.value} onChange={e => setEditForm({...editForm, value: e.target.value})} />
                    </>
                  )}
                  {m._type === 'PREFERENCE' && (
                    <>
                      <input className="rs-card rs-p-2" value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} />
                      <input className="rs-card rs-p-2" value={editForm.value} onChange={e => setEditForm({...editForm, value: e.target.value})} />
                    </>
                  )}
                  {m._type === 'SUMMARY' && (
                    <select className="rs-card rs-p-2" value={editForm.ttl_setting} onChange={e => setEditForm({...editForm, ttl_setting: e.target.value})}>
                      <option value="short">Short</option>
                      <option value="standard">Standard</option>
                      <option value="extended">Extended</option>
                      <option value="long">Long</option>
                      <option value="forever">Forever</option>
                    </select>
                  )}
                  <div className="rs-flex rs-gap-2">
                    <button className="rs-pill" onClick={() => handleUpdate(m.id, m._type)} style={{ background: 'var(--text)', color: 'var(--bg)' }}>SAVE</button>
                    <button className="rs-pill" onClick={() => setEditingId(null)}>CANCEL</button>
                  </div>
                </div>
              ) : (
                <div className="rs-card-value rs-type-body" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {m.text}
                </div>
              )}
              
              <div className="rs-mt-4 rs-flex rs-justify-between rs-items-end">
                {renderProvenance(m)}
                {m._type === 'SUMMARY' && m.expires_at && (
                  <span className="rs-type-nano rs-c-warning">
                    Expires: {new Date(m.expires_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
