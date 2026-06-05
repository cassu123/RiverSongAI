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

  useEffect(() => {
    Promise.all([
      fetch('/api/memory/facts', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
      fetch('/api/memory/preferences', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
      fetch('/api/memory/summaries', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : [])
    ]).then(([facts, prefs, summaries]) => {
      const combined = [
        ...facts.map(f => ({ ...f, _type: 'FACT', text: `${f.key}: ${f.value}` })),
        ...prefs.map(p => ({ ...p, _type: 'PREF', text: `${p.topic}: ${p.preference}` })),
        ...summaries.map(s => ({ ...s, _type: 'SUMMARY', text: s.summary }))
      ]
      combined.sort((a, b) => new Date(b.created_at || b.timestamp || 0) - new Date(a.created_at || a.timestamp || 0))
      setMemories(combined)
      setLoading(false)
    })
  }, [token])

  const filtered = memories.filter(m => 
    (m.text || '').toLowerCase().includes(filter.toLowerCase()) || 
    (m._type || '').toLowerCase().includes(filter.toLowerCase())
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

  return (
    <div className="rs-foyer animate-fade-in">
      <div className="rs-foyer-head">
        <h1 className="rs-greeting">Semantic Archives</h1>
        <div className="rs-greeting-sub">Every fact, preference, and summary River Song has retained.</div>
      </div>

      <div className="rs-card-flow">
        {loading ? (
          <div className="rs-card-meta">SCANNING NEURAL PATHWAYS...</div>
        ) : filtered.length === 0 ? (
          <div className="rs-card-meta">No matching memories found.</div>
        ) : (
          filtered.map((m, i) => (
            <div key={m.id || i} className="rs-card is-wide animate-page-in">
              <div className="rs-card-head">
                <span className="rs-card-label" style={{ color: m._type === 'FACT' ? 'var(--primary)' : m._type === 'PREF' ? 'var(--rs-status-warning)' : 'var(--text-dim)' }}>
                  {m._type}
                </span>
                <span className="rs-card-label" style={{ opacity: 0.4 }}>
                  {m.created_at || m.timestamp ? new Date(m.created_at || m.timestamp).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="rs-card-value" style={{ fontSize: '1rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.text}
              </div>
              {m.metadata && (
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(m.metadata).map(([k, v]) => (
                    <span key={k} className="rs-pill" style={{ fontSize: '0.6rem', padding: '2px 8px' }}>
                      {k.toUpperCase()}: {String(v).toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
