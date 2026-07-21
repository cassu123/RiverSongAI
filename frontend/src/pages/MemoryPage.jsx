import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * MemoryPage — Phase 3 Rewrite
 * -----------------------------------------------------------------------------
 * Browse the long-term semantic memory of River Song.
 */

export default function MemoryPage({ setAction }) {
  const { token } = useAuth()
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="rs-card" style={{ flex: 1, padding: '8px 16px', background: 'var(--md-surface-container-low)' }}>
          <input 
            type="text" 
            style={{ all: 'unset', width: '100%', fontSize: '0.9rem' }} 
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
    return <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>Learned from {kind}{ref}, {date}</span>
  }

  return (
    <div className="rs-foyer animate-fade-in" style={{ paddingBottom: 60 }}>
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Memory Hub</h1>
        <div className="rs-greeting-sub">Inspect, edit, and control everything River Song knows about you.</div>
        
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
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
        <form onSubmit={handleCreateFact} className="rs-card is-wide animate-page-in" style={{ background: 'var(--md-surface-container-high)', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="rs-card-label" style={{ flexShrink: 0, color: 'var(--primary)' }}>ADD FACT</span>
          <input className="rs-card" placeholder="Key (e.g. name)" value={newFact.key} onChange={e => setNewFact({...newFact, key: e.target.value})} style={{ flex: 1, padding: 8, fontSize: '0.8rem' }} />
          <input className="rs-card" placeholder="Value (e.g. Alice)" value={newFact.value} onChange={e => setNewFact({...newFact, value: e.target.value})} style={{ flex: 2, padding: 8, fontSize: '0.8rem' }} />
          <button type="submit" className="rs-pill" style={{ background: 'var(--primary)', color: 'var(--bg)' }}>ADD</button>
        </form>
      )}

      {(activeTab === 'ALL' || activeTab === 'PREFERENCE') && (
        <form onSubmit={handleCreatePref} className="rs-card is-wide animate-page-in" style={{ background: 'var(--md-surface-container-high)', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="rs-card-label" style={{ flexShrink: 0, color: 'var(--rs-status-warning)' }}>ADD PREF</span>
          <input className="rs-card" placeholder="Category" value={newPref.category} onChange={e => setNewPref({...newPref, category: e.target.value})} style={{ flex: 1, padding: 8, fontSize: '0.8rem' }} />
          <input className="rs-card" placeholder="Value" value={newPref.value} onChange={e => setNewPref({...newPref, value: e.target.value})} style={{ flex: 2, padding: 8, fontSize: '0.8rem' }} />
          <select className="rs-card" value={newPref.confidence} onChange={e => setNewPref({...newPref, confidence: e.target.value})} style={{ padding: 8, fontSize: '0.8rem' }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button type="submit" className="rs-pill" style={{ background: 'var(--rs-status-warning)', color: 'var(--bg)' }}>ADD</button>
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
              <div className="rs-card-head" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 8, marginBottom: 12 }}>
                <span className="rs-card-label" style={{ 
                  color: m._type === 'FACT' ? 'var(--primary)' 
                       : m._type === 'PREFERENCE' ? 'var(--rs-status-warning)' 
                       : m._type === 'SUGGESTION' ? 'var(--rs-status-info)'
                       : 'var(--text-dim)' 
                }}>
                  {m._type}
                </span>
                
                {m._type === 'FACT' && (
                  <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 6px', background: m.source === 'explicit' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)' }}>
                    {m.source.toUpperCase()}
                  </span>
                )}
                {m._type === 'PREFERENCE' && (
                  <span className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 6px', opacity: 0.8 }}>
                    CONFIDENCE: {m.confidence.toUpperCase()}
                  </span>
                )}
                
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  {m._type === 'SUGGESTION' && (
                    <button className="rs-pill" onClick={() => handleApproveSuggestion(m.id)} style={{ padding: '4px 8px', fontSize: '0.7rem', background: 'var(--rs-status-success)' }}>
                      APPROVE
                    </button>
                  )}
                  {editingId !== m.id && m._type !== 'SUGGESTION' && (
                    <button className="rs-pill" onClick={() => startEdit(m)} style={{ padding: '4px 8px', fontSize: '0.7rem' }}>EDIT</button>
                  )}
                  <button className="rs-pill" onClick={() => handleDelete(m.id, m._type)} style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--rs-status-error)' }}>
                    {m._type === 'SUGGESTION' ? 'DISMISS' : 'DELETE'}
                  </button>
                </div>
              </div>
              
              {editingId === m.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {m._type === 'FACT' && (
                    <>
                      <input className="rs-card" value={editForm.key} onChange={e => setEditForm({...editForm, key: e.target.value})} style={{ padding: 8 }} />
                      <input className="rs-card" value={editForm.value} onChange={e => setEditForm({...editForm, value: e.target.value})} style={{ padding: 8 }} />
                    </>
                  )}
                  {m._type === 'PREFERENCE' && (
                    <>
                      <input className="rs-card" value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} style={{ padding: 8 }} />
                      <input className="rs-card" value={editForm.value} onChange={e => setEditForm({...editForm, value: e.target.value})} style={{ padding: 8 }} />
                    </>
                  )}
                  {m._type === 'SUMMARY' && (
                    <select className="rs-card" value={editForm.ttl_setting} onChange={e => setEditForm({...editForm, ttl_setting: e.target.value})} style={{ padding: 8 }}>
                      <option value="short">Short</option>
                      <option value="standard">Standard</option>
                      <option value="extended">Extended</option>
                      <option value="long">Long</option>
                      <option value="forever">Forever</option>
                    </select>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="rs-pill" onClick={() => handleUpdate(m.id, m._type)} style={{ background: 'var(--text)', color: 'var(--bg)' }}>SAVE</button>
                    <button className="rs-pill" onClick={() => setEditingId(null)}>CANCEL</button>
                  </div>
                </div>
              ) : (
                <div className="rs-card-value" style={{ fontSize: '1rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {m.text}
                </div>
              )}
              
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                {renderProvenance(m)}
                {m._type === 'SUMMARY' && m.expires_at && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--rs-status-warning)' }}>
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
