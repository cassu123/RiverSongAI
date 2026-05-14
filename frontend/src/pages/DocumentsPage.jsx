import React, { useState, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import './DocumentsPage.css'

export default function DocumentsPage() {
  const { token } = useAuth()
  
  const [file, setFile] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestMsg, setIngestMsg] = useState(null)
  
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState(null)
  
  const fileRef = useRef()

  const handleIngest = async () => {
    if (!file) return
    setIngesting(true)
    setIngestMsg(null)
    setError(null)
    
    try {
      const fd = new FormData()
      fd.append('file', file)
      // doc_id is user-scoped global for now
      const res = await fetch(`/api/rag/ingest?doc_id=global_docs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      })
      if (!res.ok) throw new Error('Ingestion failed')
      setIngestMsg(`Success: ${file.name} ingested.`)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err.message)
    } finally {
      setIngesting(false)
    }
  }

  const handleQuery = async (e) => {
    e.preventDefault()
    if (!question.trim()) return
    
    setAsking(true)
    setError(null)
    setAnswer(null)
    
    try {
      const res = await fetch('/api/rag/query', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ doc_id: 'global_docs', question: question.trim() })
      })
      if (!res.ok) throw new Error('Query failed')
      const data = await res.json()
      setAnswer(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="page-wrap docs-page">
      <div className="page-header-row">
        <div>
          <div className="page-breadcrumb">
            <span>◢</span><span>INTEL</span>
            <span className="page-breadcrumb-sep">/</span>
            <span>KNOWLEDGE BASE</span>
          </div>
          <h1 className="page-title">Sifter</h1>
          <div className="page-subtitle">
            <span className="page-subtitle-dot" />
            Ingest PDFs and search your private intelligence.
          </div>
        </div>
      </div>

      <div className="docs-layout">
        <div className="docs-upload-card card">
          <div className="card-title">INGEST DOCUMENT</div>
          <p className="docs-hint">Upload manuals, research papers, or logs. Text is vectorized for semantic recall.</p>
          
          <div className="docs-upload-controls">
            <input 
              ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }} 
              onChange={e => setFile(e.target.files[0])} 
            />
            <button className="btn btn--ghost docs-file-btn" onClick={() => fileRef.current.click()}>
              {file ? file.name : 'SELECT PDF/TXT'}
            </button>
            {file && (
              <button className="btn btn--cta docs-ingest-btn" onClick={handleIngest} disabled={ingesting}>
                {ingesting ? 'INGESTING...' : 'INGEST'}
              </button>
            )}
          </div>
          
          {ingestMsg && <div className="docs-success-msg"><span className="dot dot--standby" /> {ingestMsg}</div>}
        </div>

        <div className="docs-query-section">
          <form className="docs-query-bar card" onSubmit={handleQuery}>
            <input 
              type="text" 
              placeholder="Ask a question about your documents..." 
              value={question}
              onChange={e => setQuestion(e.target.value)}
              disabled={asking}
            />
            <button className="btn btn--primary" type="submit" disabled={asking || !question.trim()}>
              {asking ? 'THINKING...' : 'QUERY'}
            </button>
          </form>

          {error && (
            <div className="docs-error card">
              <span className="dot dot--warn" /> {error}
            </div>
          )}

          {answer && (
            <div className="docs-answer animate-fade-in">
              <div className="card docs-answer-card">
                <div className="card-title">RESPONSE</div>
                <div className="docs-answer-text">{answer.answer}</div>
              </div>

              {answer.chunks?.length > 0 && (
                <div className="docs-sources">
                  <div className="docs-sources-title">RELEVANT EXCERPTS</div>
                  <div className="docs-sources-grid">
                    {answer.chunks.map((c, i) => (
                      <div key={i} className="card docs-source-card">
                        <div className="docs-source-meta">{c.source}</div>
                        <p className="docs-source-text">{c.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!answer && !asking && (
            <div className="docs-empty-state">
              <span className="material-symbols-rounded">find_in_page</span>
              <p>Ask a question to search through vectorized knowledge.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
